// Regression checks for the single-pass Antigravity history preparation.
// It must preserve ordinary parts, attach the protocol signature metadata
// required by Antigravity on function calls, and keep duplicate call/response
// identities paired without dropping history.
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
${extract("prepareAntigravityContents")}
globalThis.__prepare = prepareAntigravityContents;
`;
new Function(code)();
const prepareAntigravityContents = globalThis.__prepare;

const signature = "S".repeat(96);
const contents = [
  { role: "user", parts: [{ text: "before" }] },
  {
    role: "model",
    parts: [{ functionCall: { id: "call_same", name: "first", args: { n: 1 } } }]
  },
  {
    role: "user",
    parts: [{ functionResponse: { id: "call_same", name: "wrong", response: { result: "one" } } }]
  },
  { role: "user", parts: [{ text: "between" }] },
  {
    role: "model",
    parts: [{ functionCall: { id: "call_same", name: "second", args: { n: 2 } } }]
  },
  {
    role: "user",
    parts: [{ functionResponse: { id: "call_same", name: "wrong", response: { result: "two" } } }]
  },
  { role: "user", parts: [{ text: "after" }] }
];

const prepared = prepareAntigravityContents(contents, signature, true);
if (prepared.length !== contents.length) throw new Error("history length changed");
if (prepared[0] !== contents[0] || prepared[3] !== contents[3] || prepared[6] !== contents[6]) {
  throw new Error("ordinary parts were unnecessarily cloned");
}

const firstCall = prepared[1].parts[0].functionCall;
const firstResponse = prepared[2].parts[0].functionResponse;
const secondCall = prepared[4].parts[0].functionCall;
const secondResponse = prepared[5].parts[0].functionResponse;

if (firstCall.id !== "call_same" || firstResponse.id !== "call_same") {
  throw new Error("first tool pair changed identity");
}
if (secondCall.id !== "call_same__dup2" || secondResponse.id !== "call_same__dup2") {
  throw new Error("duplicate tool pair was not disambiguated");
}
if (firstResponse.name !== "first" || secondResponse.name !== "second") {
  throw new Error("tool response names were not paired with calls");
}
for (const part of [prepared[1].parts[0], prepared[4].parts[0]]) {
  if (part.thoughtSignature !== signature || part.thought_signature !== signature) {
    throw new Error("thought signature was not injected on a function call");
  }
}
if (firstCall.args.n !== 1 || secondCall.args.n !== 2 ||
    firstResponse.response.result !== "one" || secondResponse.response.result !== "two") {
  throw new Error("tool arguments or outputs changed");
}

const noThinking = prepareAntigravityContents(contents, signature, false);
for (const part of [noThinking[1].parts[0], noThinking[4].parts[0]]) {
  if (part.thoughtSignature !== signature || part.thought_signature !== signature) {
    throw new Error("protocol signature was not preserved when thinking was disabled");
  }
}

console.log("PASS: Antigravity history preparation is single-pass and preserves tool pairs");
