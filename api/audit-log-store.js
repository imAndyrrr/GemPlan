import fsp from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Design notes (learned the hard way from an earlier revision):
//
// 1. The request path must NEVER do O(file) work. The previous implementation
//    re-read and re-serialized the whole log file (which grew to 81 MB) on
//    every single request, blocking Node's event loop and taking the whole
//    gateway down (499/502 on every streaming request).
// 2. Storage must be append-only (JSONL). One request = one appended line.
//    Compaction is a rotation (atomic rename), never a full rewrite.
// 3. Every captured body is capped, so a single line stays bounded and the
//    on-disk footprint can never explode.
// 4. Reads (dashboard) tail the file and reuse a tiny in-memory cache, so
//    clicking "view logs" costs a bounded read instead of a full parse.
// ---------------------------------------------------------------------------

export const MAX_BODY_CHARS = 256 * 1024; // ~256 KB per captured body
const MAX_FILE_BYTES = 24 * 1024 * 1024; // rotate past ~24 MB
const READ_TAIL_BYTES = 6 * 1024 * 1024; // dashboard reads at most the tail
const READ_CACHE_MS = 1500;
const SIZE_CHECK_EVERY = 16;

const TRUNCATED_MARKER = "\n\n…[TRUNCATED: body exceeded 256 KB capture limit]";

function safeTruncate(content) {
  if (content === null || content === undefined) return content;
  if (typeof content !== "string") {
    try {
      content = JSON.stringify(content);
    } catch (_) {
      return String(content);
    }
  }
  if (content.length > MAX_BODY_CHARS) {
    return content.slice(0, MAX_BODY_CHARS) + TRUNCATED_MARKER;
  }
  return content;
}

/**
 * Normalize every token accounting dialect we forward (Google / OpenAI /
 * Claude) into one flat, storable shape.
 */
export function normalizeTokenUsage(meta) {
  if (!meta || typeof meta !== "object") return null;
  const prompt_tokens = Number(meta.promptTokenCount || meta.prompt_tokens || meta.input_tokens || 0);
  const output_tokens = Number(meta.candidatesTokenCount || meta.output_tokens || meta.completion_tokens || 0);
  const reasoning_tokens = Number(meta.thoughtsTokenCount || meta.reasoning_tokens || meta.output_tokens_details?.reasoning_tokens || 0);
  const cached_tokens = Number(
    meta.cachedContentTokenCount ||
      meta.cached_tokens ||
      meta.cache_read_input_tokens ||
      meta.prompt_tokens_details?.cached_tokens ||
      meta.input_tokens_details?.cached_tokens ||
      0
  );
  const total_tokens = Number(meta.totalTokenCount || meta.total_tokens || (prompt_tokens + output_tokens + reasoning_tokens));
  if (!prompt_tokens && !output_tokens && !reasoning_tokens && !cached_tokens && !total_tokens) return null;
  return { prompt_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens };
}

/** Best-effort usage extraction from a raw SSE transcript. */
export function extractUsageFromText(text) {
  if (!text || typeof text !== "string") return null;
  // Walk through SSE data lines from end to start to find the final chunk with usage
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("data:") || line === "data: [DONE]") continue;
    const dataStr = line.slice(5).trim();
    if (!dataStr.startsWith("{")) continue;
    try {
      const obj = JSON.parse(dataStr);
      const rawUsage = obj?.usage || obj?.response?.usage || obj?.usageMetadata || obj?.response?.usageMetadata;
      if (rawUsage) {
        const normalized = normalizeTokenUsage(rawUsage);
        if (normalized) return normalized;
      }
    } catch (_) {}
  }
  return null;
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyDay(date) {
  return {
    date,
    prompt_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    request_count: 0
  };
}

