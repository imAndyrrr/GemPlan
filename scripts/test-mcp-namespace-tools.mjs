import assert from "node:assert/strict";
import worker from "../src/worker.js";

class MockKV {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
  }
  async get(key, type) {
    const val = this.store.get(key);
    if (val == null) return null;
    if (type === "json") return typeof val === "string" ? JSON.parse(val) : structuredClone(val);
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  async put(key, val) {
    this.store.set(key, val);
  }
  async delete(key) {
    this.store.delete(key);
  }
}

function makeCtx() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    async drain() { await Promise.allSettled(pending); }
  };
}

function makeUser() {
  return {
    password_hash: "unused",
    accounts: [{
      id: "acc_mcp_test",
      email: "mcp@example.test",
      mode: "antigravity",
      status: "active",
      priority: 1,
      tokens: {
        access_token: "token-mcp",
        refresh_token: "refresh-mcp",
        expires_at: Date.now() + 3600000,
        project_id: "project-mcp"
      }
    }],
    machine_id: "machine-mcp",
    google_tokens: null,
    antigravity_tokens: {
      access_token: "token-mcp",
      refresh_token: "refresh-mcp",
      expires_at: Date.now() + 3600000,
      project_id: "project-mcp"
    },
    api_config: {
      custom_path: "mcp-test",
      api_key: "sk-mcp-test",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

async function runTests() {
  const user = makeUser();
  const kv = new MockKV({
    "key:sk-mcp-test": "admin",
    "user:admin": JSON.stringify(user)
  });

  let interceptedPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (typeof options.body === "string") {
      try {
        interceptedPayload = JSON.parse(options.body);
      } catch (_) {}
    }
    return new Response(JSON.stringify({
      response: {
        candidates: [{
          content: { role: "model", parts: [{ text: "mcp-ok" }] },
          finishReason: "STOP"
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 2,
          totalTokenCount: 12
        }
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  // 1. Test /v1/responses endpoint with mixed top-level functions and nested namespace tools
  const responsesReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [{ role: "user", content: [{ type: "input_text", text: "search info" }] }],
      tools: [
        {
          type: "function",
          name: "exec_command",
          description: "Execute a shell command",
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
            required: ["cmd"]
          }
        },
        {
          type: "namespace",
          name: "mcp__web_search",
          description: "Tools in the mcp__web_search namespace.",
          tools: [
            {
              type: "function",
              name: "search_web",
              description: "Search the web using Google",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"]
              }
            },
            {
              type: "function",
              name: "fetch_url",
              description: "Fetch web page content",
              parameters: {
                type: "object",
                properties: { url: { type: "string" } },
                required: ["url"]
              }
            }
          ]
        }
      ]
    })
  });

  const res1 = await worker.fetch(responsesReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res1.status, 200, `Expected 200 but got ${res1.status}`);
  const data1 = await res1.json();
  assert.equal(data1.output_text, "mcp-ok");

  const decls1 = interceptedPayload?.request?.tools?.[0]?.functionDeclarations || [];
  assert.equal(decls1.length, 3, `Expected 3 functionDeclarations but got ${decls1.length}`);
  const names1 = decls1.map((d) => d.name);
  assert.ok(names1.includes("exec_command"), "Missing exec_command");
  assert.ok(names1.includes("mcp__web_search__search_web"), "Missing mcp__web_search__search_web from namespace");
  assert.ok(names1.includes("mcp__web_search__fetch_url"), "Missing mcp__web_search__fetch_url from namespace");
  console.log("PASS: Responses endpoint unpacks and normalizes type: 'namespace' MCP tools with global prefixing");

  // 2. Test /v1/chat/completions endpoint with nested namespace tools
  interceptedPayload = null;
  const chatReq = new Request("https://example.test/mcp-test/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "namespace",
          name: "mcp__windows",
          tools: [
            {
              type: "function",
              function: {
                name: "click_mouse",
                description: "Click at coordinates",
                parameters: { type: "object", properties: { x: { type: "number" } } }
              }
            }
          ]
        }
      ]
    })
  });

  const res2 = await worker.fetch(chatReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res2.status, 200, `Expected 200 but got ${res2.status}`);
  const decls2 = interceptedPayload?.request?.tools?.[0]?.functionDeclarations || [];
  assert.equal(decls2.length, 1);
  assert.equal(decls2[0].name, "mcp__windows__click_mouse");
  console.log("PASS: Chat completions unpacks and normalizes type: 'namespace' MCP tools with prefixing");

  // 3. Test deeply nested namespaces
  interceptedPayload = null;
  const nestedReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [{ role: "user", content: [{ type: "input_text", text: "test" }] }],
      tools: [
        {
          type: "namespace",
          name: "outer",
          tools: [
            {
              type: "namespace",
              name: "inner",
              tools: [
                {
                  type: "function",
                  name: "deep_tool",
                  parameters: { type: "object" }
                }
              ]
            }
          ]
        }
      ]
    })
  });

  const res3 = await worker.fetch(nestedReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res3.status, 200);
  const decls3 = interceptedPayload?.request?.tools?.[0]?.functionDeclarations || [];
  assert.equal(decls3.length, 1);
  assert.equal(decls3[0].name, "inner__deep_tool");
  console.log("PASS: Multi-level nested namespaces are fully flattened and prefixed");

  // 4. Test tools with non-string enum (e.g. enum: [true] or const: true)
  interceptedPayload = null;
  const invalidEnumReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [{ role: "user", content: [{ type: "input_text", text: "test" }] }],
      tools: [
        {
          type: "function",
          name: "create_worktree",
          description: "Create worktree",
          parameters: {
            type: "object",
            properties: {
              allowAsync: {
                type: "boolean",
                description: "Allow async",
                enum: [true]
              },
              mode: {
                type: "string",
                enum: ["fast", "slow"]
              },
              count: {
                type: "integer",
                enum: [1, 2, 3]
              },
              fixedFlag: {
                const: true
              }
            }
          }
        }
      ]
    })
  });

  const res4 = await worker.fetch(invalidEnumReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res4.status, 200);
  const decls4 = interceptedPayload?.request?.tools?.[0]?.functionDeclarations || [];
  assert.equal(decls4.length, 1);
  const props4 = decls4[0].parameters.properties;
  assert.equal(props4.allowAsync.type, "BOOLEAN");
  assert.equal(props4.allowAsync.enum, undefined, "allowAsync.enum should be stripped for BOOLEAN");
  assert.equal(props4.mode.type, "STRING");
  assert.deepEqual(props4.mode.enum, ["fast", "slow"], "mode.enum should be preserved for STRING");
  assert.equal(props4.count.type, "INTEGER");
  assert.equal(props4.count.enum, undefined, "count.enum should be stripped for INTEGER");
  assert.equal(props4.fixedFlag.type, "BOOLEAN");
  assert.equal(props4.fixedFlag.enum, undefined, "fixedFlag.enum should be stripped for BOOLEAN const");
  console.log("PASS: Non-string enums and boolean consts are cleanly sanitized for Google Gemini");

  // 5. Test colliding tool names across multiple namespaces (e.g. mcp__cua_repl.js vs mcp__node_repl.js)
  interceptedPayload = null;
  const duplicateReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [{ role: "user", content: [{ type: "input_text", text: "test duplicates" }] }],
      tools: [
        {
          type: "namespace",
          name: "mcp__cua_repl",
          tools: [
            { type: "function", name: "js", parameters: { type: "object" } },
            { type: "function", name: "js_reset", parameters: { type: "object" } }
          ]
        },
        {
          type: "namespace",
          name: "mcp__node_repl",
          tools: [
            { type: "function", name: "js", parameters: { type: "object" } },
            { type: "function", name: "js_reset", parameters: { type: "object" } },
            { type: "function", name: "unique_node_tool", parameters: { type: "object" } }
          ]
        }
      ]
    })
  });

  const res5 = await worker.fetch(duplicateReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res5.status, 200);
  const decls5 = interceptedPayload?.request?.tools?.[0]?.functionDeclarations || [];
  assert.equal(decls5.length, 5);
  const names5 = decls5.map(d => d.name);
  assert.ok(names5.includes("mcp__cua_repl__js"), "mcp__cua_repl__js should be disambiguated");
  assert.ok(names5.includes("mcp__node_repl__js"), "mcp__node_repl__js should be disambiguated");
  assert.ok(names5.includes("mcp__cua_repl__js_reset"), "mcp__cua_repl__js_reset should be disambiguated");
  assert.ok(names5.includes("mcp__node_repl__js_reset"), "mcp__node_repl__js_reset should be disambiguated");
  assert.ok(names5.includes("mcp__node_repl__unique_node_tool"), "All tools under namespaces receive global prefixing");
  console.log("PASS: All tools under namespaces receive global prefixing (Antigravity style)");

  // 6. Test response_format with array types (type: ["string", "null"])
  interceptedPayload = null;
  const schemaReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [{ role: "user", content: [{ type: "input_text", text: "memory test" }] }],
      text: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              rollout_slug: { type: ["string", "null"] },
              raw_memory: { type: "string" }
            }
          }
        }
      }
    })
  });

  const res6 = await worker.fetch(schemaReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res6.status, 200);
  const respSchema = interceptedPayload?.request?.generationConfig?.responseSchema;
  assert.equal(respSchema.properties.rollout_slug.type, "string");
  assert.equal(respSchema.properties.rollout_slug.nullable, true);
  console.log("PASS: Response schema array type ['string', 'null'] is cleaned to string + nullable: true");

  // 7. Test Responses endpoint returning function_call with correct namespace in JSON
  globalThis.fetch = async (url, options = {}) => {
    return new Response(JSON.stringify({
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{
              functionCall: {
                name: "mcp__web_search__search_web",
                args: { query: "Termux" }
              }
            }]
          },
          finishReason: "STOP"
        }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8, totalTokenCount: 23 }
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const fcReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [{ role: "user", content: [{ type: "input_text", text: "search Termux" }] }],
      tools: [
        {
          type: "function",
          name: "exec_command",
          parameters: { type: "object" }
        },
        {
          type: "namespace",
          name: "mcp__web_search",
          tools: [
            {
              type: "function",
              name: "search_web",
              parameters: { type: "object", properties: { query: { type: "string" } } }
            }
          ]
        }
      ]
    })
  });

  const res7 = await worker.fetch(fcReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res7.status, 200);
  const data7 = await res7.json();
  const toolCall7 = data7.output?.find(item => item.type === "function_call");
  assert.ok(toolCall7, "Should have function_call in output");
  assert.equal(toolCall7.name, "search_web");
  assert.equal(toolCall7.namespace, "mcp__web_search", "function_call must have namespace 'mcp__web_search'");
  console.log("PASS: Non-streaming Responses function_call correctly populated with namespace");

  // 8. Test Responses SSE stream returning function_call with correct namespace
  globalThis.fetch = async (url, options = {}) => {
    const sseBody = [
      `data: ${JSON.stringify({
        response: {
          candidates: [{
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  name: "mcp__web_search__search_web",
                  args: { query: "Termux stream" }
                }
              }]
            },
            finishReason: "STOP"
          }],
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8, totalTokenCount: 23 }
        }
      })}\n\n`,
      "data: [DONE]\n\n"
    ].join("");

    return new Response(sseBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  };

  const sseReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: "search Termux" }] }],
      tools: [
        {
          type: "namespace",
          name: "mcp__web_search",
          tools: [
            {
              type: "function",
              name: "search_web",
              parameters: { type: "object", properties: { query: { type: "string" } } }
            }
          ]
        }
      ]
    })
  });

  const res8 = await worker.fetch(sseReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res8.status, 200);
  const sseText = await res8.text();
  assert.ok(sseText.includes('"namespace":"mcp__web_search"'), "SSE event must contain namespace 'mcp__web_search'");
  console.log("PASS: Streaming Responses SSE function_call correctly populated with namespace");

  // 9. Test disambiguated tool restored to original name + namespace on output,
  //    and multi-turn input history with namespace mapped back to upstream disambiguated name
  interceptedPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (typeof options.body === "string") {
      try {
        interceptedPayload = JSON.parse(options.body);
      } catch (_) {}
    }
    return new Response(JSON.stringify({
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{
              functionCall: {
                name: "mcp__cua_repl__js",
                args: { code: "console.log(1)" }
              }
            }]
          },
          finishReason: "STOP"
        }]
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const disambigReq = new Request("https://example.test/mcp-test/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-mcp-test"
    },
    body: JSON.stringify({
      model: "gemini-3.8-flash-high-agy",
      input: [
        {
          type: "function_call",
          call_id: "call_history_1",
          name: "js",
          namespace: "mcp__cua_repl",
          arguments: "{\"code\":\"init()\"}"
        },
        {
          type: "function_call_output",
          call_id: "call_history_1",
          output: "ok"
        }
      ],
      tools: [
        {
          type: "namespace",
          name: "mcp__cua_repl",
          tools: [{ type: "function", name: "js", parameters: { type: "object" } }]
        },
        {
          type: "namespace",
          name: "mcp__node_repl",
          tools: [{ type: "function", name: "js", parameters: { type: "object" } }]
        }
      ]
    })
  });

  const res9 = await worker.fetch(disambigReq, { GEMINI_KV: kv }, makeCtx());
  assert.equal(res9.status, 200);
  const data9 = await res9.json();
  const toolCall9 = data9.output?.find(item => item.type === "function_call");
  assert.equal(toolCall9.name, "js", "Output name must be original name 'js'");
  assert.equal(toolCall9.namespace, "mcp__cua_repl", "Output namespace must be 'mcp__cua_repl'");

  // Verify input history sent upstream mapped back to mcp__cua_repl__js
  const upstreamContents = interceptedPayload?.request?.contents || [];
  const historyFc = upstreamContents.find(c => c.role === "model")?.parts?.find(p => p.functionCall);
  assert.equal(historyFc.functionCall.name, "mcp__cua_repl__js", "History function_call name sent upstream must be disambiguated name");
  console.log("PASS: Disambiguated tools restored on output and mapped correctly from input history");
}

await runTests();
