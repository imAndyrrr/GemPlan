import assert from "node:assert/strict";
import worker from "../src/worker.js";

class MockKV {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
    this.deleted = [];
  }

  async get(key, type) {
    const value = this.store.get(key);
    if (value == null) return null;
    if (type === "json") return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.deleted.push(key);
    this.store.delete(key);
  }
}

function makeUser(accounts) {
  return {
    password_hash: "unused",
    accounts,
    machine_id: "machine-user",
    google_tokens: accounts.find((account) => account.mode === "codeassist")?.tokens || null,
    antigravity_tokens: accounts.find((account) => account.mode === "antigravity")?.tokens || null,
    api_config: {
      custom_path: "runtime-test",
      api_key: "sk-runtime-test",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

function makeAccount(overrides = {}) {
  return {
    id: "acc_reauth",
    email: "broken@example.test",
    name: "Broken Account",
    mode: "antigravity",
    enabled: true,
    status: "error",
    error_message: "Token refresh failed",
    cooldown_until: 123,
    last_used_at: 10,
    priority: 37,
    created_at: 5,
    machine_id: "machine-account",
    tokens: {
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: 1,
      project_id: "old-project"
    },
    ...overrides
  };
}

function makeEnv(user) {
  return {
    GEMINI_KV: new MockKV({
      "session:session-reauth": "runtime-user",
      "user:runtime-user": JSON.stringify(user)
    }),
    ANTIGRAVITY_CLIENT_ID: "fake-ag",
    ANTIGRAVITY_CLIENT_SECRET: "fake-ag-secret",
    ANTIGRAVITY_REDIRECT_URI: "http://localhost:8080/callback",
    CODEASSIST_CLIENT_ID: "fake-ca",
    CODEASSIST_CLIENT_SECRET: "fake-ca-secret",
    CODEASSIST_REDIRECT_URI: "http://localhost:8085/oauth2callback"
  };
}

function authRequest(path) {
  return new Request(`https://example.test${path}`, {
    headers: { Cookie: "session_id=session-reauth" }
  });
}

function callbackRequest(redirectUrl) {
  const form = new FormData();
  form.set("redirect_url", redirectUrl);
  return new Request("https://example.test/api/auth/google/callback", {
    method: "POST",
    headers: { Cookie: "session_id=session-reauth" },
    body: form
  });
}

const oauthFetchCalls = [];

function mockOAuthFetch({ email, sub = "google-sub-broken", name = "Fresh Name", includeRefreshToken = true }) {
  return async (url, options = {}) => {
    const value = String(url);
    if (value.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({
        access_token: "new-access",
        ...(includeRefreshToken ? { refresh_token: "new-refresh" } : {}),
        expires_in: 7200
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (value.includes("loadCodeAssist")) {
      oauthFetchCalls.push({
        url: value,
        headers: options.headers || {},
        body: String(options.body || "")
      });
      return new Response(JSON.stringify({ cloudaicompanionProject: "project-new" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (value.includes("/oauth2/v3/userinfo")) {
      return new Response(JSON.stringify({ email, name, sub }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error(`Unexpected OAuth fetch: ${value}`);
  };
}

{
  const user = makeUser([
    makeAccount(),
    makeAccount({
      id: "acc_active",
      email: "active@example.test",
      name: "Active Account",
      status: "active",
      error_message: null,
      cooldown_until: 0
    })
  ]);
  const env = makeEnv(user);
  const response = await worker.fetch(authRequest("/dashboard"), env, {
    waitUntil() {},
    async drain() {}
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /data-reauthorize-mode="antigravity"/);
  assert.match(html, /data-reauthorize-account="acc_reauth"/);
  assert.doesNotMatch(html, /data-reauthorize-account="acc_active"/);
  assert.match(html, /function reauthorizeAccount\(mode, id\)/);
  assert.match(html, /account_id: id/);
  console.log("PASS: only authorization-error accounts show the reauthorize button");
}

{
  const user = makeUser([makeAccount()]);
  const env = makeEnv(user);
  const response = await worker.fetch(
    authRequest("/api/auth/google/start?mode=antigravity&account_id=acc_reauth"),
    env,
    { waitUntil() {}, async drain() {} }
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const state = location.searchParams.get("state");
  assert.ok(state);
  const oauthData = JSON.parse(env.GEMINI_KV.store.get(`oauth:${state}`));
  assert.equal(oauthData.username, "runtime-user");
  assert.equal(oauthData.mode, "antigravity");
  assert.equal(oauthData.accountId, "acc_reauth");
  assert.ok(oauthData.verifier);
  console.log("PASS: reauthorize entry binds OAuth state to the target account");
}

{
  const user = makeUser([makeAccount()]);
  const env = makeEnv(user);
  const response = await worker.fetch(
    authRequest("/api/auth/google/start?mode=codeassist&account_id=acc_reauth"),
    env,
    { waitUntil() {}, async drain() {} }
  );
  assert.equal(response.status, 400);
  assert.equal(env.GEMINI_KV.store.has("oauth:missing-state"), false);
  console.log("PASS: reauthorize rejects an account from the wrong OAuth mode");
}

{
  const user = makeUser([makeAccount()]);
  const env = makeEnv(user);
  env.GEMINI_KV.store.set("oauth:state-good", JSON.stringify({
    username: "runtime-user",
    verifier: "pkce-verifier",
    mode: "antigravity",
    accountId: "acc_reauth"
  }));
  const originalFetch = globalThis.fetch;
  oauthFetchCalls.length = 0;
  globalThis.fetch = mockOAuthFetch({ email: "broken@example.test", sub: "google-sub-broken", name: "Renamed Account" });
  try {
    const response = await worker.fetch(
      callbackRequest("http://localhost:8080/callback?code=oauth-code&state=state-good"),
      env,
      { waitUntil() {}, async drain() {} }
    );
    const body = await response.text();
    const storedUser = JSON.parse(env.GEMINI_KV.store.get("user:runtime-user"));
    assert.equal(response.status, 200, body);
    assert.match(body, /Google 授权成功/);
    assert.equal(storedUser.accounts.length, 1);
    const account = storedUser.accounts[0];
    assert.equal(account.id, "acc_reauth");
    assert.equal(account.email, "broken@example.test");
    assert.equal(account.name, "Renamed Account");
    assert.equal(account.google_sub, "google-sub-broken");
    assert.equal(account.status, "active");
    assert.equal(account.error_message, null);
    assert.equal(account.cooldown_until, 0);
    assert.equal(account.priority, 37);
    assert.equal(account.tokens.access_token, "new-access");
    assert.equal(account.tokens.refresh_token, "new-refresh");
    assert.equal(account.tokens.project_id, "");
    assert.ok(account.tokens.expires_at > Math.floor(Date.now() / 1000));
    assert.equal(env.GEMINI_KV.store.has("oauth:state-good"), false);
    assert.equal(storedUser.antigravity_tokens.access_token, "new-access");
    assert.equal(
      oauthFetchCalls.some((call) => call.url.includes("loadCodeAssist") || call.url.includes("onboardUser")),
      false,
      "Antigravity authorization must not enter CodeAssist project/onboarding APIs"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: matching Google account reauthorizes the original account in place");
}

{
  const originalUser = makeUser([makeAccount()]);
  const env = makeEnv(originalUser);
  env.GEMINI_KV.store.set("oauth:state-mismatch", JSON.stringify({
    username: "runtime-user",
    verifier: "pkce-verifier",
    mode: "antigravity",
    accountId: "acc_reauth"
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockOAuthFetch({ email: "someone-else@example.test", sub: "google-sub-someone-else" });
  try {
    const response = await worker.fetch(
      callbackRequest("http://localhost:8080/callback?code=oauth-code&state=state-mismatch"),
      env,
      { waitUntil() {}, async drain() {} }
    );
    const body = await response.text();
    const storedUser = JSON.parse(env.GEMINI_KV.store.get("user:runtime-user"));
    assert.equal(response.status, 400, body);
    assert.match(body, /目标账号不一致/);
    assert.deepEqual(storedUser, originalUser);
    assert.equal(env.GEMINI_KV.store.has("oauth:state-mismatch"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: mismatched Google account cannot overwrite the target credentials");
}


{
  const user = makeUser([makeAccount({ email: "Antigravity 账号 (默认)", google_sub: "" })]);
  const env = makeEnv(user);
  env.GEMINI_KV.store.set("oauth:state-legacy", JSON.stringify({
    username: "runtime-user",
    verifier: "pkce-verifier",
    mode: "antigravity",
    accountId: "acc_reauth"
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockOAuthFetch({
    email: "same.user+antigravity@googlemail.com",
    sub: "google-sub-legacy",
    name: "Legacy Account"
  });
  try {
    const response = await worker.fetch(
      callbackRequest("http://localhost:8080/callback?code=oauth-code&state=state-legacy"),
      env,
      { waitUntil() {}, async drain() {} }
    );
    const body = await response.text();
    const storedUser = JSON.parse(env.GEMINI_KV.store.get("user:runtime-user"));
    assert.equal(response.status, 200, body);
    assert.equal(storedUser.accounts.length, 1);
    assert.equal(storedUser.accounts[0].email, "same.user+antigravity@googlemail.com");
    assert.equal(storedUser.accounts[0].google_sub, "google-sub-legacy");
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: legacy display-label account accepts explicit reauthorization");
}

{
  const user = makeUser([makeAccount({ email: "same.user@gmail.com", google_sub: "google-sub-same" })]);
  const env = makeEnv(user);
  env.GEMINI_KV.store.set("oauth:state-alias", JSON.stringify({
    username: "runtime-user",
    verifier: "pkce-verifier",
    mode: "antigravity",
    accountId: "acc_reauth"
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockOAuthFetch({
    email: "same.user+alias@googlemail.com",
    sub: "google-sub-same",
    name: "Alias Account"
  });
  try {
    const response = await worker.fetch(
      callbackRequest("http://localhost:8080/callback?code=oauth-code&state=state-alias"),
      env,
      { waitUntil() {}, async drain() {} }
    );
    const body = await response.text();
    const storedUser = JSON.parse(env.GEMINI_KV.store.get("user:runtime-user"));
    assert.equal(response.status, 200, body);
    assert.equal(storedUser.accounts[0].google_sub, "google-sub-same");
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: matching Google sub overrides email alias differences");
}

{
  const user = makeUser([makeAccount({ email: "same.user@gmail.com", google_sub: "google-sub-old" })]);
  const env = makeEnv(user);
  env.GEMINI_KV.store.set("oauth:state-sub-mismatch", JSON.stringify({
    username: "runtime-user",
    verifier: "pkce-verifier",
    mode: "antigravity",
    accountId: "acc_reauth"
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockOAuthFetch({
    email: "same.user@gmail.com",
    sub: "google-sub-new",
    name: "Different Google Account"
  });
  try {
    const response = await worker.fetch(
      callbackRequest("http://localhost:8080/callback?code=oauth-code&state=state-sub-mismatch"),
      env,
      { waitUntil() {}, async drain() {} }
    );
    const body = await response.text();
    const storedUser = JSON.parse(env.GEMINI_KV.store.get("user:runtime-user"));
    assert.equal(response.status, 400, body);
    assert.match(body, /目标账号不一致/);
    assert.equal(storedUser.accounts[0].google_sub, "google-sub-old");
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: Google sub mismatch rejects credential replacement");
}

console.log("\nALL ACCOUNT REAUTHORIZATION TESTS PASSED!");
