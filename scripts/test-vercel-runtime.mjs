import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import worker from "../src/worker.js";
import { MemoryKV } from "../api/vercel-kv.js";
import {
  createRuntimeContext,
  handleNodeRequest,
  resolveRequestUrl,
  toWebRequest
} from "../api/vercel-runtime.js";

function makeReq({ method = "GET", url = "/", headers = {}, body = null } = {}) {
  const stream = body === null ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    host: "gemplan.vercel.test",
    "x-forwarded-proto": "https",
    ...headers
  };
  stream.rawHeaders = Object.entries(stream.headers).flatMap(([name, value]) => [name, value]);
  return stream;
}

function makeRes() {
  const res = new PassThrough();
  res.statusCode = 200;
  res.statusMessage = "";
  res.headersSent = false;
  res.headers = new Map();
  res.setHeader = (name, value) => {
    res.headers.set(String(name).toLowerCase(), value);
    return res;
  };
  res.flushHeaders = () => {
    res.headersSent = true;
  };
  return res;
}

async function readResponse(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

assert.equal(resolveRequestUrl(makeReq({ url: "/api/handler?__path=v1/models&real=1" })).toString(), "https://gemplan.vercel.test/v1/models?real=1");
assert.equal(resolveRequestUrl(makeReq({ url: "/api/handler?__path=" })).pathname, "/");
assert.equal(resolveRequestUrl(makeReq({ url: "/dashboard", headers: { "x-vercel-original-url": "https://custom.test/dashboard?x=1" } })).toString(), "https://custom.test/dashboard?x=1");

const postReq = makeReq({
  method: "POST",
  url: "/echo?x=1",
  headers: { "Content-Type": "text/plain", "X-Test": "value" },
  body: "hello"
});
const postRequest = toWebRequest(postReq);
assert.equal(postRequest.method, "POST");
assert.equal(postRequest.url, "https://gemplan.vercel.test/echo?x=1");
assert.equal(postRequest.headers.get("x-test"), "value");
assert.equal(await postRequest.text(), "hello");
assert.equal(postRequest.cf.colo, "vercel:bom1");

const kv = new MemoryKV();
const loginRes = makeRes();
const loginRead = readResponse(loginRes);
await handleNodeRequest(worker, makeReq({ url: "/login" }), loginRes, { GEMINI_KV: kv });
const loginHtml = await loginRead;
assert.equal(loginRes.statusCode, 200);
assert.match(loginHtml, /登录/);

const registerRes = makeRes();
const registerRead = readResponse(registerRes);
await handleNodeRequest(worker, makeReq({
  method: "POST",
  url: "/login",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "username=vercel-user&password=test-password"
}), registerRes, { GEMINI_KV: kv });
await registerRead;
assert.equal(registerRes.statusCode, 302);
assert.match(String(registerRes.headers.get("set-cookie")), /session_id=/);
assert.ok(await kv.get("user:vercel-user", "json"));

const streamedRes = makeRes();
const streamedRead = readResponse(streamedRes);
await handleNodeRequest({
  fetch: async () => new Response(Readable.toWeb(Readable.from(["one", "two"])), {
    headers: { "Content-Type": "text/event-stream", "X-Streaming": "yes" }
  })
}, makeReq({ url: "/stream" }), streamedRes, { GEMINI_KV: kv }, createRuntimeContext());
assert.equal(await streamedRead, "onetwo");
assert.equal(streamedRes.headers.get("x-streaming"), "yes");

console.log("PASS: Vercel request, response, streaming, and real Worker entry paths are preserved");

