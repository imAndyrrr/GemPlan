// Regression test: routing design must be preserved.
// - bare model name (e.g. gemini-3.8-flash-high) → CodeAssist (by design)
// - "-agy" suffix (e.g. gemini-3.8-flash-high-agy) → Antigravity
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
    accounts: [
      {
        id: "acc_ca", email: "ca@example.test", name: "CodeAssist",
        mode: "codeassist", enabled: true, status: "active",
        last_used_at: 0, cooldown_until: 0, machine_id: "machine-ca",
        tokens: {
          access_token: "ca-access", refresh_token: "ca-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          project_id: "ca-project"
        }
      },
      {
        id: "acc_ag", email: "ag@example.test", name: "Antigravity",
        mode: "antigravity", enabled: true, status: "active",
        last_used_at: 0, cooldown_until: 0, machine_id: "machine-ag", priority: 100,
        tokens: {
          access_token: "ag-access", refresh_token: "ag-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          project_id: "aicode-consumers"
        }
      }
    ],
    api_config: {
      custom_path: "test-user",
      api_key: "sk-test-key",
      calling_mode: "antigravity",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

async function runTest() {
  let capturedHeaders = null;
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes("googleapis.com") || urlStr.includes("cloudcode")) {
      if (opts?.body) {
        try { capturedPayload = JSON.parse(opts.body); } catch (_) {}
        capturedHeaders = opts.headers || {};
      }
      return new Response(JSON.stringify({
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "PONG" }] }, finishReason: "STOP" }]
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, opts);
  };

  try {
    const user = makeUser();
    const env = {
      GEMINI_KV: new MockKV({ "key:sk-test-key": "test-user", "path:test-user": "test-user", "user:test-user": JSON.stringify(user) }),
      USERS_KV: new MockKV({ "user:test-user": JSON.stringify(user) }),
      CACHE_KV: new MockKV(),
      ANTIGRAVITY_CLIENT_ID: "fake-ag", ANTIGRAVITY_CLIENT_SECRET: "fake-ag-sec",
      CODEASSIST_CLIENT_ID: "fake-ca", CODEASSIST_CLIENT_SECRET: "fake-ca-sec"
    };
    const ctx = { waitUntil() {}, drain: async () => {} };

    // Case 1: "-agy" 后缀 → Antigravity（显式指定）
    {
      capturedHeaders = null; capturedPayload = null;
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
          model: "gemini-3.8-flash-high-agy",
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "-agy model should succeed");
      assert.equal(capturedHeaders?.["x-client-name"], "antigravity", "-agy model must use Antigravity");
      assert.equal(capturedPayload?.userAgent, "antigravity");
      assert.equal(capturedPayload?.requestType, "agent");
      assert.deepEqual(capturedPayload?.enabledCreditTypes, ["GOOGLE_ONE_AI"]);
      assert.equal(capturedPayload?.project, "", "Antigravity must not receive a CodeAssist project ID");
      assert.equal(capturedPayload?.request?.model || capturedPayload?.model, "gemini-3.8-flash-high",
        "-agy suffix should be stripped");
      console.log("PASS: -agy model correctly routed to Antigravity with suffix stripped");
    }

    // Case 2: 裸名 → CodeAssist（设计如此）
    {
      capturedHeaders = null; capturedPayload = null;
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
          model: "gemini-3.8-flash-high",
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "bare model should succeed");
      // CodeAssist 路径不设置 x-client-name: antigravity
      assert.notEqual(capturedHeaders?.["x-client-name"], "antigravity",
        "bare model must use CodeAssist (by design)");
      assert.equal(capturedHeaders?.["Client-Metadata"], "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI");
      assert.equal(capturedPayload?.requestType, undefined, "CodeAssist must not receive an Antigravity agent envelope");
      assert.equal(capturedPayload?.request?.model || capturedPayload?.model, "gemini-3.8-flash-high",
        "bare model name should be passed as-is");
      console.log("PASS: bare model correctly routed to CodeAssist (by design)");
    }

    console.log("\nALL ROUTING DESIGN TESTS PASSED!");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTest().catch((err) => { console.error("Test failed:", err); process.exit(1); });
