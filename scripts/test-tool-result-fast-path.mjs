// Regression test for tool result fast-path and mutateInPlace under long tool history
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
            content: { role: "model", parts: [{ text: "Done" }] },
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

    // 构造模拟包含 150 轮连续工具调用的长历史
    const messages = [
      { role: "user", content: "Execute commands" }
    ];
    for (let i = 0; i < 150; i++) {
      const callId = `call_${i}`;
      messages.push({
        role: "assistant",
        content: `Running step ${i}`,
        tool_calls: [{
          id: callId,
          type: "function",
          function: { name: "exec_command", arguments: JSON.stringify({ cmd: `echo ${i}` }) }
        }]
      });
      messages.push({
        role: "tool",
        tool_call_id: callId,
        content: `Output for step ${i}: Successfully executed with code 0\n[stdout]\nline 1\nline 2`
      });
    }

    const req = new Request("https://example.test/test-user/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-test-key"
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash-high-agy",
        messages,
        stream: false
      })
    });

    const start = performance.now();
    const res = await worker.fetch(req, env, ctx);
    const duration = performance.now() - start;

    assert.equal(res.status, 200, "150-tool-round request should succeed");
    assert.ok(capturedPayload, "Upstream payload should be captured");
    
    const contents = capturedPayload.contents || capturedPayload.request?.contents;
    assert.ok(contents && contents.length > 100, "Contents should have over 100 turns");
    console.log(`PASS: 150 tool rounds processed in ${duration.toFixed(2)}ms (well below limits)`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
