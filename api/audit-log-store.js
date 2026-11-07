import fs from "node:fs";
import path from "node:path";

const MAX_LOGS = 200;
const MAX_BODY_LENGTH = 2 * 1024 * 1024; // 2MB limit per body to protect memory

function safeTruncate(content) {
  if (content === null || content === undefined) return content;
  if (typeof content === "string") {
    if (content.length > MAX_BODY_LENGTH) {
      return content.slice(0, MAX_BODY_LENGTH) + "\n\n[TRUNCATED: Body exceeded 2MB limit]";
    }
    return content;
  }
  return content;
}

export function normalizeTokenUsage(meta) {
  if (!meta) return null;
  const prompt_tokens = Number(meta.promptTokenCount || meta.prompt_tokens || meta.input_tokens || 0);
  const candidates_tokens = Number(meta.candidatesTokenCount || meta.output_tokens || meta.completion_tokens || 0);
  const reasoning_tokens = Number(meta.thoughtsTokenCount || meta.reasoning_tokens || meta.reasoning_tokens_details?.reasoning_tokens || 0);
  const cached_tokens = Number(meta.cachedContentTokenCount || meta.cached_tokens || meta.cache_read_input_tokens || meta.prompt_tokens_details?.cached_tokens || 0);
  const output_tokens = candidates_tokens;
  const total_tokens = Number(meta.totalTokenCount || meta.total_tokens || (prompt_tokens + output_tokens + reasoning_tokens));
  if (prompt_tokens === 0 && output_tokens === 0 && reasoning_tokens === 0 && cached_tokens === 0 && total_tokens === 0) {
    return null;
  }
  return {
    prompt_tokens,
    output_tokens,
    reasoning_tokens,
    cached_tokens,
    total_tokens
  };
}

export function extractUsageFromText(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/"usageMetadata"\s*:\s*(\{[^}]+\})/);
  if (m) {
    try { return normalizeTokenUsage(JSON.parse(m[1])); } catch (_) {}
  }
  const m2 = text.match(/"usage"\s*:\s*(\{[^}]+\})/);
  if (m2) {
    try { return normalizeTokenUsage(JSON.parse(m2[1])); } catch (_) {}
  }
  return null;
}

