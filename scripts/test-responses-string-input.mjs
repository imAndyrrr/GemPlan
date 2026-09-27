// Regression test for Responses API with string input (e.g. CCR probe ping)
import assert from "node:assert/strict";
import worker from "../src/worker.js";

class MockKV {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
  }
  async get(key, type) {
    const value = this.store.get(key);
    if (value == null) return null;
    if (type === "json" && typeof value === "string") return JSON.parse(value);
    return value;
  }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

function makeUser() {
  return {
    accounts: [{
      id: "acc_test",
      email: "test@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-test",
      tokens: {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "mock-project-123"
      }
    }],
    api_config: {
      custom_path: "test-user",
      api_key: "sk-test-key",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

async function runTest() {
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes("googleapis.com") || urlStr.includes("cloudcode")) {
      if (opts?.body) {
        try { capturedPayload = JSON.parse(opts.body); } catch (_) {}
      }
      return new Response(JSON.stringify({
        response: {
          candidates: [{
            content: { role: "model", parts: [{ text: "pong" }] },
            finishReason: "STOP"
          }]
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(url, opts);
  };

  try {
    const user = makeUser();
    const env = {
      GEMINI_KV: new MockKV({ "key:sk-test-key": "test-user", "path:test-user": "test-user", "user:test-user": JSON.stringify(user) }),
      USERS_KV: new MockKV({ "user:test-user": JSON.stringify(user) }),
      CACHE_KV: new MockKV()
    };
    const ctx = { waitUntil() {}, drain: async () => {} };

    // 测试 CCR probe 发送的结构: input 为字符串 "ping"
    const req = new Request("https://example.test/test-user/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-test-key"
      },
      body: JSON.stringify({
        input: "ping",
        model: "gemini-3.8-flash-high-agy",
        stream: false
      })
    });

    const res = await worker.fetch(req, env, ctx);
    assert.equal(res.status, 200, "String input should succeed with 200");
    const json = await res.json();
    assert.equal(json.object, "response");
    assert.ok(json.output && json.output.length > 0);

    const contents = capturedPayload.contents || capturedPayload.request?.contents;
    assert.ok(contents && contents.length === 1, "Should have 1 user turn");
    assert.equal(contents[0].parts[0].text, "ping", "Should correctly extract 'ping' as text part");

    console.log("PASS: Responses API string input (CCR probe compatibility) works");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