// ---------------------------------------------------------------------------
// Daily token statistics: one compact record per calendar day. Writes are
// debounced and asynchronous so the request path never waits on disk.
//
// The VPS runs the gateway as a Node cluster (one process per CPU), so this
// store MUST be safe across processes. An earlier revision kept a private
// in-memory map per worker and rewrote the whole file with it, which meant the
// two workers clobbered each other and /api/token-stats returned different
// numbers depending on which worker answered. The rules now are:
//   * each worker only owns a small "delta" of usage it has not written yet;
//   * a persist takes a lock, re-reads the file, merges the delta, and renames
//     a temporary file over it (so readers never see a half-written file);
//   * reads always come from the shared file (short cache), never from a
//     private map that may be missing the other worker's traffic.
// ---------------------------------------------------------------------------
const STATS_LOCK_TIMEOUT_MS = 5000;
const STATS_LOCK_STALE_MS = 15000;

function addUsage(target, key, normalized, count = 1) {
  const row = target[key] || (target[key] = emptyDay(key));
  row.prompt_tokens += normalized.prompt_tokens;
  row.output_tokens += normalized.output_tokens;
  row.reasoning_tokens += normalized.reasoning_tokens;
  row.cached_tokens += normalized.cached_tokens;
  row.total_tokens += normalized.total_tokens;
  row.request_count += count;
  return row;
}

