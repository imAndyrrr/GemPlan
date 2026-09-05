// Verify __thinkingParams non-enumerable fix against the real extractThinkingParams from worker.js.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
// extractThinkingParams may call helper functions; stub the ones it touches.
const code = `
const __name = (f) => f; const __name2 = (f) => f;
const deriveSessionId = () => "";
${extract("extractThinkingParams")}
globalThis.__fn = extractThinkingParams;
`;
new Function(code)();
const extractThinkingParams = globalThis.__fn;

const body = { model: "gemini-2.5-flash", reasoning_effort: "high", messages: [] };
const p1 = extractThinkingParams(body);
const p2 = extractThinkingParams(body); // cached
if (p1 !== p2) throw new Error("cache not used");
if (!("__thinkingParams" in body)) throw new Error("cache property missing");
if (Object.keys(body).includes("__thinkingParams")) throw new Error("cache is enumerable - would leak into payload");
const serialized = JSON.stringify({ request: body });
if (serialized.includes("__thinkingParams")) throw new Error("cache leaked into JSON payload");
console.log("PASS: cache works, non-enumerable, JSON payload clean");
console.log("serialized:", serialized);
