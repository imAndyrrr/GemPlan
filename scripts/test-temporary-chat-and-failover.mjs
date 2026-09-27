import assert from "node:assert/strict";
import worker from "../src/worker.js";

class MockKV {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
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
    this.store.delete(key);
  }
}

function makeCtx() {
  const pending = [];
  return {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    async drain() {
      await Promise.allSettled(pending);
    }
  };
}

function makeAccount(id, overrides = {}) {
  return {
    id,
    email: `${id}@example.test`,
    name: id,
    mode: "antigravity",
    enabled: true,
    status: "active",
    priority: 0,
    last_used_at: 0,
    cooldown_until: 0,
    machine_id: `machine-${id}`,
    tokens: {
      access_token: `token-${id}`,
      refresh_token: `refresh-${id}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      project_id: `project-${id}`
    },
    ...overrides
  };
}

function makeUser(accounts) {
  return {
    password_hash: "unused",
    accounts,
    machine_id: "machine-user",
    google_tokens: null,
    antigravity_tokens: accounts.find((account) => account.mode === "antigravity")?.tokens || null,
    api_config: {
      custom_path: "runtime-test",
      api_key: "sk-runtime-test",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

function chatRequest(query = "") {
  return new Request(`https://example.test/runtime-test/v1/chat/completions${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-runtime-test"
    },
    body: JSON.stringify({
      model: "gemini-test-agy",
      messages: [{ role: "user", content: "reply only OK" }],
      stream: false
    })
  });
}

function withCf(request, colo) {
  Object.defineProperty(request, "cf", {
    configurable: true,
    value: { colo }
  });
  return request;
}

