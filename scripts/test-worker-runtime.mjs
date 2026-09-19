// End-to-end Worker regression tests with mocked KV and Google upstream.
// These tests exercise the actual exported fetch handler rather than isolated
// helpers, so route-level async exceptions and account failover are covered.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
if (/GOCSPX-|apps\.googleusercontent\.com/.test(workerSource)) {
  throw new Error("OAuth client credentials must not be hard-coded in src/worker.js");
}

class MockKV {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
    this.getCalls = [];
    this.putCalls = [];
  }

  async get(key, type) {
    this.getCalls.push(key);
    if (Array.isArray(key)) {
      return new Map(key.map((item) => {
        const value = this.store.get(item);
        if (value == null) return [item, null];
        return [item, type === "json" && typeof value === "string" ? JSON.parse(value) : structuredClone(value)];
      }));
    }
    const value = this.store.get(key);
    if (value == null) return null;
    if (type === "json") return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  async put(key, value) {
    this.putCalls.push(key);
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }
}

function makeCtx() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    async drain() {
      await Promise.allSettled(pending);
    }
  };
}

function makeUser(accounts) {
  return {
    password_hash: "unused",
    accounts,
    machine_id: "machine-user",
    google_tokens: null,
    antigravity_tokens: accounts.find((a) => a.mode === "antigravity")?.tokens || null,
    api_config: {
      custom_path: "runtime-test",
      api_key: "sk-runtime-test",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

function apiRequest(model = "gemini-test-agy") {
  return new Request("https://example.test/runtime-test/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-runtime-test"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "reply only OK" }],
      stream: false
    })
  });
}

