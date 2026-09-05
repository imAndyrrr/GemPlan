// Regression checks for preserving a Gemini thought signature through an
// OpenAI-compatible tool-call round trip.
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
${extract("encodeToolCallIdentity")}
${extract("decodeToolCallIdentity")}
globalThis.__fns = { encodeToolCallIdentity, decodeToolCallIdentity };
`;
new Function(code)();
const { encodeToolCallIdentity, decodeToolCallIdentity } = globalThis.__fns;

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