export class TokenStatsStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "data/daily-token-stats.json");
    this.dailyMap = {};
    this.loadFromFile();
  }

  loadFromFile() {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.dailyMap = parsed;
        }
      }
    } catch (_) {}
  }

  saveToFile() {
    if (!this.storagePath) return;
    let tempPath = null;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.dailyMap, null, 2), "utf8");
      fs.renameSync(tempPath, this.storagePath);
    } catch (e) {
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      console.warn("[TokenStatsStore] Failed to save stats:", e?.message || e);
    }
  }

  recordUsage(usage, timestamp = Date.now(), model = null, username = null) {
    const normalized = normalizeTokenUsage(usage);
    if (!normalized) return;
    this.loadFromFile();
    const d = new Date(timestamp);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (!this.dailyMap[dateStr]) {
      this.dailyMap[dateStr] = {
        date: dateStr,
        prompt_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cached_tokens: 0,
        total_tokens: 0,
        request_count: 0
      };
    }

    const row = this.dailyMap[dateStr];
    row.prompt_tokens += normalized.prompt_tokens;
    row.output_tokens += normalized.output_tokens;
    row.reasoning_tokens += normalized.reasoning_tokens;
    row.cached_tokens += normalized.cached_tokens;
    row.total_tokens += normalized.total_tokens;
    row.request_count += 1;

    this.saveToFile();
  }

  getStats({ days = 7, startDate = null, endDate = null, username = null } = {}) {
    this.loadFromFile();

    const result = [];
    const summary = {
      total_tokens: 0,
      prompt_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      request_count: 0
    };

    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = new Date();
      start = new Date();
      start.setDate(end.getDate() - (Math.max(1, Math.min(365, Number(days) || 7)) - 1));
    }

    const curr = new Date(start);
    curr.setHours(0, 0, 0, 0);
    const endBound = new Date(end);
    endBound.setHours(23, 59, 59, 999);

    while (curr <= endBound) {
      const dateStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}-${String(curr.getDate()).padStart(2, "0")}`;
      const existing = this.dailyMap[dateStr] || {
        date: dateStr,
        prompt_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cached_tokens: 0,
        total_tokens: 0,
        request_count: 0
      };

      result.push(existing);
      summary.total_tokens += existing.total_tokens;
      summary.prompt_tokens += existing.prompt_tokens;
      summary.output_tokens += existing.output_tokens;
      summary.reasoning_tokens += existing.reasoning_tokens;
      summary.cached_tokens += existing.cached_tokens;
      summary.request_count += existing.request_count;

      curr.setDate(curr.getDate() + 1);
    }

    return {
      daily: result,
      summary
    };
  }

  clearStats() {
    this.dailyMap = {};
    this.saveToFile();
  }
}

let globalTokenStatsStore = null;

export function createTokenStatsStore(env = {}) {
  const storagePath = env.TOKEN_STATS_STORE_PATH || (env.DATA_STORE_PATH
    ? path.resolve(path.dirname(env.DATA_STORE_PATH), "daily-token-stats.json")
    : path.resolve(process.cwd(), "data/daily-token-stats.json"));

  if (!globalTokenStatsStore || globalTokenStatsStore.storagePath !== storagePath) {
    globalTokenStatsStore = new TokenStatsStore({ storagePath });
  }
  return globalTokenStatsStore;
}

export class AuditLogStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.resolve(process.cwd(), "data/request-audit-logs.json");
    this.memoryLogs = [];
    this.maxLogs = options.maxLogs || MAX_LOGS;
    this.tokenStatsStore = options.tokenStatsStore || null;
    this.loadFromFile();
  }

  loadFromFile() {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.memoryLogs = parsed.slice(0, this.maxLogs);
        }
      }
    } catch (_) {
      // Keep existing in-memory logs on read error
    }
  }

  saveToFile() {
    if (!this.storagePath) return;
    let tempPath = null;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.memoryLogs, null, 2), "utf8");
      fs.renameSync(tempPath, this.storagePath);
    } catch (e) {
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      console.warn("[AuditLogStore] Failed to atomically save logs:", e?.message || e);
    }
  }

  async addLog(entry) {
    if (!entry) return;
    const cloned = { ...entry };
    cloned.request_body = safeTruncate(cloned.request_body);
    cloned.response_body = safeTruncate(cloned.response_body);

    // Sync from file in case another worker process updated it
    this.loadFromFile();

    // Deduplicate if entry with same id already exists (e.g. streaming update)
    const existingIdx = this.memoryLogs.findIndex((item) => item.id === cloned.id);
    if (existingIdx !== -1) {
      this.memoryLogs[existingIdx] = cloned;
    } else {
      this.memoryLogs.unshift(cloned);
    }

    if (this.memoryLogs.length > this.maxLogs) {
      this.memoryLogs = this.memoryLogs.slice(0, this.maxLogs);
    }
    this.saveToFile();

    // Record token usage if successful response
    if (this.tokenStatsStore && cloned.status_code === 200) {
      let usage = cloned.usage ? normalizeTokenUsage(cloned.usage) : normalizeTokenUsage(cloned.response_body?.usage || cloned.response_body?.usageMetadata);
      if (!usage && typeof cloned.response_body === "string") {
        usage = extractUsageFromText(cloned.response_body);
      }
      if (usage) {
        this.tokenStatsStore.recordUsage(usage, cloned.timestamp, cloned.model, cloned.username);
      }
    }
  }

  async getLogs(n = 10, username = null) {
    this.loadFromFile();
    let result = this.memoryLogs;
    if (username) {
      result = result.filter((item) => !item.username || item.username === username);
    }
    const limit = Math.max(1, Math.min(this.maxLogs, Number(n) || 10));
    return result.slice(0, limit);
  }

  async clearLogs(username = null) {
    if (username) {
      this.loadFromFile();
      this.memoryLogs = this.memoryLogs.filter((item) => item.username && item.username !== username);
    } else {
      this.memoryLogs = [];
    }
    this.saveToFile();
  }
}

let globalAuditLogStore = null;

export function createAuditLogStore(env = {}) {
  const storagePath = env.AUDIT_LOG_STORE_PATH || (env.DATA_STORE_PATH
    ? path.resolve(path.dirname(env.DATA_STORE_PATH), "request-audit-logs.json")
    : path.resolve(process.cwd(), "data/request-audit-logs.json"));

  const tokenStatsStore = createTokenStatsStore(env);

  if (!globalAuditLogStore || globalAuditLogStore.storagePath !== storagePath) {
    globalAuditLogStore = new AuditLogStore({ storagePath, tokenStatsStore });
  } else {
    globalAuditLogStore.tokenStatsStore = tokenStatsStore;
  }
  return globalAuditLogStore;
}