function mergeDay(target, key, row) {
  const dest = target[key] || (target[key] = emptyDay(key));
  dest.prompt_tokens += Number(row.prompt_tokens) || 0;
  dest.output_tokens += Number(row.output_tokens) || 0;
  dest.reasoning_tokens += Number(row.reasoning_tokens) || 0;
  dest.cached_tokens += Number(row.cached_tokens) || 0;
  dest.total_tokens += Number(row.total_tokens) || 0;
  dest.request_count += Number(row.request_count) || 0;
  return dest;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TokenStatsStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "data/daily-token-stats.json");
    this.lockPath = `${this.storagePath}.lock`;
    this.dailyMap = {};
    this.pending = {};
    this.loaded = false;
    this.loadPromise = null;
    this.writeTimer = null;
    this.writing = null;
    this.persistAgain = false;
    this.retryDelay = 1000;
    this.failedOnce = false;
  }

  async ready() {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const disk = await this.readFile();
        if (disk) this.dailyMap = disk;
        this.loaded = true;
      })();
    }
    await this.loadPromise;
  }

  /** Read the shared file. Returns null when it is missing or corrupt. */
  async readFile() {
    try {
      const raw = await fsp.readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return null;
  }

  /** Cross-process exclusive lock; stale locks left by a crash expire. */
  async withLock(fn) {
    const startedAt = Date.now();
    let handle = null;
    for (;;) {
      try {
        handle = await fsp.open(this.lockPath, "wx");
        break;
      } catch (err) {
        if (err?.code !== "EEXIST") throw err;
        const stat = await fsp.stat(this.lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > STATS_LOCK_STALE_MS) {
          await fsp.rm(this.lockPath, { force: true }).catch(() => {});
          continue;
        }
        if (Date.now() - startedAt > STATS_LOCK_TIMEOUT_MS) {
          throw new Error("token stats lock timeout");
        }
        await sleep(10 + Math.random() * 20);
      }
    }
    try {
      return await fn();
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fsp.rm(this.lockPath, { force: true }).catch(() => {});
    }
  }

  recordUsage(usage, timestamp = Date.now(), model = null, username = null) {
    const normalized = normalizeTokenUsage(usage);
    if (!normalized) return;
    const key = dayKey(timestamp);
    addUsage(this.dailyMap, key, normalized);
    addUsage(this.pending, key, normalized);
    this.schedulePersist();
  }

  schedulePersist(delay = 1000) {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.persist();
    }, delay);
    if (typeof this.writeTimer.unref === "function") this.writeTimer.unref();
  }

  async persist() {
    if (this.writing) {
      this.persistAgain = true;
      return this.writing;
    }
    const delta = this.pending;
    if (!Object.keys(delta).length) return;
    this.pending = {};
    this.writing = (async () => {
      try {
        await this.withLock(async () => {
          const disk = (await this.readFile()) || {};
          for (const [key, row] of Object.entries(delta)) mergeDay(disk, key, row);
          await this.writeAtomic(disk);
          this.dailyMap = disk;
        });
        this.retryDelay = 1000;
        this.failedOnce = false;
      } catch (err) {
        // Never lose recorded usage: put the delta back for the next attempt.
        for (const [key, row] of Object.entries(delta)) mergeDay(this.pending, key, row);
        console.warn("[TokenStatsStore] persist failed:", err?.message || err);
        // Retry once shortly; after that, wait for the next recorded request so
        // a permanently broken data directory cannot spin in the background.
        if (!this.failedOnce) {
          this.failedOnce = true;
          this.schedulePersist(Math.min(this.retryDelay, 5000));
        }
      }
    })();
    try {
      await this.writing;
    } finally {
      this.writing = null;
      if (this.persistAgain) {
        this.persistAgain = false;
        this.schedulePersist(50);
      }
    }
  }

  async writeAtomic(map) {
    await fsp.mkdir(path.dirname(this.storagePath), { recursive: true });
    const tmp = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(map), "utf8");
    await fsp.rename(tmp, this.storagePath);
  }

  /**
   * Shared, cross-worker view of the daily map. The file holds a single
   * compact record per day, so reading it is trivially cheap; always reading
   * means the dashboard can never show another worker's stale snapshot.
   */
  async snapshot() {
    let disk = await this.readFile();
    if (!disk) disk = this.dailyMap;
    if (this.writing || !Object.keys(this.pending).length) return disk;
    // Include this worker's not-yet-flushed usage. (While a flush is in flight
    // the delta is already part of whichever file version we just read, so it
    // is skipped above to avoid double counting.)
    const view = { ...disk };
    for (const [key, row] of Object.entries(this.pending)) mergeDay(view, key, row);
    return view;
  }

  async getStats({ days = 7, startDate = null, endDate = null } = {}) {
    const map = await this.snapshot();
    let start;
    let end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = new Date();
      start = new Date();
      const span = Math.max(1, Math.min(365, Number(days) || 7));
      start.setDate(end.getDate() - (span - 1));
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      end = new Date();
      start = new Date();
      start.setDate(end.getDate() - 6);
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const daily = [];
    const summary = emptyDay("");
    summary.date = null;
    let cursor = new Date(start);
    let guard = 0;
    while (cursor <= end && guard++ < 400) {
      const key = dayKey(cursor.getTime());
      const row = map[key] || emptyDay(key);
      daily.push(row);
      summary.prompt_tokens += row.prompt_tokens;
      summary.output_tokens += row.output_tokens;
      summary.reasoning_tokens += row.reasoning_tokens;
      summary.cached_tokens += row.cached_tokens;
      summary.total_tokens += row.total_tokens;
      summary.request_count += row.request_count;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { daily, summary };
  }

  async clearStats() {
    this.dailyMap = {};
    this.pending = {};
    await this.withLock(async () => {
      await this.writeAtomic({});
    });
  }
}

// ---------------------------------------------------------------------------
// Audit log store: append-only JSONL with rotation + cached tail reads.
// ---------------------------------------------------------------------------
export class AuditLogStore {
  constructor(options = {}) {
    const basePath = options.storagePath || path.resolve(process.cwd(), "data/request-audit-logs.json");
    // Always write JSONL, even if a legacy ".json" path is passed in.
    this.storagePath = basePath.replace(/\.json$/i, ".jsonl");
    this.backupPath = `${this.storagePath}.1`;
    this.tokenStatsStore = options.tokenStatsStore || null;
    this.cache = null;
    this.cacheAt = 0;
    this.appended = 0;
    this.rotatePending = false;
    this.appendChain = Promise.resolve();
  }

