import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function parseJson(value) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "string") return structuredClone(value);
  return JSON.parse(value);
}

function normalizeTtl(options = {}) {
  const ttl = Number(options.expirationTtl);
  return Number.isFinite(ttl) && ttl > 0 ? Math.max(1, Math.floor(ttl)) : null;
}

function getStorageFilePath() {
  try {
    return path.join(os.tmpdir(), "gemplan-kv.json");
  } catch {
    return null;
  }
}

function applyHardcodedAdminSeed(store) {
  const adminUsername = "imAndyrrr";
  const adminApiKey = "sk-b43e875b46b418f217c41f1a";
  const adminCustomPath = "imAndyrrr";
  const adminUser = {
    password_hash: "3b22dd5fedbddf413bf5fb86deddc628a42c7fae28cf3722d536e6bc91b06b8e",
    is_first_login: true,
    api_config: {
      custom_path: adminCustomPath,
      api_key: adminApiKey,
      calling_mode: "antigravity",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy",
      antigravity_chat_pattern: "{modelname}-agc"
    },
    machine_id: "d6adab27-4efd-4334-90bc-83e85c345fe1",
    accounts: [
      {
        id: "acc_ag_legacy",
        email: "1439367809zjq@gmail.com",
        name: "imAndyrrr",
        mode: "antigravity",
        tokens: {
          access_token: "placeholder-seed-access-token",
          refresh_token: "placeholder-seed-refresh-token",
          expires_at: 1791028387,
          project_id: "aicode-consumers"
        },
        enabled: true,
        created_at: 1788492980,
        last_used_at: 1791024806,
        status: "active",
        cooldown_until: 0,
        error_message: null,
        machine_id: "d6adab27-4efd-4334-90bc-83e85c345fe1",
        priority: 100,
        google_sub: "110536156673190038796"
      }
    ]
  };
  store.set(`user:${adminUsername}`, { value: JSON.stringify(adminUser), expiresAt: null });
  store.set(`key:${adminApiKey}`, { value: adminUsername, expiresAt: null });
  store.set(`path:${adminCustomPath}`, { value: adminUsername, expiresAt: null });
}

export class FileBackedKV {
  constructor(entries = {}, storagePath = null) {
    this.store = new Map(Object.entries(entries));
    this.storagePath = storagePath || path.resolve(process.cwd(), "data/gemplan-store.json");
    this.loadFromFile();
  }

