// Regression checks for the large-tool schema cache. A real Codex tool schema
// can exceed 80KB; it must be cleaned once, retained, and reused without a
// per-request structuredClone.
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

const GOOGLE_FORBIDDEN_KEYS = [
  "multipleOf", "dependentRequired", "dependentSchemas", "patternProperties",
  "propertyNames", "unevaluatedItems", "unevaluatedProperties", "contains",
  "minContains", "maxContains", "uniqueItems", "minProperties", "maxProperties",
  "$schema", "$id", "$ref", "$defs", "definitions", "exclusiveMinimum",
  "exclusiveMaximum", "$dynamicRef", "$dynamicAnchor", "$anchor", "$comment"
];

const code = `
const __name = (f) => f;
const __name2 = (f) => f;
const GOOGLE_FORBIDDEN_KEYS = ${JSON.stringify(GOOGLE_FORBIDDEN_KEYS)};
var SCHEMA_CACHE_MAX_SCHEMA_BYTES = 262144;
var SCHEMA_CACHE_MAX_ENTRIES = 24;
var schemaCleanCache = { openai: new Map(), claude: new Map(), gemini: new Map() };
${extract("collectAllDefs")}
${extract("mergeResolvedSchema")}
${extract("optimizeAndCleanSchema")}
${extract("getCleanedSchema")}
globalThis.__schema = getCleanedSchema;
globalThis.__cache = schemaCleanCache;
`;
new Function(code)();

const getCleanedSchema = globalThis.__schema;
const cache = globalThis.__cache;

function makeLargeSchema() {
  return {
    type: "object",
    properties: {
      payload: {
        type: "string",
        description: "x".repeat(80000),
        multipleOf: 3
      }
    },
    required: ["payload"]
  };
}

const firstSource = makeLargeSchema();
const first = getCleanedSchema("openai", "mcp__terminator", firstSource, true);
assert.equal(first.properties.payload.type, "STRING");
assert.equal("multipleOf" in first.properties.payload, false);
assert.equal(cache.openai.size, 1, "an 80KB schema must be retained");

const secondSource = makeLargeSchema();
const second = getCleanedSchema("openai", "mcp__terminator", secondSource, true);
assert.equal(second, first, "cache hit must reuse the read-only cleaned schema");
assert.equal("multipleOf" in secondSource.properties.payload, true, "cache hit must not mutate the temporary request object");

const lower = getCleanedSchema("openai", "mcp__terminator", makeLargeSchema(), false);
assert.notEqual(lower, first, "uppercase and draft-schema modes must not share cache entries");
assert.equal(lower.properties.payload.type, "string");

console.log("PASS: large tool schemas are cached and reused without per-request cloning");