  /** Fire-and-forget append, serialized so lines never interleave. */
  enqueueAppend(line) {
    this.appendChain = this.appendChain
      .then(async () => {
        await fsp.mkdir(path.dirname(this.storagePath), { recursive: true });
        await fsp.appendFile(this.storagePath, line, "utf8");
        this.appended += 1;
        if (this.appended % SIZE_CHECK_EVERY === 0) await this.maybeRotate();
      })
      .catch((err) => {
        console.warn("[AuditLogStore] append failed:", err?.message || err);
      });
    return this.appendChain;
  }

  async maybeRotate() {
    if (this.rotatePending) return;
    this.rotatePending = true;
    const rotateLock = `${this.storagePath}.rotate.lock`;
    try {
      const stat = await fsp.stat(this.storagePath).catch(() => null);
      if (stat && stat.size > MAX_FILE_BYTES) {
        // Take a non-blocking lock so multiple cluster workers don't race
        // to rename/rm at the same time.
        let handle = null;
        try {
          handle = await fsp.open(rotateLock, "wx");
        } catch (err) {
          if (err?.code === "EEXIST") return; // another worker is already rotating
          throw err;
        }
        try {
          const recheck = await fsp.stat(this.storagePath).catch(() => null);
          if (recheck && recheck.size > MAX_FILE_BYTES) {
            await fsp.rm(this.backupPath, { force: true }).catch(() => {});
            await fsp.rename(this.storagePath, this.backupPath).catch(() => {});
            this.cache = null;
            this.cacheAt = 0;
          }
        } finally {
          if (handle) await handle.close().catch(() => {});
          await fsp.rm(rotateLock, { force: true }).catch(() => {});
        }
      }
    } catch (_) {
    } finally {
      this.rotatePending = false;
    }
  }

  async addLog(entry) {
    if (!entry) return;
    const record = {
      id: entry.id,
      timestamp: entry.timestamp || Date.now(),
      time_formatted: entry.time_formatted || new Date(entry.timestamp || Date.now()).toLocaleString("zh-CN", { hour12: false }),
      method: entry.method || "POST",
      url: entry.url || "",
      path: entry.path || "",
      api_type: entry.api_type || null,
      model: entry.model || null,
      account: entry.account || null,
      status_code: entry.status_code ?? 200,
      is_stream: Boolean(entry.is_stream),
      duration_ms: entry.duration_ms ?? 0,
      username: entry.username || null,
      error: entry.error ? safeTruncate(String(entry.error)) : null,
      request_body: safeTruncate(entry.request_body),
      response_body: safeTruncate(entry.response_body),
      usage: normalizeTokenUsage(entry.usage)
    };

    if (this.tokenStatsStore && record.status_code === 200) {
      let usage = record.usage;
      if (!usage && typeof record.response_body === "string") usage = extractUsageFromText(record.response_body);
      if (usage) {
        record.usage = usage;
        this.tokenStatsStore.recordUsage(usage, record.timestamp);
      }
    }

    let line;
    try {
      line = JSON.stringify(record) + "\n";
    } catch (_) {
      return;
    }

    this.cache = null;
    this.cacheAt = 0;
    await this.enqueueAppend(line);
  }

  async readEntries() {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < READ_CACHE_MS) return this.cache;

    const files = [this.backupPath, this.storagePath];
    const entries = [];
    for (const file of files) {
      let handle = null;
      try {
        handle = await fsp.open(file, "r");
        const stat = await handle.stat();
        const length = Math.min(stat.size, READ_TAIL_BYTES);
        const start = Math.max(0, stat.size - length);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        const text = buffer.toString("utf8");
        const lines = text.split("\n");
        if (start > 0) lines.shift(); // drop a possibly partial first line
        for (const line of lines) {
          if (!line || line[0] !== "{") continue;
          try {
            entries.push(JSON.parse(line));
          } catch (_) {}
        }
      } catch (_) {
      } finally {
        if (handle) await handle.close().catch(() => {});
      }
    }

    entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const seen = new Set();
    const deduped = [];
    for (const entry of entries) {
      if (!entry?.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      deduped.push(entry);
    }
    this.cache = deduped;
    this.cacheAt = now;
    return deduped;
  }

