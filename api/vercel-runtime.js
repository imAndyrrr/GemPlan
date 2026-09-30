import { Readable } from "node:stream";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createMemoryOrRestKV, createRestCache, MemoryKV } from "./vercel-kv.js";

function loadLocalEnvFile() {
  const loaded = {};
  for (const filename of [".dev.vars", ".env"]) {
    try {
      const fullPath = path.resolve(process.cwd(), filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (key && !(key in loaded)) {
              loaded[key] = val;
            }
          }
        }
      }
    } catch {}
  }
  return loaded;
}

function headerEntries(req) {
  const entries = [];
  if (Array.isArray(req.rawHeaders)) {
    for (let i = 0; i < req.rawHeaders.length; i += 2) entries.push([req.rawHeaders[i], req.rawHeaders[i + 1]]);
    return entries;
  }
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) for (const item of value) entries.push([name, item]);
    else if (value !== void 0 && value !== null) entries.push([name, String(value)]);
  }
  return entries;
}

export function resolveRequestUrl(req) {
  const forwardedHost = req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost";
  const forwardedProto = req.headers?.["x-forwarded-proto"] || "https";
  const originalUrl = req.headers?.["x-vercel-original-url"];
  if (originalUrl) return new URL(originalUrl, `${forwardedProto}://${forwardedHost}`);
  const parsed = new URL(req.url || "/", `${forwardedProto}://${forwardedHost}`);
  const rewrittenPath = parsed.searchParams.get("__path");
  if (rewrittenPath !== null) {
    parsed.searchParams.delete("__path");
    parsed.pathname = `/${String(rewrittenPath).replace(/^\/+/, "")}`;
  }
  return parsed;
}

export function toWebRequest(req) {
  const url = resolveRequestUrl(req);
  const headers = new Headers();
  for (const [name, value] of headerEntries(req)) {
    if (/^(connection|transfer-encoding|keep-alive|proxy-authenticate|proxy-authorization|te|trailer|upgrade)$/i.test(name)) continue;
    headers.append(name, value);
  }
  const method = String(req.method || "GET").toUpperCase();
  const init = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  const request = new Request(url, init);
  const colo = req.headers?.["x-vercel-id"]?.split("::")[0] || process.env.VERCEL_REGION || "bom1";
  Object.defineProperty(request, "cf", {
    value: { colo: `vercel:${colo}` },
    configurable: true
  });
  return request;
}

class CachedKvWrapper {
  constructor(kv) {
    this.kv = kv;
    this.mem = new Map();
  }
  async get(key, type) {
    if (typeof key === "string" && (key.startsWith("user:") || key.startsWith("key:") || key.startsWith("path:"))) {
      const hit = this.mem.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        return type === "json" ? (typeof hit.val === "string" ? JSON.parse(hit.val) : structuredClone(hit.val)) : hit.val;
      }
    }
    const val = await this.kv.get(key, type);
    if (val !== null && val !== undefined && typeof key === "string" && (key.startsWith("user:") || key.startsWith("key:") || key.startsWith("path:"))) {
      this.mem.set(key, { val, expiresAt: Date.now() + 60000 });
    }
    return val;
  }
  async put(key, value, options) {
    if (typeof key === "string") this.mem.delete(key);
    return this.kv.put(key, value, options);
  }
  async delete(key) {
    if (typeof key === "string") this.mem.delete(key);
    return this.kv.delete(key);
  }
  async list(options) {
    return this.kv.list(options);
  }
}

export function createRuntimeEnvironment(source = process.env) {
  const fileEnv = loadLocalEnvFile();
  const env = { ...fileEnv, ...source };
  const rawKv = createMemoryOrRestKV(env);
  env.GEMINI_KV = new CachedKvWrapper(rawKv);
  // 临时缓存（思考签名、403 cooldown、临时状态）使用纯内存，严禁向远程 Cloudflare KV 刷写入配额
  const cacheKv = new MemoryKV();
  const cache = createRestCache(cacheKv);
  Object.defineProperty(globalThis, "caches", {
    value: { default: cache },
    configurable: true,
    writable: true
  });
  return env;
}

export function createRuntimeContext() {
  const pending = new Set();
  return {
    waitUntil(promise) {
      const guarded = Promise.resolve(promise).catch((error) => {
        console.warn("[vercel:waitUntil]", error?.message || error);
      });
      pending.add(guarded);
      guarded.finally(() => pending.delete(guarded));
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    }
  };
}

async function writeBody(webResponse, res) {
  if (!webResponse.body) return;
  const stream = Readable.fromWeb(webResponse.body);
  for await (const chunk of stream) {
    if (!res.write(chunk)) await once(res, "drain");
  }
}

export async function sendWebResponse(webResponse, res, ctx) {
  res.statusCode = webResponse.status;
  if (webResponse.statusText) res.statusMessage = webResponse.statusText;
  const setCookies = typeof webResponse.headers.getSetCookie === "function"
    ? webResponse.headers.getSetCookie()
    : [];
  webResponse.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") return;
    res.setHeader(name, value);
  });
  if (setCookies.length) res.setHeader("Set-Cookie", setCookies);
  res.flushHeaders?.();
  try {
    await writeBody(webResponse, res);
  } finally {
    await ctx.drain();
    if (!res.writableEnded) res.end();
  }
}

export async function handleNodeRequest(worker, req, res, env, ctx = createRuntimeContext()) {
  const request = toWebRequest(req);
  const response = await worker.fetch(request, env, ctx);
  await sendWebResponse(response, res, ctx);
}