function nativeGeminiRequest(model = "gemini-test-agy", action = "generateContent") {
  return new Request(`https://example.test/runtime-test/v1beta/models/${encodeURIComponent(model)}:${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-runtime-test"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "reply only OK" }] }]
    })
  });
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

function signatureResponse(text = "OK") {
  return new Response(JSON.stringify({
    response: {
      candidates: [{
        content: {
          role: "model",
          parts: [
            { thought: true, text: "internal thought", thoughtSignature: "signature-" + "x".repeat(80) },
            { text }
          ]
        },
        finishReason: "STOP"
      }],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 2,
        totalTokenCount: 4
      }
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function successStreamResponse(text = "OK") {
  return new Response(`data: ${JSON.stringify({
    response: {
      candidates: [{
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP"
      }],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 2,
        totalTokenCount: 6
      }
    }
  })}

`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

const originalFetch = globalThis.fetch;

try {
  // 1. A real proxy request must complete through the exported Worker.
  {
    const account = {
      id: "acc_single",
      email: "single@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-single",
      tokens: {
        access_token: "token-single",
        refresh_token: "refresh-single",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-single"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const ctx = makeCtx();
    globalThis.fetch = async () => successResponse("single-account-ok");

    const response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
    const data = await response.json();
    await ctx.drain();

    if (response.status !== 200 || data.choices?.[0]?.message?.content !== "single-account-ok") {
      throw new Error(`actual Worker proxy path failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    if (kv.putCalls.includes("user:runtime-user")) {
      throw new Error(`clean successful API request rewrote the shared user KV key: ${JSON.stringify(kv.putCalls)}`);
    }
    if (kv.getCalls.some((key) => Array.isArray(key))) {
      throw new Error("single-account request performed an unnecessary quota-ranking KV read");
    }
    console.log("PASS: exported Worker handles a complete API request without a hot-path user write");
  }

  // 1a. Thought signatures remain available in the transient cache without
  // creating a KV write for each API response.
  {
    const account = {
      id: "acc_signature",
      email: "signature@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-signature",
      tokens: {
        access_token: "token-signature",
        refresh_token: "refresh-signature",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-signature"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const ctx = makeCtx();
    globalThis.fetch = async () => signatureResponse("signature-cache-ok");

    const response = await worker.fetch(apiRequest("gemini-signature-agy", "signature cache"), { GEMINI_KV: kv }, ctx);
    const data = await response.json();
    await ctx.drain();

    if (response.status !== 200 || data.choices?.[0]?.message?.content !== "signature-cache-ok") {
      throw new Error(`signature cache request failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    if (kv.putCalls.some((key) => String(key).startsWith("sig:session:"))) {
      throw new Error(`thought signature cache unexpectedly wrote KV: ${JSON.stringify(kv.putCalls)}`);
    }
    console.log("PASS: thought signatures use transient cache without KV writes");
  }

  // 1b. A fresh aggregate quota cache should make `/v1/models` a cheap KV
  // lookup without probing Google or rewriting the aggregate key.
  {
    const account = {
      id: "acc_models",
      email: "models@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      machine_id: "machine-models",
      tokens: {
        access_token: "token-models",
        refresh_token: "refresh-models",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-models"
      }
    };
    const cachedAggregate = {
      accounts: [{ id: "acc_models", quota: { is_forbidden: false } }],
      models: [{ name: "gemini-cached", percentage: 88 }],
      quota_groups: [],
      last_updated: Math.floor(Date.now() / 1000),
      is_forbidden: false
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account])),
      "quota:runtime-user:antigravity": JSON.stringify(cachedAggregate)
    });
    const ctx = makeCtx();
    globalThis.fetch = async () => {
      throw new Error("Google upstream should not be called for a cached model list");
    };

    const response = await worker.fetch(new Request("https://example.test/v1/models", {
      headers: { "Authorization": "Bearer sk-runtime-test" }
    }), { GEMINI_KV: kv }, ctx);
    const data = await response.json();
    await ctx.drain();

    if (response.status !== 200 || data.data?.[0]?.id !== "gemini-cached-agy") {
      throw new Error(`cached model list failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    if (kv.putCalls.length !== 0) {
      throw new Error(`cached model list unexpectedly wrote KV: ${JSON.stringify(kv.putCalls)}`);
    }
    console.log("PASS: cached aggregate quota serves model lists without upstream probes or KV writes");
  }

  // 2. Gemini-native routing must take the model and stream action from the
  // URL because native request bodies do not normally contain `model`.
  {
    const account = {
      id: "acc_native",
      email: "native@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-native",
        refresh_token: "refresh-native",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-native"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const ctx = makeCtx();
    let seenUrl = "";
    globalThis.fetch = async (url) => {
      seenUrl = String(url);
      return successResponse("native-route-ok");
    };

    const response = await worker.fetch(nativeGeminiRequest(), { GEMINI_KV: kv }, ctx);
    const data = await response.json();
    await ctx.drain();

    if (response.status !== 200 || data.response?.candidates?.[0]?.content?.parts?.[0]?.text !== "native-route-ok") {
      throw new Error(`Gemini-native model URL routing failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    if (!seenUrl.includes(":generateContent")) {
      throw new Error(`unexpected Gemini-native upstream method: ${seenUrl}`);
    }
    console.log("PASS: Gemini-native URL model routing works");
  }

  // 3. 429 on the highest-quota account must fail over within the same request.
  {
    const now = Math.floor(Date.now() / 1000);
    const first = {
      id: "acc_primary",
      email: "primary@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: now - 1000,
      cooldown_until: 0,
      machine_id: "machine-primary",
      tokens: {
        access_token: "token-primary",
        refresh_token: "refresh-primary",
        expires_at: now + 3600,
        project_id: "project-primary"
      }
    };
    const second = {
      id: "acc_backup",
      email: "backup@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: now - 100,
      cooldown_until: 0,
      machine_id: "machine-backup",
      tokens: {
        access_token: "token-backup",
        refresh_token: "refresh-backup",
        expires_at: now + 3600,
        project_id: "project-backup"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([first, second])),
      "quota:runtime-user:acc_primary": JSON.stringify({
        models: [{ name: "gemini-test", percentage: 90 }]
      }),
      "quota:runtime-user:acc_backup": JSON.stringify({
        models: [{ name: "gemini-test", percentage: 70 }]
      })
    });
    const seenTokens = [];
    globalThis.fetch = async (_url, init = {}) => {
      const auth = init.headers?.Authorization || init.headers?.authorization || "";
      seenTokens.push(auth);
      if (auth === "Bearer token-primary") {
        return new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60"
          }
        });
      }
      if (auth === "Bearer token-backup") return successResponse("failover-ok");
      throw new Error(`unexpected authorization: ${auth}`);
    };
    const ctx = makeCtx();

    const response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
    const data = await response.json();
    await ctx.drain();
    const storedUser = JSON.parse(kv.store.get("user:runtime-user"));
    const storedPrimary = storedUser.accounts.find((a) => a.id === "acc_primary");
    const storedBackup = storedUser.accounts.find((a) => a.id === "acc_backup");

    if (response.status !== 200 || data.choices?.[0]?.message?.content !== "failover-ok") {
      throw new Error(`same-request account failover failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    if (!seenTokens.includes("Bearer token-primary") || !seenTokens.includes("Bearer token-backup")) {
      throw new Error(`both accounts were not attempted: ${JSON.stringify(seenTokens)}`);
    }
    if (storedPrimary.cooldown_until !== 0 || storedPrimary.status !== "active") {
      throw new Error("429 failover mutated durable account state");
    }
    if (!storedBackup.last_used_at || storedBackup.status !== "active") {
      throw new Error("successful backup account state changed unexpectedly");
    }
    if (kv.putCalls.includes("user:runtime-user")) {
      throw new Error("429 failover unexpectedly wrote the full user object to KV");
    }

    // The transient cooldown must still affect a later request in the same
    // isolate, without relying on a durable user KV write.
    const tokenCountAfterFirstRequest = seenTokens.length;
    const secondResponse = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, makeCtx());
    const secondData = await secondResponse.json();
    const secondAttemptTokens = seenTokens.slice(tokenCountAfterFirstRequest);
    if (secondResponse.status !== 200 || secondData.choices?.[0]?.message?.content !== "failover-ok") {
      throw new Error(`transient cooldown follow-up request failed: HTTP ${secondResponse.status} ${JSON.stringify(secondData)}`);
    }
    if (secondAttemptTokens.includes("Bearer token-primary") || !secondAttemptTokens.includes("Bearer token-backup")) {
      throw new Error(`transient cooldown was not honored on the next request: ${JSON.stringify(secondAttemptTokens)}`);
    }
    if (kv.putCalls.includes("user:runtime-user")) {
      throw new Error("transient cooldown follow-up unexpectedly wrote the full user object to KV");
    }
    console.log("PASS: 429 failover uses transient cooldown without user KV writes");
  }

  // 4. Deleting the last account must clear legacy token mirrors permanently.
  {
    const account = {
      id: "acc_delete",
      email: "delete@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-delete",
        refresh_token: "refresh-delete",
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }
    };
    const kv = new MockKV({
      "session:session-delete": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const ctx = makeCtx();
    const response = await worker.fetch(new Request("https://example.test/api/user/account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": "session_id=session-delete"
      },
      body: JSON.stringify({ action: "delete", id: "acc_delete" })
    }), { GEMINI_KV: kv }, ctx);
    await ctx.drain();
    const data = await response.json();
    const storedUser = JSON.parse(kv.store.get("user:runtime-user"));

    if (!data.success || storedUser.accounts.length !== 0 || storedUser.antigravity_tokens !== null) {
      throw new Error("deleting the final account left a legacy token that would recreate it");
    }
    console.log("PASS: deleting final account does not resurrect legacy credentials");
  }

  // 5. Asynchronous route failures must be caught and returned as JSON, not
  // Cloudflare's opaque error 1101 page.
  {
    const kv = new MockKV();
    kv.get = async () => {
      throw new Error("synthetic asynchronous KV failure");
    };
    const ctx = makeCtx();
    const response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
    const data = await response.json();

    if (response.status !== 500 || data.error?.type !== "internal_worker_error") {
      throw new Error(`async handler rejection escaped route catch: HTTP ${response.status}`);
    }
    console.log("PASS: async route failures are contained as JSON errors");
  }

  // 6. Dashboard values originating from Google profile data must be escaped.
  {
    const account = {
      id: "acc_xss",
      email: "safe@example.test",
      name: "<img src=x onerror=alert(1)>",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-xss",
        refresh_token: "refresh-xss",
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }
    };
    const kv = new MockKV({
      "session:session-xss": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const response = await worker.fetch(new Request("https://example.test/dashboard", {
      headers: { "Cookie": "session_id=session-xss" }
    }), { GEMINI_KV: kv }, makeCtx());
    const html = await response.text();
    const referenceIndex = html.indexOf("参考项目：glowingjade/obsidian-smart-composer；lbjlaq/Antigravity-Manager");
    const addressIndex = html.indexOf("项目地址：");

    if (
      html.includes("<img src=x onerror=alert(1)>") ||
      !html.includes("&lt;img src=x onerror=alert(1)&gt;") ||
      !html.includes("/runtime-test/v1/responses") ||
      !html.includes("OpenAI Chat格式") ||
      !html.includes("制作人：imAndyrrr") ||
      html.includes("制作人：zjq") ||
      !html.includes("glowingjade/obsidian-smart-composer") ||
      !html.includes("lbjlaq/Antigravity-Manager") ||
      !html.includes("模型级配额") ||
      !html.includes("分组配额（共享配额池）") ||
      !html.includes("五小时配额") ||
      !html.includes("周配额") ||
      !html.includes("五小时窗口") ||
      !html.includes("周窗口") ||
      !html.includes("窗口未标注") ||
      addressIndex <= referenceIndex ||
      !html.includes("https://github.com/imAndyrrr/GemPlan")
    ) {
      throw new Error("dashboard did not escape Google profile HTML or show the Responses endpoint");
    }
    console.log("PASS: dashboard escapes account profile values");
  }

  // 7. Malformed protocol requests must return 400 rather than reaching an
  // unhandled property access inside the conversion pipeline.
  {
    const account = {
      id: "acc_validation",
      email: "validation@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-validation",
        refresh_token: "refresh-validation",
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-runtime-test"
      },
      body: JSON.stringify({ model: "gemini-test-agy" })
    }), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();
    if (response.status !== 400 || !String(data.error).includes("messages")) {
      throw new Error(`malformed OpenAI request was not rejected cleanly: ${response.status}`);
    }
    console.log("PASS: malformed protocol requests return structured 400 errors");
  }

  // 8. Responses API requests are translated to the existing upstream
  // protocol, including instructions, input content, tools, and token limits.
  {
    const account = {
      id: "acc_responses",
      email: "responses@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-responses",
        refresh_token: "refresh-responses",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-responses"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    let seenPayload = null;
    globalThis.fetch = async (_url, init = {}) => {
      seenPayload = JSON.parse(init.body);
      return successResponse("responses-ok");
    };
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-runtime-test"
      },
      body: JSON.stringify({
        model: "gemini-test-agy",
        instructions: [{ type: "input_text", text: "Answer briefly." }],
        input: [{
          role: "user",
          content: [{ type: "input_text", text: "reply only OK" }]
        }, {
          type: "function_call",
          id: "fc_previous",
          call_id: "call_previous",
          name: "lookup",
          arguments: "{\"query\":\"prior\"}"
        }, {
          type: "function_call_output",
          call_id: "call_previous",
          output: "prior result"
        }],
        tools: [{
          type: "function",
          name: "lookup",
          description: "Look something up",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"]
          }
        }],
        tool_choice: "required",
        max_output_tokens: 64
      })
    }), { GEMINI_KV: kv }, makeCtx());
    const data = await response.json();
    const requestContents = seenPayload?.request?.contents || [];
    const requestTools = seenPayload?.request?.tools?.[0]?.functionDeclarations || [];
    if (
      response.status !== 200 ||
      data.object !== "response" ||
      data.output_text !== "responses-ok" ||
      data.output?.[0]?.type !== "message" ||
      data.output?.[0]?.content?.[0]?.type !== "output_text" ||
      data.output?.[0]?.content?.[0]?.text !== "responses-ok"
    ) {
      throw new Error(`Responses non-stream response failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    if (
      requestContents.length !== 3 ||
      seenPayload?.request?.systemInstruction?.parts?.[0]?.text !== "Answer briefly." ||
      requestContents[0]?.parts?.[0]?.text !== "reply only OK" ||
      requestContents[1]?.parts?.[0]?.functionCall?.name !== "lookup" ||
      requestContents[1]?.parts?.[0]?.functionCall?.args?.query !== "prior" ||
      requestContents[2]?.parts?.[0]?.functionResponse?.id !== "call_previous" ||
      requestContents[2]?.parts?.[0]?.functionResponse?.response?.result !== "prior result" ||
      seenPayload?.request?.toolConfig?.functionCallingConfig?.mode !== "ANY" ||
      requestTools[0]?.name !== "lookup" ||
      seenPayload?.request?.generationConfig?.maxOutputTokens !== 64
    ) {
      throw new Error(`Responses request was not translated correctly: ${JSON.stringify(seenPayload)}`);
    }
    console.log("PASS: OpenAI Responses non-stream requests and responses work");
  }

  // 8a. Round-trip a signed Gemini tool call through actual Responses output
  // and replay it alongside assistant text, matching the reported part index.
  for (const stream of [false, true]) {
    const account = {
      id: `acc_responses_signature_${stream}`,
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-responses-signature",
        refresh_token: "refresh-responses-signature",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-responses-signature"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const signature = "S".repeat(96);
    const args = { query: "prior", thought_signature: "ordinary argument" };
    let upstreamCalls = 0;
    globalThis.fetch = async (_url, init = {}) => {
      const payload = JSON.parse(init.body);
      assert.equal(payload.model, "gemini-3.8-flash");
      upstreamCalls++;
      if (upstreamCalls === 1) {
        const chunk = {
          response: {
            candidates: [{
              content: {
                role: "model",
                parts: [
                  { thought: true, text: "Need to look up the result." },
                  { text: "Checking." },
                  {
                    functionCall: { id: "call_signed", name: "lookup", args },
                    // Cover both spellings accepted from the upstream.
                    [stream ? "thought_signature" : "thoughtSignature"]: signature
                  }
                ]
              },
              finishReason: "STOP"
            }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 }
          }
        };
        return new Response(stream ? `data: ${JSON.stringify(chunk)}\n\n` : JSON.stringify(chunk), {
          headers: { "Content-Type": stream ? "text/event-stream" : "application/json" }
        });
      }
      assert.equal(upstreamCalls, 2, "tool follow-up should not retry a malformed payload");
      const contents = payload.request.contents;
      assert.equal(contents.length, 3, "full history must survive");
      assert.equal(contents[1].parts[0].text, "Checking.");
      const part = contents[1].parts[1];
      assert.equal(part.thoughtSignature, signature);
      assert.equal(part.thought_signature, signature);
      assert.deepEqual(part.functionCall, { id: "call_signed", name: "lookup", args },
        "upstream FunctionCall must not contain thoughtSignature/thought_signature");
      assert.deepEqual(contents[2].parts[0].functionResponse, {
        id: "call_signed", name: "lookup", response: { result: "prior result" }
      });
      return stream ? successStreamResponse("signed-roundtrip-ok") : successResponse("signed-roundtrip-ok");
    };
    const send = async (input) => {
      const ctx = makeCtx();
      const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-runtime-test" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-agy",
          input,
          stream,
          tools: [{
            type: "function",
            name: "lookup",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, thought_signature: { type: "string" } }
            }
          }]
        })
      }), { GEMINI_KV: kv }, ctx);
      const text = await response.text();
      await ctx.drain();
      assert.equal(response.status, 200, text);
      if (!stream) return JSON.parse(text);
      const completed = text.split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)))
        .find((event) => event.type === "response.completed");
      assert.ok(completed, text);
      return completed.response;
    };
    const input = [{ role: "user", content: "look it up" }];
    const first = await send(input);
    const toolCall = first.output.find((item) => item.type === "function_call");
    assert.equal(toolCall?.call_id, `call_signed|${signature}`);
    const final = await send([
      ...input, ...first.output,
      { type: "function_call_output", call_id: toolCall.call_id, output: "prior result" }
    ]);
    assert.equal(final.output_text, "signed-roundtrip-ok");
    assert.equal(upstreamCalls, 2);
    console.log(`PASS: Responses Gemini 3.8 Flash signed tool round-trip (${stream ? "stream" : "non-stream"})`);
  }

  // 9. Responses streaming uses the event-based SSE protocol and emits a
  // final response object instead of Chat Completions chunks.
  {
    const account = {
      id: "acc_responses_stream",
      email: "responses-stream@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: {
        access_token: "token-responses-stream",
        refresh_token: "refresh-responses-stream",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        project_id: "project-responses-stream"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    globalThis.fetch = async () => successStreamResponse("stream-responses-ok");
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-runtime-test"
      },
      body: JSON.stringify({
        model: "gemini-test-agy",
        input: "reply only OK",
        stream: true
      })
    }), { GEMINI_KV: kv }, makeCtx());
    const body = await response.text();
    const eventData = body.split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));
    const completed = eventData.find((event) => event.type === "response.completed");
    const sequenceNumbers = eventData.map((event) => event.sequence_number);
    const sequenceNumbersValid = sequenceNumbers.every((value, index) =>
      Number.isInteger(value) && (index === 0 || value === sequenceNumbers[index - 1] + 1)
    );
    if (
      response.status !== 200 ||
      response.headers.get("Content-Type") !== "text/event-stream" ||
      !body.includes("event: response.created") ||
      !body.includes("event: response.output_text.delta") ||
      !body.includes("event: response.completed") ||
      body.includes("chat.completion.chunk") ||
      completed?.response?.output_text !== "stream-responses-ok" ||
      completed?.response?.output?.[0]?.content?.[0]?.logprobs?.length !== 0 ||
      !sequenceNumbersValid
    ) {
      throw new Error(`Responses stream failed: HTTP ${response.status} ${body}`);
    }
    const singularResponse = await worker.fetch(new Request("https://example.test/runtime-test/v1/response", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-runtime-test"
      },
      body: JSON.stringify({ model: "gemini-test-agy", input: "should be not found" })
    }), { GEMINI_KV: kv }, makeCtx());
    if (singularResponse.status !== 404) {
      throw new Error(`removed singular Responses route is still active: HTTP ${singularResponse.status}`);
    }
    console.log("PASS: OpenAI Responses streaming events work");
  }
  // 6. A tool schema whose outer placeholder carries an empty `properties`
  // object must reach Google with the anyOf branch definitions merged in. The
  // broken shape `{type:"OBJECT", properties:{}, required:["threadId"]}` is what
  // made Antigravity answer the whole request with 429 RESOURCE_EXHAUSTED.
  {
    const now = Math.floor(Date.now() / 1000);
    const account = {
      id: "acc_schema_merge",
      email: "schema@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-schema",
      tokens: {
        access_token: "token-schema",
        refresh_token: "refresh-schema",
        expires_at: now + 3600,
        project_id: "project-schema"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const sentPayloads = [];
    globalThis.fetch = async (_url, init = {}) => {
      sentPayloads.push(JSON.parse(init.body));
      return successResponse("schema-ok");
    };
    const tool = {
      type: "function",
      function: {
        name: "transfer_voice_call",
        description: "Transfer the active voice call.",
        parameters: {
          type: "object",
          properties: {},
          anyOf: [
            {
              type: "object",
              properties: { context: { type: "string" }, hostId: { type: "string" }, threadId: { type: "string" } },
              required: ["threadId"],
              additionalProperties: false
            },
            {
              type: "object",
              properties: { context: { type: "string" }, return: { type: "boolean", enum: [true] } },
              required: ["return"],
              additionalProperties: false
            }
          ]
        }
      }
    };
    const ctx = makeCtx();
    const response = await worker.fetch(new Request("https://example.test/runtime-test/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-runtime-test" },
      body: JSON.stringify({
        model: "gemini-test-agy",
        messages: [{ role: "user", content: "reply only OK" }],
        stream: false,
        tools: [tool]
      })
    }), { GEMINI_KV: kv }, ctx);
    const data = await response.json();
    await ctx.drain();

    if (response.status !== 200 || data.choices?.[0]?.message?.content !== "schema-ok") {
      throw new Error(`schema merge request failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    }
    const declarations = sentPayloads[0]?.request?.tools?.[0]?.functionDeclarations || [];
    const declaration = declarations.find((item) => item.name === "transfer_voice_call");
    if (!declaration) {
      throw new Error(`tool declaration missing upstream: ${JSON.stringify(declarations.map((d) => d.name))}`);
    }
    const parameters = declaration.parameters || {};
    for (const name of ["threadId", "hostId", "context"]) {
      if (!parameters.properties || !(name in parameters.properties)) {
        throw new Error(`branch property '${name}' never reached Google: ${JSON.stringify(parameters)}`);
      }
      if (parameters.properties[name].type !== "STRING") {
        throw new Error(`property '${name}' was not normalized: ${JSON.stringify(parameters.properties[name])}`);
      }
    }
    if (parameters.type !== "OBJECT" || !Array.isArray(parameters.required) || !parameters.required.includes("threadId")) {
      throw new Error(`schema shape changed: ${JSON.stringify(parameters)}`);
    }
    if ("anyOf" in parameters) throw new Error("anyOf must be collapsed before the upstream call");
    for (const name of parameters.required) {
      if (!(name in parameters.properties)) {
        throw new Error(`dangling required '${name}' reached Google: ${JSON.stringify(parameters)}`);
      }
    }
    console.log("PASS: collapsed anyOf tool schemas reach Google with merged properties");
  }

  // 7. A transient Antigravity 429 must stay inside the shared attempt budget.
  // The old code nested another 3-attempt loop (plus a forced quota refresh)
  // inside each attempt, so one client request could issue ~17 upstream calls
  // and exceed the Worker CPU budget (Cloudflare Error 1102).
  {
    const now = Math.floor(Date.now() / 1000);
    const account = {
      id: "acc_single_429",
      email: "single-429@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-single-429",
      tokens: {
        access_token: "token-single-429",
        refresh_token: "refresh-single-429",
        expires_at: now + 3600,
        project_id: "project-single-429"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account])),
      "quota:runtime-user:acc_single_429": JSON.stringify({
        models: [{ name: "gemini-test", percentage: 55 }],
        last_updated: now
      })
    });
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    };
    const ctx = makeCtx();
    const response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
    const text = await response.text();
    await ctx.drain();

    const generationCalls = urls.filter((url) => /:generateContent|:streamGenerateContent/.test(url));
    const quotaProbes = urls.filter((url) => /loadCodeAssist|fetchAvailableModels|retrieveUserQuotaSummary/.test(url));
    if (response.status !== 429 || !text.includes("RESOURCE_EXHAUSTED")) {
      throw new Error(`upstream 429 must reach the client: HTTP ${response.status} ${text}`);
    }
    if (generationCalls.length > 9) {
      throw new Error(`429 retry storm: ${generationCalls.length} generation calls (expected at most 3 attempts x 3 endpoints)`);
    }
    if (quotaProbes.length !== 0) {
      throw new Error(`429 recovery must reuse the cached quota: ${JSON.stringify(quotaProbes)}`);
    }
    console.log("PASS: transient Antigravity 429 stays within the shared attempt budget");
  }
  // 8. 400 INVALID_ARGUMENT is deterministic: it must not be retried on another
  // endpoint or in the attempt loop. One request should cost exactly one
  // upstream call and hand the upstream message straight to the client.
  {
    const now = Math.floor(Date.now() / 1000);
    const account = {
      id: "acc_400",
      email: "bad-request@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-400",
      tokens: {
        access_token: "token-400",
        refresh_token: "refresh-400",
        expires_at: now + 3600,
        project_id: "project-400"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" }
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    };
    const ctx = makeCtx();
    const response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
    const text = await response.text();
    await ctx.drain();

    if (response.status !== 400 || !text.includes("INVALID_ARGUMENT")) {
      throw new Error(`400 must reach the client unchanged: HTTP ${response.status} ${text}`);
    }
    if (urls.length !== 1) {
      throw new Error(`400 must not be retried, but ${urls.length} upstream calls were made: ${JSON.stringify(urls)}`);
    }
    console.log("PASS: upstream 400 is returned immediately without retries");
  }

  // 9. A single-account 429 must respect the per-request wait budget instead of
  // sleeping through every Retry-After. Timers are recorded, not awaited.
  {
    const now = Math.floor(Date.now() / 1000);
    const account = {
      id: "acc_budget",
      email: "budget@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-budget",
      tokens: {
        access_token: "token-budget",
        refresh_token: "refresh-budget",
        expires_at: now + 3600,
        project_id: "project-budget"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account])),
      "quota:runtime-user:acc_budget": JSON.stringify({
        models: [{ name: "gemini-test", percentage: 55 }],
        last_updated: now
      })
    });
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "30" }
      });
    };
    const realSetTimeout = globalThis.setTimeout;
    const plannedWaits = [];
    globalThis.setTimeout = (fn, ms, ...rest) => {
      plannedWaits.push(Number(ms) || 0);
      return realSetTimeout(fn, 0, ...rest);
    };
    let response;
    let text;
    try {
      const ctx = makeCtx();
      response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
      text = await response.text();
      await ctx.drain();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    const totalWait = plannedWaits.reduce((sum, ms) => sum + ms, 0);
    const generationCalls = urls.filter((url) => /:generateContent|:streamGenerateContent/.test(url)).length;
    if (response.status !== 429 || !text.includes("RESOURCE_EXHAUSTED")) {
      throw new Error(`budgeted 429 must reach the client: HTTP ${response.status} ${text}`);
    }
    if (totalWait > 20000) {
      throw new Error(`wait budget exceeded: ${totalWait}ms planned (${JSON.stringify(plannedWaits)})`);
    }
    if (generationCalls !== 6) {
      throw new Error(`budget must stop after the second attempt: ${generationCalls} generation calls (${JSON.stringify(plannedWaits)})`);
    }
    if (plannedWaits.length === 0) {
      throw new Error("no backoff was planned for a transient 429");
    }
    console.log(`PASS: 429 wait budget caps backoff at ${totalWait}ms (${plannedWaits.length} wait(s), ${generationCalls} upstream calls)`);
  }

  // 10. A cold quota cache must not trigger a quota refresh inside 429 recovery.
  // The recovery path only consults quota data that is already available; a cold
  // cache used to fire project-info/models/quota-summary calls (three more
  // upstream calls per attempt) on an already failing request.
  {
    const now = Math.floor(Date.now() / 1000);
    const account = {
      id: "acc_cold_quota",
      email: "cold-quota@example.test",
      mode: "antigravity",
      enabled: true,
      status: "active",
      last_used_at: 0,
      cooldown_until: 0,
      machine_id: "machine-cold-quota",
      tokens: {
        access_token: "token-cold-quota",
        refresh_token: "refresh-cold-quota",
        expires_at: now + 3600,
        project_id: "project-cold-quota"
      }
    };
    const kv = new MockKV({
      "key:sk-runtime-test": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser([account]))
    });
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" }
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    };
    const ctx = makeCtx();
    const response = await worker.fetch(apiRequest(), { GEMINI_KV: kv }, ctx);
    const text = await response.text();
    await ctx.drain();

    const generationCalls = urls.filter((url) => /:generateContent|:streamGenerateContent/.test(url));
    const quotaProbes = urls.filter((url) => /loadCodeAssist|fetchAvailableModels|retrieveUserQuotaSummary/.test(url));
    if (response.status !== 429 || !text.includes("RESOURCE_EXHAUSTED")) {
      throw new Error(`cold-cache 429 must reach the client: HTTP ${response.status} ${text}`);
    }
    if (quotaProbes.length !== 0) {
      throw new Error(`cold quota cache must not trigger a refresh: ${JSON.stringify(quotaProbes)}`);
    }
    if (generationCalls.length !== 9) {
      throw new Error(`cold-cache 429 must keep the 3 x 3 attempt budget: ${generationCalls.length} generation calls`);
    }
    console.log("PASS: cold quota cache skips the quota refresh during 429 recovery");
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("\nALL WORKER RUNTIME TESTS PASSED!");
