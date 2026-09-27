// Regression test for multimodal image tool-result extraction and token blowup fix.
import assert from "node:assert/strict";
import zlib from "node:zlib";
import worker from "../src/worker.js";

// ---- minimal PNG writer so tests can build real, structurally complete images ----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}
function makePngBytes(width, height) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const base = y * stride;
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = 255;
      raw[base + 2 + x * 3] = 0;
      raw[base + 3 + x * 3] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

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

const sampleBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function runTest() {
  let lastUpstreamPayload = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes("googleapis.com") || urlStr.includes("cloudaicompanion")) {
      if (opts?.body) {
        try { lastUpstreamPayload = JSON.parse(opts.body); } catch (_) {}
      }
      return new Response(JSON.stringify({
        response: {
          candidates: [{
            content: { role: "model", parts: [{ text: "I see a red square." }] },
            finishReason: "STOP"
          }],
          usageMetadata: {
            promptTokenCount: 258,
            candidatesTokenCount: 10,
            totalTokenCount: 268
          }
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

    // Test 1: OpenAI chat/completions with stringified tool_result containing raw newline
    {
      lastUpstreamPayload = null;
      const stringifiedWithNewline = `[{\n  "type": "input_image",\n  "image_url": "data:image/png;base64,${sampleBase64}"\n}]`;
      const req = new Request("https://example.test/test-user/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-test-key"
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash-agy",
          messages: [
            { role: "user", content: "view image" },
            {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_view_img_1",
                type: "function",
                function: { name: "view_image", arguments: "{\"path\":\"test.png\"}" }
              }]
            },
            {
              role: "tool",
              tool_call_id: "call_view_img_1",
              content: stringifiedWithNewline
            }
          ],
          stream: false
        })
      });

      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "Request should succeed");
      assert.ok(lastUpstreamPayload, "Upstream payload captured");
      
      console.log("Payload keys:", Object.keys(lastUpstreamPayload || {}));
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const toolTurn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      assert.ok(toolTurn, "Found user turn with functionResponse");
      assert.equal(toolTurn.parts.length, 1, "Must have exactly 1 functionResponse part (no duplicate sibling parts)");

      const fr = toolTurn.parts[0].functionResponse;
      assert.equal(fr.name, "view_image");
      assert.equal(fr.id, "call_view_img_1");
      assert.ok(fr.parts && fr.parts.length === 1, "Multimodal parts must be placed inside functionResponse.parts");
      assert.equal(fr.parts[0].inlineData?.mimeType, "image/png");
      assert.equal(fr.parts[0].inlineData?.data, sampleBase64);
      assert.ok(!JSON.stringify(fr.response).includes(sampleBase64), "Base64 data must NOT leak into functionResponse.response text");
      console.log("PASS: OpenAI stringified tool_result with newlines correctly converted to multimodal functionResponse");
    }

    // Test 2: Claude messages API with image block in tool_result
    {
      lastUpstreamPayload = null;
      const req = new Request("https://example.test/test-user/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-test-key"
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash-agy",
          messages: [
            { role: "user", content: "view image" },
            {
              role: "assistant",
              content: [{
                type: "tool_use",
                id: "toolu_01_abc",
                name: "view_image",
                input: { path: "test.png" }
              }]
            },
            {
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: "toolu_01_abc",
                content: [
                  { type: "image", source: { type: "base64", media_type: "image/png", data: sampleBase64 } },
                  { type: "text", text: "Image successfully loaded" }
                ]
              }]
            }
          ]
        })
      });

      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "Claude request should succeed");
      assert.ok(lastUpstreamPayload, "Upstream payload captured");

      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const toolTurn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      assert.ok(toolTurn, "Found user turn with functionResponse");
      assert.equal(toolTurn.parts.length, 1, "Must have exactly 1 functionResponse part (no sibling inlineData)");

      const fr = toolTurn.parts[0].functionResponse;
      assert.equal(fr.name, "view_image");
      assert.equal(fr.id, "toolu_01_abc");
      assert.ok(fr.parts && fr.parts.length === 1, "Image correctly placed inside functionResponse.parts");
      assert.equal(fr.parts[0].inlineData?.data, sampleBase64);
      assert.ok(!JSON.stringify(fr.response).includes(sampleBase64), "Base64 data must NOT leak into response text");
      console.log("PASS: Claude tool_result with image correctly converted to multimodal functionResponse");
    }

    // Test 3: a data URI inside plain text must stay text. The caller may be sending
    // base64 on purpose (asking the model to analyse it, quoting a log or source code),
    // so the proxy must not reinterpret it as an image attachment.
    {
      lastUpstreamPayload = null;
      const rawText = "Screenshot captured: data:image/jpeg;base64," + sampleBase64;
      const req = new Request("https://example.test/test-user/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer sk-test-key"
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash-agy",
          messages: [
            { role: "user", content: "view image" },
            {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_raw_data_uri",
                type: "function",
                function: { name: "take_screenshot", arguments: "{}" }
              }]
            },
            {
              role: "tool",
              tool_call_id: "call_raw_data_uri",
              content: rawText
            }
          ],
          stream: false
        })
      });

      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "Request should succeed");
      assert.ok(lastUpstreamPayload, "Upstream payload captured");

      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const toolTurn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      assert.ok(toolTurn, "Found user turn with functionResponse");
      assert.equal(toolTurn.parts.length, 1, "Must have exactly 1 functionResponse part");

      const fr = toolTurn.parts[0].functionResponse;
      assert.ok(!(fr.parts && fr.parts.length > 0), "plain text must not be converted into an image attachment");
      assert.equal(fr.response.result, rawText, "plain text must be forwarded verbatim");
      console.log("PASS: data URI embedded in plain text stays text (no reinterpretation)");
    }

    // Test 4: Plain-text tool output must be preserved byte-for-byte
    {
      lastUpstreamPayload = null;
      const plain = "total 12\ndrwxr-xr-x  3 user 1.0K Sep 19 .\n-rw-r--r--  1 user  512 Sep 19 file.txt";
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-high-agy",
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
            { type: "function_call", call_id: "call_ls", name: "exec_command", arguments: "{}" },
            { type: "function_call_output", call_id: "call_ls", output: plain }
          ],
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "plain text tool output request should succeed");
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      const fr = turn.parts.find(p => p.functionResponse).functionResponse;
      assert.equal(fr.response.result, plain, "plain text tool output must be preserved verbatim");
      console.log("PASS: plain-text tool output preserved verbatim");
    }

    // Test 5: JSON array/object tool output must not be silently dropped
    {
      for (const output of ["[{\"severity\":\"ok\",\"path\":\"a.ts\"}]", "{\"status\":\"success\",\"count\":3}"]) {
        lastUpstreamPayload = null;
        const req = new Request("https://example.test/test-user/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
          body: JSON.stringify({
            model: "gemini-3.8-flash-high-agy",
            input: [
              { type: "message", role: "user", content: [{ type: "input_text", text: "run tool" }] },
              { type: "function_call", call_id: "call_j", name: "exec_command", arguments: "{}" },
              { type: "function_call_output", call_id: "call_j", output }
            ],
            stream: false
          })
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 200, "json tool output request should succeed");
        const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
        const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
        const fr = turn.parts.find(p => p.functionResponse).functionResponse;
        assert.equal(fr.response.result, output, "JSON tool output must be preserved, not dropped: " + output);
      }
      console.log("PASS: JSON array/object tool output preserved (not dropped)");
    }

    // Test 6: truncated/corrupted base64 must never become inlineData (upstream would
    // reject the whole request with "Base64 decoding failed"), and must not leak the blob.
    {
      const truncated = "iVBORw0KGgoAAAANSUhEUgAAAZAAAAEsCAIAAABi1X";
      const cases = [
        { label: "openai stringified", expectOmitted: true, url: "https://example.test/test-user/v1/chat/completions", body: {
            model: "gemini-3.8-flash-high-agy",
            messages: [
              { role: "user", content: "view the image" },
              { role: "assistant", content: null, tool_calls: [{ id: "call_t", type: "function", function: { name: "view_image", arguments: "{}" } }] },
              { role: "tool", tool_call_id: "call_t", content: "[{\"type\":\"input_image\",\"image_url\":\"data:image/png;base64," + truncated + "\"}]" }
            ],
            stream: false
          } },
        { label: "responses output", expectOmitted: false, url: "https://example.test/test-user/v1/responses", body: {
            model: "gemini-3.8-flash-high-agy",
            input: [
              { type: "message", role: "user", content: [{ type: "input_text", text: "view the image" }] },
              { type: "function_call", call_id: "call_t", name: "view_image", arguments: "{}" },
              { type: "function_call_output", call_id: "call_t", output: "screenshot: data:image/png;base64," + truncated }
            ],
            stream: false
          } }
      ];
      for (const tc of cases) {
        lastUpstreamPayload = null;
        const req = new Request(tc.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
          body: JSON.stringify(tc.body)
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 200, tc.label + ": request should succeed");
        const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
        const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
        const fr = turn.parts.find(p => p.functionResponse).functionResponse;
        assert.ok(!(fr.parts && fr.parts.length > 0), tc.label + ": an incomplete image must never be forwarded as media");
        if (tc.expectOmitted) {
          // Declared as an image block but not decodable: report the omission instead of
          // sending invalid bytes upstream.
          assert.ok(/omitted/i.test(String(fr.response && fr.response.result)), tc.label + ": should explain the omission");
          assert.ok(!JSON.stringify(fr).includes(truncated), tc.label + ": raw blob must not be echoed into the payload");
        } else {
          // Not declared as an image: faithful text passthrough.
          assert.ok(String(fr.response.result).includes(truncated), tc.label + ": text must be forwarded verbatim");
        }
      }
      console.log("PASS: incomplete images are never forwarded as inlineData");
    }

    // Test 7: a data URI followed by trailing prose is still just text - nothing may be
    // swallowed or reinterpreted.
    {
      lastUpstreamPayload = null;
      const trailingText = "and here is extra analysis text after the screenshot.";
      const rawText = "Screenshot: data:image/png;base64," + sampleBase64 + " " + trailingText;
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-high-agy",
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "capture" }] },
            { type: "function_call", call_id: "c_trailing", name: "snap", arguments: "{}" },
            { type: "function_call_output", call_id: "c_trailing", output: rawText }
          ],
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "trailing text request should succeed");
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      const fr = turn.parts.find(p => p.functionResponse).functionResponse;
      assert.ok(!(fr.parts && fr.parts.length > 0), "text must not become an image attachment");
      assert.equal(fr.response.result, rawText, "text (including the data URI) must be preserved verbatim");
      console.log("PASS: data URI with trailing text preserved verbatim as text");
    }

    // Test 8: Mixed JSON array preserving non-OpenAI metadata objects
    {
      lastUpstreamPayload = null;
      const mixedArray = JSON.stringify([
        { type: "text", text: "Summary report" },
        { errors: 0, warnings: 2, file: "app.ts" }
      ]);
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-high-agy",
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "check" }] },
            { type: "function_call", call_id: "c_mixed", name: "linter", arguments: "{}" },
            { type: "function_call_output", call_id: "c_mixed", output: mixedArray }
          ],
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "mixed array request should succeed");
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      const fr = turn.parts.find(p => p.functionResponse).functionResponse;
      assert.ok(fr.response.result.includes("Summary report"), "text block preserved");
      assert.ok(fr.response.result.includes('"errors":0'), "metadata object preserved: " + fr.response.result);
      console.log("PASS: Mixed JSON array preserves non-OpenAI metadata objects");
    }

    // Test 9: a real, complete PNG that is DECLARED as an image block must be forwarded;
    // the same bytes sitting in plain text must stay text.
    {
      const fullPng = makePngBytes(64, 64).toString("base64");
      const variants = [
        { label: "declared image block", expectImage: true,
          output: JSON.stringify([{ type: "input_image", image_url: "data:image/png;base64," + fullPng }]) },
        { label: "same bytes as plain text", expectImage: false,
          output: "data:image/png;base64," + fullPng }
      ];
      for (const variant of variants) {
        lastUpstreamPayload = null;
        const req = new Request("https://example.test/test-user/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
          body: JSON.stringify({
            model: "gemini-3.8-flash-high-agy",
            input: [
              { type: "message", role: "user", content: [{ type: "input_text", text: "render" }] },
              { type: "function_call", call_id: "c_big", name: "render", arguments: "{}" },
              { type: "function_call_output", call_id: "c_big", output: variant.output }
            ],
            stream: false
          })
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 200, variant.label + ": request should succeed");
        const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
        const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
        const fr = turn.parts.find(p => p.functionResponse).functionResponse;
        if (variant.expectImage) {
          assert.ok(fr.parts && fr.parts.length === 1, variant.label + ": complete declared image must be forwarded");
          assert.equal(fr.parts[0].inlineData?.mimeType, "image/png");
          assert.equal(fr.parts[0].inlineData?.data, fullPng);
        } else {
          assert.ok(!(fr.parts && fr.parts.length > 0), variant.label + ": plain text must not become an attachment");
          assert.equal(fr.response.result, variant.output, variant.label + ": text must be verbatim");
        }
      }
      console.log("PASS: declared image forwarded; identical bytes as text stay text");
    }

    // Test 10: a declared image cut mid-stream must be rejected even though it stays
    // valid base64 of valid length with an intact PNG header.
    {
      lastUpstreamPayload = null;
      const fullPng = makePngBytes(96, 96).toString("base64");
      const cut = fullPng.slice(0, Math.floor(fullPng.length * 0.7) & ~3); // keep %4===0
      assert.ok(!cut.endsWith("="), "truncated fixture should not carry padding");
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-high-agy",
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "render" }] },
            { type: "function_call", call_id: "c_cut", name: "render", arguments: "{}" },
            { type: "function_call_output", call_id: "c_cut", output: JSON.stringify([{ type: "input_image", image_url: "data:image/png;base64," + cut }]) }
          ],
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "truncated large PNG request should succeed");
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      const fr = turn.parts.find(p => p.functionResponse).functionResponse;
      assert.ok(!(fr.parts && fr.parts.length > 0), "truncated large PNG must not be forwarded");
      assert.ok(/omitted/i.test(String(fr.response.result)), "should explain the omission");
      console.log("PASS: large mid-stream-truncated declared image rejected");
    }

    // Test 11: the fragment shape that broke this session, arriving as ordinary text,
    // is now simply text - it is never turned into an image, and never rewritten.
    {
      const sessionFragment = "iVBORw0KGgoAAAANSUhEUgAAAZAA"; // 28 chars, valid base64, decoded bytes are garbage
      assert.equal(sessionFragment.length % 4, 0);
      lastUpstreamPayload = null;
      const rawText = `log line: image_url="data:image/png;base64,${sessionFragment}" and more text`;
      const req = new Request("https://example.test/test-user/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-high-agy",
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "what does the log say" }] },
            { type: "function_call", call_id: "c_frag", name: "read_log", arguments: "{}" },
            { type: "function_call_output", call_id: "c_frag", output: rawText }
          ],
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "fragment request should succeed");
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const turn = contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
      const fr = turn.parts.find(p => p.functionResponse).functionResponse;
      assert.ok(!(fr.parts && fr.parts.length > 0), "session-style fragment must never be forwarded as an image");
      assert.equal(fr.response.result, rawText, "log text must be forwarded verbatim");
      console.log("PASS: session-style fragment passes through as plain text");
    }

    // Test 12: top-level Claude image blocks go through the same structural validation.
    {
      lastUpstreamPayload = null;
      const req = new Request("https://example.test/test-user/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-test-key" },
        body: JSON.stringify({
          model: "gemini-3.8-flash-agy",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "look at this" },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "iVBORw0KGgoAAAANSUhEUgAAAZAA" } }
            ]
          }],
          stream: false
        })
      });
      const res = await worker.fetch(req, env, ctx);
      assert.equal(res.status, 200, "claude top-level truncated image request should succeed");
      const contents = lastUpstreamPayload.contents || lastUpstreamPayload.requests?.[0]?.contents || lastUpstreamPayload.request?.contents;
      const serialized = JSON.stringify(contents);
      assert.ok(!serialized.includes("iVBORw0KGgoAAAANSUhEUgAAAZAA"), "truncated claude image block must be dropped");
      console.log("PASS: top-level Claude image block validated");
    }

    console.log("\nALL MULTIMODAL TOOL RESULT TESTS PASSED!");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
