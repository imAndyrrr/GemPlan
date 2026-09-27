import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  .replace(/\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const config = JSON.parse(source);

assert.equal(config?.limits, undefined, "Workers Free rejects custom CPU limits; keep the deployable Free configuration");
assert.equal(config?.main, "src/worker.js");

console.log("PASS: Worker configuration stays deployable on Workers Free");
