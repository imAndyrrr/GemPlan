// Regression tests for Antigravity session isolation.
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
${extract("getRequestSessionKey")}
globalThis.__getRequestSessionKey = getRequestSessionKey;
`;
new Function(code)();
const getRequestSessionKey = globalThis.__getRequestSessionKey;

const explicit = {
  prompt_cache_key: "thread-123",
  messages: [{ role: "user", content: "different content must not override explicit key" }]
};
if (getRequestSessionKey(explicit) !== "thread-123") {
  throw new Error("explicit prompt_cache_key was not preferred");
}

const headerRequest = {
  headers: new Map([
    ["thread-id", "header-thread-123"],
    ["session-id", "header-session-123"]
  ])
};
headerRequest.headers.get = headerRequest.headers.get.bind(headerRequest.headers);
if (getRequestSessionKey({}, headerRequest) !== "header-thread-123") {
  throw new Error("CCR thread-id header was not preferred");
}

const first = {
  messages: [
    { role: "system", content: "shared system" },
    { role: "user", content: "thread A first request" },
    { role: "assistant", content: "reply A" },
    { role: "user", content: "later request A" }
  ]
};
const second = {
  messages: [
    { role: "system", content: "shared system" },
    { role: "user", content: "thread B first request" },
    { role: "assistant", content: "reply B" }
  ]
};
if (getRequestSessionKey(first) === getRequestSessionKey(second)) {
  throw new Error("different conversations shared fallback session key");
}

const sameThread = {
  messages: [
    { role: "system", content: "shared system" },
    { role: "user", content: "thread A first request" },
    { role: "assistant", content: "reply A" },
    { role: "user", content: "new turn A" }
  ]
};
if (getRequestSessionKey(first) !== getRequestSessionKey(sameThread)) {
  throw new Error("same conversation changed fallback session key");
}

console.log("PASS: explicit and deterministic per-conversation session keys");
