// Regression checks for preserving a Gemini thought signature through an
// OpenAI-compatible tool-call round trip.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

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
${extract("encodeToolCallIdentity")}
${extract("decodeToolCallIdentity")}
${extract("hasNonWhitespace")}
${extract("responseContentToGeminiParts")}
${extract("responseOutputToGeminiText")}
${extract("responsesRequestToGeminiRequest")}
${extract("prepareAntigravityContents")}
globalThis.__fns = {
  encodeToolCallIdentity, decodeToolCallIdentity,
  responsesRequestToGeminiRequest, prepareAntigravityContents
};
`;
new Function(code)();
const {
  encodeToolCallIdentity, decodeToolCallIdentity,
  responsesRequestToGeminiRequest, prepareAntigravityContents
} = globalThis.__fns;

const signature = "A".repeat(96);
const encoded = encodeToolCallIdentity("call_219796", signature);
if (encoded !== `call_219796|${signature}`) {
  throw new Error("real signature was not attached to the tool-call identity");
}

const decoded = decodeToolCallIdentity(encoded);
if (decoded.id !== "call_219796" || decoded.thoughtSignature !== signature) {
  throw new Error("tool-call identity did not round-trip exactly");
}

if (encodeToolCallIdentity("call_plain", "short") !== "call_plain") {
  throw new Error("short/synthetic signature should not change the public ID");
}
const plain = decodeToolCallIdentity("call_plain");
if (plain.id !== "call_plain" || plain.thoughtSignature !== null) {
  throw new Error("plain tool-call identity was changed");
}

console.log("PASS: real thought signatures survive OpenAI tool-call ID round trips");

// Reproduce the reported contents[1].parts[1].function_call error: a text
// message and signed tool call share the model turn. Signature metadata belongs
// to Part, never FunctionCall; it must also beat any stale session cache.
for (const useFallbackId of [false, true]) {
  const args = {
    query: "prior",
    thoughtSignature: "ordinary tool argument",
    nested: { thought_signature: "also an ordinary argument" }
  };
  const input = [
    { role: "user", content: "look it up" },
    { role: "assistant", content: [{ type: "output_text", text: "Checking." }] },
    {
      type: "function_call",
      ...(useFallbackId ? { id: encoded } : { id: "fc_previous", call_id: encoded }),
      name: "lookup",
      arguments: JSON.stringify(args)
    },
    { type: "function_call_output", call_id: encoded, output: "prior result" },
    { type: "function_call", call_id: "call_plain", name: "legacy", arguments: "{}" },
    { type: "function_call_output", call_id: "call_plain", output: "legacy result" }
  ];
  const original = structuredClone(input);
  const { contents } = responsesRequestToGeminiRequest({ input });
  assert.deepEqual(input, original, "conversion must not alter input history");
  assert.deepEqual(contents.map((c) => c.role), ["user", "model", "user", "model", "user"]);
  assert.equal(contents[1].parts[0].text, "Checking.");
  const part = contents[1].parts[1];
  assert.equal(part.thoughtSignature, signature, "Responses signature must be on Part");
  assert.equal(part.thought_signature, signature);
  assert.deepEqual(part.functionCall, { id: "call_219796", name: "lookup", args });
  assert.deepEqual(contents[2].parts[0].functionResponse, {
    id: "call_219796", name: "lookup", response: { result: "prior result" }
  });
  assert.equal(contents[3].parts[0].thoughtSignature, undefined);
  for (const mutateInPlace of [false, true]) {
    const prepared = prepareAntigravityContents(structuredClone(contents), "stale-cache", true, mutateInPlace);
    assert.equal(prepared[1].parts[1].thoughtSignature, signature);
    assert.deepEqual(prepared[1].parts[1].functionCall, part.functionCall);
    assert.equal(prepared[3].parts[0].thoughtSignature, "stale-cache");
  }
}
console.log("PASS: Responses restores signed call_id/id metadata on Part without altering tool history");