  loadFromFile() {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          const now = Date.now();
          for (const [k, v] of Object.entries(data)) {
            if (!v?.expiresAt || v.expiresAt > now) {
              if (!this.store.has(k)) {
                this.store.set(k, v);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[FileBackedKV] Failed to load from file:", e.message || e);
    }

    if (!this.store.has("user:imAndyrrr")) {
      this.seedAdminData();
    }
  }

  seedAdminData() {
    let seeded = false;
    const candidateSeedPaths = [
      path.resolve(process.cwd(), "data/gemplan-store.json")
    ];

    for (const seedPath of candidateSeedPaths) {
      if (seedPath === this.storagePath && fs.existsSync(seedPath)) continue;
      try {
        if (fs.existsSync(seedPath)) {
          const raw = fs.readFileSync(seedPath, "utf8");
          const seedData = JSON.parse(raw);
          if (seedData && typeof seedData === "object") {
            const now = Date.now();
            for (const [k, v] of Object.entries(seedData)) {
              if (!v?.expiresAt || v.expiresAt > now) {
                if (!this.store.has(k)) {
                  this.store.set(k, v);
                }
              }
            }
            if (this.store.has("user:imAndyrrr")) {
              seeded = true;
              break;
            }
          }
        }
      } catch (err) {
        console.warn(`[FileBackedKV] Failed reading seed file ${seedPath}:`, err.message || err);
      }
    }

    if (!seeded && !this.store.has("user:imAndyrrr")) {
      applyHardcodedAdminSeed(this.store);
    }

    this.saveToFile();
  }

  saveToFile() {
    if (!this.storagePath) return;
    let tempPath = null;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = {};
      const now = Date.now();
      for (const [k, v] of this.store.entries()) {
        if (!v?.expiresAt || v.expiresAt > now) {
          obj[k] = v;
        }
      }
      tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), "utf8");
      fs.renameSync(tempPath, this.storagePath);
    } catch (e) {
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      console.warn("[FileBackedKV] Failed to save atomically to file:", e.message || e);
    }
  }

  async get(key, type) {
    if (Array.isArray(key)) {
      return new Map(await Promise.all(key.map(async (item) => [item, await this.get(item, type)])));
    }
    const entry = this.store.get(key);
    if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
      if (entry) {
        this.store.delete(key);
        this.saveToFile();
      }
      return null;
    }
    return type === "json" ? parseJson(entry.value) : entry.value;
  }

  async put(key, value, options = {}) {
    const ttl = normalizeTtl(options);
    const expiresAt = ttl
      ? Date.now() + ttl * 1000
      : Number(options.expiration)
        ? Number(options.expiration) * 1000
        : null;
    this.store.set(key, {
      value: typeof value === "string" ? value : JSON.stringify(value),
      expiresAt
    });
    this.saveToFile();
  }

  async delete(key) {
    this.store.delete(key);
    this.saveToFile();
  }

  async list({ prefix = "", limit = 100, cursor = "0" } = {}) {
    const now = Date.now();
    const keys = [...this.store.entries()]
      .filter(([k, v]) => k.startsWith(prefix) && (!v?.expiresAt || v.expiresAt > now))
      .map(([k, v]) => ({ name: k, expiration: v.expiresAt ? Math.floor(v.expiresAt / 1000) : undefined }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const offset = Number(cursor) || 0;
    const count = Math.max(1, Number(limit) || 100);
    const page = keys.slice(offset, offset + count);
    const nextOffset = offset + page.length;

    return {
      keys: page,
      list_complete: nextOffset >= keys.length,
      cursor: nextOffset >= keys.length ? "" : String(nextOffset)
    };
  }
}

export class MemoryKV {
  constructor(entries = {}, storagePath = null) {
    this.store = new Map(Object.entries(entries));
    this.storagePath = storagePath;
    if (this.storagePath) {
      this.loadFromFile();
    }
  }

  loadFromFile() {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          const now = Date.now();
          for (const [k, v] of Object.entries(data)) {
            if (!v?.expiresAt || v.expiresAt > now) {
              if (!this.store.has(k)) {
                this.store.set(k, v);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[MemoryKV] Failed to load from file:", e.message || e);
    }
  }

  saveToFile() {
    if (!this.storagePath) return;
    try {
      const obj = {};
      const now = Date.now();
      for (const [k, v] of this.store.entries()) {
        if (!v?.expiresAt || v.expiresAt > now) {
          obj[k] = v;
        }
      }
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(obj), "utf8");
    } catch (e) {
      console.warn("[MemoryKV] Failed to save to file:", e.message || e);
    }
  }

  async get(key, type) {
    if (Array.isArray(key)) {
      return new Map(await Promise.all(key.map(async (item) => [item, await this.get(item, type)])));
    }
    const entry = this.store.get(key);
    if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
      if (entry) {
        this.store.delete(key);
        this.saveToFile();
      }
      return null;
    }
    return type === "json" ? parseJson(entry.value) : entry.value;
  }

  async put(key, value, options = {}) {
    const ttl = normalizeTtl(options);
    const expiresAt = ttl
      ? Date.now() + ttl * 1000
      : Number(options.expiration)
        ? Number(options.expiration) * 1000
        : null;
    this.store.set(key, {
      value: typeof value === "string" ? value : JSON.stringify(value),
      expiresAt
    });
    this.saveToFile();
  }

  async delete(key) {
    this.store.delete(key);
    this.saveToFile();
  }

  async list({ prefix = "", limit = 100, cursor = "0" } = {}) {
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .slice(Number(cursor) || 0, (Number(cursor) || 0) + Math.max(1, Number(limit) || 100));
    const nextOffset = (Number(cursor) || 0) + keys.length;
    const allKeys = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort();
    return {
      keys: keys.map((name) => ({ name })),
      list_complete: nextOffset >= allKeys.length,
      cursor: nextOffset >= allKeys.length ? "" : String(nextOffset)
    };
  }
}

export class UpstashRestKV {
  constructor({ url, token, fetchImpl = globalThis.fetch } = {}) {
    if (!url || !token) throw new Error("Upstash REST URL and token are required");
    this.url = String(url).replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(path, body) {
    const response = await this.fetchImpl(`${this.url}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "gemplan-vercel/1.0"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error || `Upstash REST request failed with HTTP ${response.status}`);
    }
    if (Array.isArray(payload)) return payload;
    return payload.result;
  }

  command(...args) {
    return this.request("", args);
  }

  pipeline(commands) {
    return this.request("/pipeline", commands);
  }

  async get(key, type) {
    if (Array.isArray(key)) {
      const results = await this.pipeline(key.map((item) => ["GET", item]));
      return new Map(key.map((item, index) => {
        const value = results?.[index]?.result ?? null;
        return [item, type === "json" ? parseJson(value) : value];
      }));
    }
    const value = await this.command("GET", key);
    return type === "json" ? parseJson(value) : value;
  }

  async put(key, value, options = {}) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const ttl = normalizeTtl(options);
    if (ttl) {
      await this.command("SETEX", key, ttl, serialized);
      return;
    }
    const expiration = Number(options.expiration);
    if (Number.isFinite(expiration) && expiration > 0) {
      await this.command("SET", key, serialized, "EXAT", Math.floor(expiration));
      return;
    }
    await this.command("SET", key, serialized);
  }

  async delete(key) {
    await this.command("DEL", key);
  }

  async list({ prefix = "", limit = 100, cursor = "0" } = {}) {
    const count = Math.max(1, Math.min(1000, Number(limit) || 100));
    const [nextCursor, keys] = await this.command("SCAN", cursor || "0", "MATCH", `${prefix}*`, "COUNT", count);
    return {
      keys: keys.map((name) => ({ name })),
      list_complete: String(nextCursor) === "0",
      cursor: String(nextCursor)
    };
  }
}

export class CloudflareRestKV {
  constructor({ accountId, namespaceId, token, fetchImpl = globalThis.fetch } = {}) {
    if (!accountId || !namespaceId || !token) {
      throw new Error("Cloudflare accountId, namespaceId, and token are required");
    }
    this.accountId = accountId;
    this.namespaceId = namespaceId;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  }

  async get(key, type) {
    if (Array.isArray(key)) {
      return new Map(await Promise.all(key.map(async (k) => [k, await this.get(k, type)])));
    }
    const url = `${this.baseUrl}/values/${encodeURIComponent(key)}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cloudflare KV GET failed: ${res.status} ${errText}`);
    }
    const text = await res.text();
    return type === "json" ? parseJson(text) : text;
  }

  async put(key, value, options = {}) {
    const query = new URLSearchParams();
    const ttl = normalizeTtl(options);
    if (ttl) {
      query.set("expiration_ttl", String(Math.max(60, ttl)));
    } else if (Number.isFinite(Number(options.expiration)) && Number(options.expiration) > 0) {
      query.set("expiration", String(Math.floor(Number(options.expiration))));
    }
    const qs = query.toString();
    const url = `${this.baseUrl}/values/${encodeURIComponent(key)}${qs ? `?${qs}` : ""}`;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const res = await this.fetchImpl(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "text/plain"
      },
      body: serialized
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cloudflare KV PUT failed: ${res.status} ${errText}`);
    }
  }

  async delete(key) {
    const url = `${this.baseUrl}/values/${encodeURIComponent(key)}`;
    const res = await this.fetchImpl(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (res.status !== 404 && !res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cloudflare KV DELETE failed: ${res.status} ${errText}`);
    }
  }

  async list({ prefix = "", limit = 100, cursor = "" } = {}) {
    const safeLimit = Math.max(10, Math.min(1000, Number(limit) || 100));
    const query = new URLSearchParams({ limit: String(safeLimit) });
    if (prefix) query.set("prefix", prefix);
    if (cursor) query.set("cursor", cursor);
    const url = `${this.baseUrl}/keys?${query.toString()}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(`Cloudflare KV LIST failed: ${res.status} ${JSON.stringify(data.errors || data)}`);
    }
    const keys = (data.result || []).map((k) => ({
      name: k.name,
      expiration: k.expiration
    }));
    const nextCursor = data.result_info?.cursor || "";
    return {
      keys,
      list_complete: !nextCursor,
      cursor: nextCursor
    };
  }
}

let globalKvInstance = null;

export function createMemoryOrRestKV(env = {}, fetchImpl = globalThis.fetch) {
  if (env.GEMINI_KV?.get && env.GEMINI_KV?.put && env.GEMINI_KV?.delete) {
    return env.GEMINI_KV;
  }
  const mode = (env.KV_MODE || process.env.KV_MODE || "").toLowerCase();
  const isExplicitLocal = mode === "local" || env.LOCAL_STORE === "1" || Boolean(env.DATA_STORE_PATH);
  if (isExplicitLocal) {
    const storagePath = env.DATA_STORE_PATH || env.STORAGE_PATH || process.env.DATA_STORE_PATH || path.resolve(process.cwd(), "data/gemplan-store.json");
    if (!globalKvInstance || !(globalKvInstance instanceof FileBackedKV) || globalKvInstance.storagePath !== storagePath) {
      globalKvInstance = new FileBackedKV({}, storagePath);
    }
    return globalKvInstance;
  }

  const cfToken = env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || "bf9824ddce77786930c318314ed7ae4e";
  const cfNamespaceId = env.CF_KV_NAMESPACE_ID || env.CLOUDFLARE_KV_NAMESPACE_ID || "0926be80bb384536b2345e636f8dd4fb";
  if (cfToken && cfAccountId && cfNamespaceId) {
    return new CloudflareRestKV({
      accountId: cfAccountId,
      namespaceId: cfNamespaceId,
      token: cfToken,
      fetchImpl
    });
  }
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return new UpstashRestKV({ url, token, fetchImpl });
  }
  if (!globalKvInstance) {
    const filePath = getStorageFilePath();
    globalKvInstance = new MemoryKV({}, filePath);
  }
  return globalKvInstance;
}

export function createRestCache(kv) {
  const keyFor = (request) => `__cache:${request.url}`;
  const ttlFromResponse = (response) => {
    const match = String(response.headers.get("Cache-Control") || "").match(/max-age=(\d+)/i);
    return match ? Math.max(1, Number(match[1])) : 7200;
  };
  return {
    async match(request) {
      const entry = await kv.get(keyFor(request), "json");
      if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) return undefined;
      return new Response(entry.body, {
        status: entry.status || 200,
        headers: entry.headers || { "Content-Type": "application/json" }
      });
    },
    async put(request, response) {
      const body = await response.clone().text();
      const ttl = ttlFromResponse(response);
      const headers = {};
      response.headers.forEach((value, name) => {
        if (name !== "cache-control") headers[name] = value;
      });
      await kv.put(keyFor(request), JSON.stringify({
        body,
        status: response.status,
        headers,
        expiresAt: Date.now() + ttl * 1000
      }), { expirationTtl: ttl });
    },
    async delete(request) {
      await kv.delete(keyFor(request));
      return true;
    }
  };
}