function successResponse(text = "OK") {
  return new Response(JSON.stringify({
    response: {
      candidates: [{
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP"
      }],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 1,
        totalTokenCount: 3
      }
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

const originalFetch = globalThis.fetch;

try {
  {
    const user = makeUser([
      makeAccount("acc-ag"),
      makeAccount("acc-ca", { mode: "codeassist" })
    ]);
    const kv = new MockKV({
      "session:session-dashboard": "dashboard-user",
      "user:dashboard-user": JSON.stringify(user)
    });
    const response = await worker.fetch(new Request("https://example.test/dashboard", {
      headers: { Cookie: "session_id=session-dashboard" }
    }), { GEMINI_KV: kv }, makeCtx());
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /id="chat-model-input"/);
    assert.match(html, /id="chat-model-select"/);
    assert.doesNotMatch(html, /<datalist id="chat-model-options"/);
    assert.match(html, /function selectChatModel\(value\)/);
    assert.match(html, /new URLSearchParams\(\{ real: "1" \}\)/);
    assert.match(html, /id="chat-account-select"/);
    assert.match(html, /id="chat-model-list-status"/);
    assert.match(html, /loadChatModels/);
    assert.match(html, /value="acc-ag"/);
    assert.match(html, /value="acc-ca"/);
    assert.match(html, /\?account_id=/);
    assert.doesNotMatch(html, /\\\$\{accounts/);
    console.log("PASS: temporary chat exposes model suggestions, manual input, and account selection");
  }

  {
    const user = makeUser([makeAccount("acc-models")]);
    const kv = new MockKV({
      "key:sk-runtime-test": "models-user",
      "user:models-user": JSON.stringify(user),
      "quota:models-user:acc-models": JSON.stringify({
        models: [{
          name: "gemini-target",
          percentage: 64,
          display_name: "Target Model"
        }],
        last_updated: Math.floor(Date.now() / 1000),
        is_forbidden: false
      })
    });
    globalThis.fetch = async () => {
      throw new Error("model list should use the selected account cache");
    };
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/models?account_id=acc-models&real=1", {
      headers: { Authorization: "Bearer sk-runtime-test" }
    }), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.source, "antigravity");
    assert.equal(data.data[0].id, "gemini-target-agy");
    assert.equal(data.data[0].quota_percentage, 64);
    console.log("PASS: model list follows the selected account");
  }

  {
    const user = makeUser([makeAccount("acc-ca", { mode: "codeassist" })]);
    const kv = new MockKV({
      "key:sk-runtime-test": "models-user",
      "user:models-user": JSON.stringify(user)
    });
    globalThis.fetch = async () => {
      throw new Error("CodeAssist must not be queried for a real Antigravity model list");
    };
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/models?account_id=acc-ca&real=1", {
      headers: { Authorization: "Bearer sk-runtime-test" }
    }), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();

    assert.equal(response.status, 503);
    assert.match(data.error, /CodeAssist 已停用/);
    console.log("PASS: real model list never falls back to CodeAssist");
  }

  {
    const user = makeUser([makeAccount("acc-real-models")]);
    const kv = new MockKV({
      "key:sk-runtime-test": "models-user",
      "user:models-user": JSON.stringify(user)
    });
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, body: String(init.body || "") });
      if (value.includes(":fetchAvailableModels")) {
        const models = {};
        for (let i = 0; i < 8; i++) {
          models[`gemini-real-${i}`] = {
            displayName: `Real Model ${i}`,
            quotaInfo: { remainingFraction: 1 - i / 20, resetTime: "2026-09-24T00:00:00Z" }
          };
        }
        return new Response(JSON.stringify({ models }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (value.includes(":retrieveUserQuotaSummary")) {
        return new Response(JSON.stringify({ groups: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`unexpected model-list upstream: ${value}`);
    };
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/models?account_id=acc-real-models&real=1", {
      headers: { Authorization: "Bearer sk-runtime-test" }
    }), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.source, "antigravity");
    assert.equal(data.data.length, 8, "the full real model list must not be reduced to browser suggestion limits");
    assert.equal(data.data[7].id, "gemini-real-7-agy");
    assert.equal(calls.some((call) => call.url.includes("loadCodeAssist") || call.url.includes("onboardUser")), false);
    const modelCall = calls.find((call) => call.url.includes(":fetchAvailableModels"));
    assert.ok(modelCall);
    assert.deepEqual(JSON.parse(modelCall.body), {}, "Antigravity model discovery must not use a CodeAssist project");
    console.log("PASS: dashboard receives the complete Antigravity model list without CodeAssist calls");
  }

  {
    const user = makeUser([
      makeAccount("acc-low", {
        enabled: false,
        status: "error",
        priority: 0
      }),
      makeAccount("acc-high", { priority: 100 })
    ]);
    const kv = new MockKV({
      "key:sk-runtime-test": "pin-user",
      "user:pin-user": JSON.stringify(user)
    });
    const seenTokens = [];
    globalThis.fetch = async (_url, init = {}) => {
      const auth = init.headers?.Authorization || init.headers?.authorization || "";
      seenTokens.push(auth);
      if (auth === "Bearer token-acc-low") return successResponse("pinned-account-ok");
      throw new Error(`unexpected account was used: ${auth}`);
    };
    const response = await worker.fetch(chatRequest("?account_id=acc-low"), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.choices[0].message.content, "pinned-account-ok");
    assert.deepEqual(seenTokens, ["Bearer token-acc-low"]);
    console.log("PASS: explicitly selected account is used without failover");
  }

  {
    const user = makeUser([
      makeAccount("acc-ca", { mode: "codeassist" }),
      makeAccount("acc-ag")
    ]);
    const kv = new MockKV({
      "key:sk-runtime-test": "wrong-mode-user",
      "user:wrong-mode-user": JSON.stringify(user)
    });
    globalThis.fetch = async () => {
      throw new Error("wrong-mode pin must be rejected before upstream");
    };
    const response = await worker.fetch(chatRequest("?account_id=acc-ca"), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.error, /模式不匹配/);
    console.log("PASS: selected account must match the model mode");
  }

  {
    const user = makeUser([
      makeAccount("acc-403-high", { priority: 100 }),
      makeAccount("acc-403-low", { priority: 0 })
    ]);
    const kv = new MockKV({
      "key:sk-runtime-test": "failover-user",
      "user:failover-user": JSON.stringify(user)
    });
    const seenTokens = [];
    globalThis.fetch = async (_url, init = {}) => {
      const auth = init.headers?.Authorization || init.headers?.authorization || "";
      seenTokens.push(auth);
      if (auth === "Bearer token-acc-403-high") {
        return new Response(JSON.stringify({
          error: {
            message: "You do not have a valid license of this product. (#3501)",
            code: 403
          }
        }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (auth === "Bearer token-acc-403-low") return successResponse("failover-after-403");
      throw new Error(`unexpected account was used: ${auth}`);
    };
    const response = await worker.fetch(chatRequest(), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();
    await makeCtx().drain();

    assert.equal(response.status, 200);
    assert.equal(data.choices[0].message.content, "failover-after-403");
    assert.ok(seenTokens.includes("Bearer token-acc-403-high"));
    assert.ok(seenTokens.includes("Bearer token-acc-403-low"));
    console.log("PASS: 403 on a higher-priority account fails over to the lower-priority account");
  }

  {
    const user = makeUser([
      makeAccount("acc-colo-high", { priority: 100 }),
      makeAccount("acc-colo-low", { priority: 0 })
    ]);
    const kv = new MockKV({
      "key:sk-runtime-test": "colo-user",
      "user:colo-user": JSON.stringify(user)
    });
    const seenTokens = [];
    let upstreamColo = "AMS";
    globalThis.fetch = async (_url, init = {}) => {
      const auth = init.headers?.Authorization || init.headers?.authorization || "";
      seenTokens.push(auth);
      if (auth === "Bearer token-acc-colo-high" && upstreamColo === "AMS") {
        return new Response(JSON.stringify({
          error: {
            message: "Your current account is not eligible because it is not currently available in your location. Error ID: 936282e7-1-1008",
            code: 403
          }
        }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (auth === "Bearer token-acc-colo-high") return successResponse("high-account-ok");
      if (auth === "Bearer token-acc-colo-low") return successResponse("low-account-ok");
      throw new Error(`unexpected account was used: ${auth}`);
    };

    const first = await worker.fetch(withCf(chatRequest(), "AMS"), { GEMINI_KV: kv }, makeCtx());
    const firstData = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstData.choices[0].message.content, "low-account-ok");

    const storedAfterEligibilityFailure = JSON.parse(kv.store.get("user:colo-user"));
    assert.equal(storedAfterEligibilityFailure.accounts[0].status, "active");
    assert.ok(!storedAfterEligibilityFailure.accounts[0].error_message);

    seenTokens.length = 0;
    const sameColo = await worker.fetch(withCf(chatRequest(), "AMS"), { GEMINI_KV: kv }, makeCtx());
    const sameColoData = await sameColo.json();
    assert.equal(sameColo.status, 200);
    assert.equal(sameColoData.choices[0].message.content, "low-account-ok");
    assert.equal(seenTokens[0], "Bearer token-acc-colo-low");

    seenTokens.length = 0;
    upstreamColo = "LAX";
    const otherColo = await worker.fetch(withCf(chatRequest(), "LAX"), { GEMINI_KV: kv }, makeCtx());
    const otherColoData = await otherColo.json();
    assert.equal(otherColo.status, 200);
    assert.equal(otherColoData.choices[0].message.content, "high-account-ok");
    assert.equal(seenTokens[0], "Bearer token-acc-colo-high");
    console.log("PASS: Google eligibility blocks are scoped to account and Cloudflare colo");
  }

  {
    const user = makeUser([
      makeAccount("acc-recovery-high", { priority: 100 }),
      makeAccount("acc-recovery-blocked", { priority: 0 })
    ]);
    const kv = new MockKV({
      "key:sk-runtime-test": "recovery-user",
      "user:recovery-user": JSON.stringify(user)
    });
    const accountSequence = [];
    const highRequestIds = [];
    let highFetchCount = 0;
    globalThis.fetch = async (_url, init = {}) => {
      const auth = init.headers?.Authorization || init.headers?.authorization || "";
      if (accountSequence.at(-1) !== auth) accountSequence.push(auth);
      if (auth === "Bearer token-acc-recovery-high") {
        highFetchCount++;
        highRequestIds.push(JSON.parse(String(init.body)).requestId);
        if (highFetchCount <= 3) {
          return new Response(JSON.stringify({ error: { message: "temporarily throttled" } }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "1"
            }
          });
        }
        return successResponse("recovered-high-ok");
      }
      if (auth === "Bearer token-acc-recovery-blocked") {
        return new Response(JSON.stringify({
          error: {
            message: "You do not have a valid license of this product. (#3501)",
            code: 403
          }
        }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`unexpected account was used: ${auth}`);
    };

    const response = await worker.fetch(withCf(chatRequest(), "SIN"), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.choices[0].message.content, "recovered-high-ok");
    assert.deepEqual(accountSequence, [
      "Bearer token-acc-recovery-high",
      "Bearer token-acc-recovery-blocked",
      "Bearer token-acc-recovery-high"
    ]);
    assert.equal(highRequestIds.length, 4);
    assert.notEqual(highRequestIds[0], highRequestIds.at(-1));
    console.log("PASS: transient 429 is retried after a terminal account-local 403 without leaking the error");
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("\nALL TEMPORARY CHAT AND ACCOUNT FAILOVER TESTS PASSED!");
