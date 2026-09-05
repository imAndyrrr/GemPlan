// Regression checks for duplicate tool-call IDs in edited/forked histories.
// The repair must preserve every message and tool pair while disambiguating
// only the reused opaque correlation ID.
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
${extract("normalizeToolHistoryIdentities")}
globalThis.__normalize = normalizeToolHistoryIdentities;
`;
new Function(code)();
const normalizeToolHistoryIdentities = globalThis.__normalize;

const contents = [
  { role: "user", parts: [{ text: "keep-before" }] },
  {
    role: "model",
    parts: [{ functionCall: { id: "call_342827", name: "exec_command", args: { cmd: "first" } } }]
  },
  {
    role: "user",
    parts: [{ functionResponse: { id: "call_342827", name: "wrong_overwrite", response: { result: "first-output" } } }]
  },
  { role: "user", parts: [{ text: "keep-between" }] },
  {
    role: "model",
    parts: [{ functionCall: { id: "call_342827", name: "virtual_apply_patch", args: { patch: "second" } } }]
  },
  {
    role: "user",
    parts: [{ functionResponse: { id: "call_342827", name: "wrong_overwrite", response: { result: "second-output" } } }]
  },
  { role: "user", parts: [{ text: "keep-after" }] }
];

const beforeShape = contents.map((content) => ({
  role: content.role,
  partCount: content.parts.length,
  kinds: content.parts.map((part) => Object.keys(part).sort())
}));
const beforeSerialized = JSON.stringify(contents);

normalizeToolHistoryIdentities(contents);

const afterShape = contents.map((content) => ({
  role: content.role,
  partCount: content.parts.length,
  kinds: content.parts.map((part) => Object.keys(part).sort())
}));
if (JSON.stringify(beforeShape) !== JSON.stringify(afterShape)) {
  throw new Error("normalization added, removed, reordered, or retyped history parts");
}

const firstCall = contents[1].parts[0].functionCall;
const firstResponse = contents[2].parts[0].functionResponse;
const secondCall = contents[4].parts[0].functionCall;
const secondResponse = contents[5].parts[0].functionResponse;

if (firstCall.id !== "call_342827" || firstResponse.id !== "call_342827") {
  throw new Error("first occurrence should retain its original ID");
}
if (secondCall.id !== "call_342827__dup2" || secondResponse.id !== "call_342827__dup2") {
  throw new Error("later occurrence was not deterministically disambiguated as a complete pair");
}
if (firstResponse.name !== "exec_command" || secondResponse.name !== "virtual_apply_patch") {
  throw new Error("functionResponse names were not matched to their occurrence-specific calls");
}
if (firstCall.args.cmd !== "first" || secondCall.args.patch !== "second") {
  throw new Error("functionCall arguments changed");
}
if (firstResponse.response.result !== "first-output" || secondResponse.response.result !== "second-output") {
  throw new Error("functionResponse output changed");
}
if (contents[0].parts[0].text !== "keep-before" || contents[3].parts[0].text !== "keep-between" || contents[6].parts[0].text !== "keep-after") {
  throw new Error("ordinary history text changed");
}
if (contents.length !== 7 || beforeSerialized.length === 0) {
  throw new Error("history length changed");
}

const callIds = [firstCall.id, secondCall.id];
if (new Set(callIds).size !== callIds.length) {
  throw new Error("functionCall IDs remain ambiguous");
}

console.log("PASS: duplicate tool-call IDs are disambiguated without deleting or synthesizing history");
