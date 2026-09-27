import assert from "node:assert/strict";
import { MemoryKV, UpstashRestKV, CloudflareRestKV, createMemoryOrRestKV, createRestCache } from "../api/vercel-kv.js";

const memory = new MemoryKV();
await memory.put("json", JSON.stringify({ ok: true }), { expirationTtl: 30 });
assert.deepEqual(await memory.get("json", "json"), { ok: true });
assert.equal(await memory.get("json"), JSON.stringify({ ok: true }));
await memory.put("a", "1");
await memory.put("b", "2");
assert.deepEqual(await memory.get(["a", "b", "missing"]), new Map([["a", "1"], ["b", "2"], ["missing", null]]));
await memory.delete("a");
assert.equal(await memory.get("a"), null);

const calls = [];
const responses = [
  { result: "OK" },
  { result: "{\"stored\":true}" },
  [{ result: "1" }, { result: null }],
  { result: 1 },
  { result: ["0", ["x"]] }
];
const fetchImpl = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify(responses.shift()), { status: 200 });
};
const rest = new UpstashRestKV({ url: "https://rest.invalid", token: "token", fetchImpl });
await rest.put("x", "1", { expirationTtl: 10 });
assert.deepEqual(calls[0].body, ["SETEX", "x", 10, "1"]);
assert.deepEqual(await rest.get("stored", "json"), { stored: true });
assert.deepEqual(await rest.get(["x", "missing"]), new Map([["x", "1"], ["missing", null]]));
await rest.delete("x");
assert.deepEqual(calls[3].body, ["DEL", "x"]);
assert.deepEqual(await rest.list({ prefix: "x" }), {
  keys: [{ name: "x" }],
  list_complete: true,
  cursor: "0"
});

const cacheKv = new MemoryKV();
const cache = createRestCache(cacheKv);
const cacheRequest = new Request("https://cache.invalid/key");
await cache.put(cacheRequest, new Response(JSON.stringify({ cached: true }), {
  headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }
}));
const cached = await cache.match(cacheRequest);
assert.deepEqual(await cached.json(), { cached: true });
assert.equal(await cache.delete(cacheRequest), true);
assert.equal(await cache.match(cacheRequest), undefined);

assert.ok(createMemoryOrRestKV({ VERCEL: "" }) instanceof MemoryKV);
assert.ok(createMemoryOrRestKV({ VERCEL: "1" }) instanceof MemoryKV);
assert.ok(createMemoryOrRestKV({
  KV_REST_API_URL: "https://rest.invalid",
  KV_REST_API_TOKEN: "token",
  fetchImpl
}) instanceof UpstashRestKV);

const cfCalls = [];
const cfStore = new Map();
const cfFetch = async (url, init = {}) => {
  cfCalls.push({ url, method: init.method || "GET", body: init.body });
  if (url.includes("/keys")) {
    return new Response(JSON.stringify({
      success: true,
      result: Array.from(cfStore.keys()).map(name => ({ name })),
      result_info: { cursor: "" }
    }), { status: 200 });
  }
  const keyMatch = url.match(/\/values\/([^?]+)/);
  const key = keyMatch ? decodeURIComponent(keyMatch[1]) : "";
  if (init.method === "PUT") {
    cfStore.set(key, init.body);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (init.method === "DELETE") {
    cfStore.delete(key);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  const val = cfStore.get(key);
  if (val === undefined) return new Response("Not found", { status: 404 });
  return new Response(val, { status: 200 });
};
const cfKv = new CloudflareRestKV({
  accountId: "acc",
  namespaceId: "ns",
  token: "tok",
  fetchImpl: cfFetch
});
await cfKv.put("cf_k1", { hello: "world" }, { expirationTtl: 120 });
assert.equal(cfCalls[0].method, "PUT");
assert.ok(cfCalls[0].url.includes("expiration_ttl=120"));
assert.deepEqual(await cfKv.get("cf_k1", "json"), { hello: "world" });
const cfList = await cfKv.list({ prefix: "cf_" });
assert.deepEqual(cfList, { keys: [{ name: "cf_k1", expiration: undefined }], list_complete: true, cursor: "" });

assert.ok(createMemoryOrRestKV({
  CF_API_TOKEN: "tok",
  CF_ACCOUNT_ID: "acc",
  CF_KV_NAMESPACE_ID: "ns"
}, cfFetch) instanceof CloudflareRestKV);

console.log("PASS: Vercel KV and Cache compatibility layers preserve required semantics");
