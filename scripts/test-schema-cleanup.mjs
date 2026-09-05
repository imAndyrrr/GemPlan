// Regression test: oneOf/allOf/prefixItems sub-schemas must be cleaned ($ref resolved, forbidden keys removed).
// Extracts optimizeAndCleanSchema + collectAllDefs from src/worker.js source text and evals them.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  // brace matching from first {
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

const code = `const __name = (f, n) => f; const __name2 = (f, n) => f;\nconst GOOGLE_FORBIDDEN_KEYS = ${JSON.stringify(GOOGLE_FORBIDDEN_KEYS)};\n${extract("collectAllDefs")}\n${extract("optimizeAndCleanSchema")}\nglobalThis.__fns = { collectAllDefs, optimizeAndCleanSchema };`;
new Function(code)();

const { optimizeAndCleanSchema } = globalThis.__fns;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
function assertNoRefs(schema, path = "$") {
  if (!schema || typeof schema !== "object") return;
  for (const k of ["$ref", "$defs", "definitions"]) {
    if (k in schema) throw new Error(`${path}: residual ${k}`);
  }
  for (const [k, v] of Object.entries(schema)) {
    if (Array.isArray(v)) v.forEach((x, i) => assertNoRefs(x, `${path}.${k}[${i}]`));
    else if (v && typeof v === "object") assertNoRefs(v, `${path}.${k}`);
  }
}

// Case 1: oneOf with $ref items (the reported bug)
const schema1 = {
  type: "object",
  properties: {
    value: {
      oneOf: [
        { $ref: "#/$defs/Str" },
        { $ref: "#/$defs/Num" },
        { $ref: "#/$defs/Str" } // duplicate ref, also fine
      ]
    }
  },
  $defs: { Str: { type: "string", maxLength: 5 }, Num: { type: "number", multipleOf: 2 } }
};
optimizeAndCleanSchema(schema1, false);
check("oneOf $ref resolved", () => {
  const v = schema1.properties.value;
  assertNoRefs(v);
  if (!Array.isArray(v.oneOf)) throw new Error("oneOf should be preserved");
  if (v.oneOf[0].type !== "string" || v.oneOf[0].maxLength !== 5) throw new Error("Str not inlined");
  if (v.oneOf[1].type !== "number") throw new Error("Num not inlined");
  if ("multipleOf" in v.oneOf[1]) throw new Error("forbidden key survived in oneOf item");
});

// Case 2: allOf with $ref + nested properties containing oneOf refs
const schema2 = {
  type: "object",
  allOf: [{ $ref: "#/$defs/Base" }],
  properties: {
    nested: {
      type: "array",
      items: { oneOf: [{ $ref: "#/$defs/Leaf" }] }
    }
  },
  $defs: { Base: { type: "object", properties: { id: { type: "string" } } }, Leaf: { type: "string" } }
};
optimizeAndCleanSchema(schema2, true);
check("allOf $ref resolved + nested items.oneOf", () => {
  assertNoRefs(schema2);
  if (schema2.allOf[0].properties.id.type !== "STRING") throw new Error("allOf item not uppercased");
  if (schema2.properties.nested.items.oneOf[0].type !== "STRING") throw new Error("items.oneOf not resolved");
});

// Case 3: circular ref inside oneOf (must degrade to object, not infinite loop)
const schema3 = {
  type: "object",
  properties: {
    child: { oneOf: [{ $ref: "#/$defs/Node" }] }
  },
  $defs: {
    Node: {
      type: "object",
      properties: { child: { oneOf: [{ $ref: "#/$defs/Node" }] } }
    }
  }
};
check("circular $ref inside oneOf terminates", () => {
  optimizeAndCleanSchema(schema3, false);
  assertNoRefs(schema3);
});

// Case 4: prefixItems with $ref
const schema4 = {
  type: "array",
  prefixItems: [{ $ref: "#/$defs/A" }, { type: "number", uniqueItems: true }],
  $defs: { A: { type: "string" } }
};
optimizeAndCleanSchema(schema4, false);
check("prefixItems cleaned", () => {
  assertNoRefs(schema4);
  if (schema4.prefixItems[0].type !== "string") throw new Error("prefixItems ref not inlined");
  if ("uniqueItems" in schema4.prefixItems[1]) throw new Error("forbidden key in prefixItems");
});

// Case 5: depth guard still works (no infinite recursion)
const schema5 = { type: "object", properties: {} };
let deep = schema5;
for (let i = 0; i < 30; i++) {
  deep.properties = { next: { type: "object", properties: {} } };
  deep = deep.properties.next;
}
deep.oneOf = [{ $ref: "#/$defs/X" }];
schema5.$defs = { X: { type: "string" } };
check("deep nesting with oneOf beyond depth 20 terminates", () => {
  optimizeAndCleanSchema(schema5, false);
});

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