  /**
   * Newest-first entries. Bodies are omitted by default (`includeBodies:false`)
   * because a single captured body is up to 256 KB and this gateway often runs
   * behind a slow cross-border link: shipping ten of them at once turns the
   * dashboard into a 20+ second spinner. Callers fetch one entry's bodies only
   * when the user actually expands it.
   */
  async getLogs(n = 10, username = null, { includeBodies = true } = {}) {
    const limit = Math.max(1, Math.min(200, Number(n) || 10));
    const entries = await this.readEntries();
    const filtered = username ? entries.filter((item) => !item.username || item.username === username) : entries;
    const sliced = filtered.slice(0, limit);
    if (includeBodies) return sliced;
    return sliced.map((entry) => {
      const { request_body, response_body, ...rest } = entry;
      return {
        ...rest,
        request_body_bytes: typeof request_body === "string" ? request_body.length : 0,
        response_body_bytes: typeof response_body === "string" ? response_body.length : 0,
        has_body: Boolean(request_body || response_body)
      };
    });
  }

  /** Full record (bodies included) for one id, or null. */
  async getLogById(id, username = null) {
    if (!id) return null;
    const entries = await this.readEntries();
    let entry = entries.find((item) => item.id === id);
    if (!entry) {
      // If not in the cached 6 MB tail, do a fallback linear search backwards in the current file
      try {
        const raw = await fsp.readFile(this.storagePath, "utf8");
        const lines = raw.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (line && line.includes(id)) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.id === id) {
                entry = parsed;
                break;
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    if (!entry) return null;
    if (username && entry.username && entry.username !== username) return null;
    return entry;
  }

  async clearLogs(username = null) {
    const clearLock = `${this.storagePath}.clear.lock`;
    let handle = null;
    try {
      handle = await fsp.open(clearLock, "w");
    } catch (_) {}
    if (username) {
      const entries = await this.readEntries();
      const kept = entries.filter((item) => item.username && item.username !== username);
      await this.appendChain.catch(() => {});
      await fsp.writeFile(this.storagePath, kept.map((item) => JSON.stringify(item)).join("") + (kept.length ? "\n" : ""), "utf8");
    } else {
      await this.appendChain.catch(() => {});
      await fsp.writeFile(this.storagePath, "", "utf8");
      await fsp.rm(this.backupPath, { force: true }).catch(() => {});
    }
    this.cache = null;
    this.cacheAt = 0;
    if (handle) {
      await handle.close().catch(() => {});
      await fsp.rm(clearLock, { force: true }).catch(() => {});
    }
  }
}

let globalAuditLogStore = null;
let globalTokenStatsStore = null;

function resolveDataPath(env, filename) {
  if (env.AUDIT_LOG_DIR) return path.join(env.AUDIT_LOG_DIR, filename);
  if (env.DATA_STORE_PATH) return path.resolve(path.dirname(env.DATA_STORE_PATH), filename);
  return path.resolve(process.cwd(), "data", filename);
}

export function createTokenStatsStore(env = {}) {
  const storagePath = env.TOKEN_STATS_STORE_PATH || resolveDataPath(env, "daily-token-stats.json");
  if (!globalTokenStatsStore || globalTokenStatsStore.storagePath !== storagePath) {
    globalTokenStatsStore = new TokenStatsStore({ storagePath });
  }
  return globalTokenStatsStore;
}

export function createAuditLogStore(env = {}) {
  const storagePath = env.AUDIT_LOG_STORE_PATH || resolveDataPath(env, "request-audit-logs.jsonl");
  const tokenStatsStore = createTokenStatsStore(env);
  if (!globalAuditLogStore || globalAuditLogStore.storagePath !== storagePath.replace(/\.json$/i, ".jsonl")) {
    globalAuditLogStore = new AuditLogStore({ storagePath, tokenStatsStore });
  } else {
    globalAuditLogStore.tokenStatsStore = tokenStatsStore;
  }
  return globalAuditLogStore;
}
