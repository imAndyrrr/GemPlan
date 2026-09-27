// Regression checks that long tool-loop histories remain lossless. Repeated
// calls with only volatile execution metadata changed are preserved exactly;
// collapsing them would save tokens but lose transport evidence and required a
// second full scan of multi-megabyte tool outputs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const code = `
const __name = (f) => f;
const __name2 = (f) => f;
${extract("hasNonWhitespace")}
${extract("responseContentToGeminiParts")}
${extract("responseOutputToGeminiText")}
${extract("decodeToolCallIdentity")}
${extract("safeParseJson")}
${extract("normalizeBase64Data")}
${extract("decodeBase64Window")}
${extract("readImageBytes")}
${extract("base64ByteLength")}
${extract("be32")}
${extract("le32")}
${extract("detectImageFormat")}
${extract("heifBoxesComplete")}
${extract("imagePayloadComplete")}
var IMAGE_FORMAT_MIME = (() => {
  const start = src.indexOf("var IMAGE_FORMAT_MIME = {");
  const end = src.indexOf("\\n};", start);
  return src.slice(start + "var IMAGE_FORMAT_MIME = ".length, end + 2);
})();
${extract("inspectImagePayload")}
${extract("extractImageFromBlock")}
${extract("extractToolResultMediaAndText")}
${extract("responsesRequestToGeminiRequest")}
globalThis.__responses = responsesRequestToGeminiRequest;
`;
new Function("src", code)(src);

const responsesRequestToGeminiRequest = globalThis.__responses;
const signature = "S".repeat(96);
const input = [
  { type: "message", id: "msg_user", role: "user", content: [{ type: "input_text", text: "run it" }] }
];

for (let i = 0; i < 400; i++) {
  const encodedId = `call_repeat_${i}|${signature}`;
  input.push({
    type: "function_call",
    id: `fc_repeat_${i}`,
    call_id: encodedId,
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "same-command" })
  });
  input.push({
    type: "function_call_output",
    id: `fco_repeat_${i}`,
    call_id: encodedId,
    output: `Chunk ID: chunk-${i}\r\nWall time: ${i}ms\r\nOutput:\r\nsame semantic result`
  });
}

const uniqueId = `call_unique|${signature}`;
input.push({
  type: "function_call",
  id: "fc_unique",
  call_id: uniqueId,
  name: "exec_command",
  arguments: JSON.stringify({ cmd: "different-command" })
});
input.push({
  type: "function_call_output",
  id: "fco_unique",
  call_id: uniqueId,
  output: "different semantic result"
});

const original = structuredClone(input);
const result = responsesRequestToGeminiRequest({ input });
assert.deepEqual(input, original, "conversion must not mutate the client's input");
assert.equal(result.collapsedPairCount, 0);
assert.equal(result.contentsAreAntigravityPrepared, true);
assert.equal(result.contents.length, 803, "all 400 repeated call/result pairs must remain in history");

const firstOutput = result.contents[2].parts[0].functionResponse;
const lastRepeatedOutput = result.contents[800].parts[0].functionResponse;
assert.equal(result.contents[1].parts[0].functionCall.id, "call_repeat_0");
assert.equal(result.contents[799].parts[0].functionCall.id, "call_repeat_399");
assert.equal(firstOutput.id, "call_repeat_0");
assert.equal(lastRepeatedOutput.id, "call_repeat_399");
assert.equal(
  lastRepeatedOutput.response.result,
  "Chunk ID: chunk-399\r\nWall time: 399ms\r\nOutput:\r\nsame semantic result"
);
assert.doesNotMatch(lastRepeatedOutput.response.result, /Transport history collapsed/);

const uniqueCall = result.contents[801].parts[0];
const uniqueOutput = result.contents[802].parts[0].functionResponse;
assert.equal(uniqueCall.functionCall.id, "call_unique");
assert.deepEqual(uniqueCall.functionCall.args, { cmd: "different-command" });
assert.equal(uniqueOutput.response.result, "different semantic result");

console.log("PASS: repeated completed tool pairs remain byte-for-byte lossless");
