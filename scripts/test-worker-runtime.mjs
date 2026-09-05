// End-to-end Worker regression tests with mocked KV and Google upstream.
// These tests exercise the actual exported fetch handler rather than isolated
// helpers, so route-level async exceptions and account failover are covered.
import { readFileSync } from "node:fs";
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
} finally {
  globalThis.fetch = originalFetch;
}

console.log("\nALL WORKER RUNTIME TESTS PASSED!");
