import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AuditLogStore, TokenStatsStore, normalizeTokenUsage, extractUsageFromText } from "../api/audit-log-store.js";
import worker from "../src/worker.js";

const tmpDir = path.join(os.tmpdir(), `test-gemplan-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(tmpDir, { recursive: true });

try {
  const auditLogPath = path.join(tmpDir, "request-audit-logs.json");
  const tokenStatsPath = path.join(tmpDir, "daily-token-stats.json");

  // ==========================================
  // 1. Token normalization tests
  // ==========================================
  const googleMeta = {
    promptTokenCount: 120,
    candidatesTokenCount: 50,
    thoughtsTokenCount: 15,
    cachedContentTokenCount: 30,
    totalTokenCount: 185
  };
  const normGoogle = normalizeTokenUsage(googleMeta);
  assert.equal(normGoogle.prompt_tokens, 120);
  assert.equal(normGoogle.output_tokens, 50);
  assert.equal(normGoogle.reasoning_tokens, 15);
  assert.equal(normGoogle.cached_tokens, 30);
  assert.equal(normGoogle.total_tokens, 185);

  const oaiUsage = {
    prompt_tokens: 200,
    completion_tokens: 80,
    total_tokens: 280,
    cache_read_input_tokens: 50
  };
  const normOai = normalizeTokenUsage(oaiUsage);
  assert.equal(normOai.prompt_tokens, 200);
  assert.equal(normOai.output_tokens, 80);
  assert.equal(normOai.cached_tokens, 50);
  assert.equal(normOai.total_tokens, 280);

  const sseChunkText = 'data: {"response":{"usageMetadata":{"promptTokenCount":300,"candidatesTokenCount":90,"thoughtsTokenCount":20,"totalTokenCount":410}}}\n\n';
  const extractedFromSse = extractUsageFromText(sseChunkText);
  assert.ok(extractedFromSse);
  assert.equal(extractedFromSse.prompt_tokens, 300);
  assert.equal(extractedFromSse.output_tokens, 90);
  assert.equal(extractedFromSse.reasoning_tokens, 20);

  console.log("PASS: Token normalization and SSE extraction tests");

  // ==========================================
  // 2. TokenStatsStore unit and persistence tests
  // ==========================================
  const tokenStore1 = new TokenStatsStore({ storagePath: tokenStatsPath });
  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  // Record on today
  tokenStore1.recordUsage({
    prompt_tokens: 1000,
    output_tokens: 400,
    reasoning_tokens: 100,
    cached_tokens: 300,
    total_tokens: 1500
  }, nowMs);

  // Record another request on today to verify day-level aggregation
  tokenStore1.recordUsage({
    prompt_tokens: 500,
    output_tokens: 200,
    reasoning_tokens: 50,
    cached_tokens: 100,
    total_tokens: 750
  }, nowMs);

  // Record on yesterday
  tokenStore1.recordUsage({
    prompt_tokens: 2000,
    output_tokens: 800,
    reasoning_tokens: 200,
    cached_tokens: 500,
    total_tokens: 3000
  }, nowMs - oneDayMs);

  assert.ok(fs.existsSync(tokenStatsPath), "Token stats must persist to disk");

  // Reload into a second instance to verify atomic file persistence
  const tokenStore2 = new TokenStatsStore({ storagePath: tokenStatsPath });
  const stats7 = tokenStore2.getStats({ days: 7 });

  assert.equal(stats7.daily.length, 7, "Must generate continuous 7 days of daily records");
  assert.equal(stats7.summary.request_count, 3, "Total 3 requests aggregated");
  assert.equal(stats7.summary.prompt_tokens, 3500);
  assert.equal(stats7.summary.output_tokens, 1400);
  assert.equal(stats7.summary.reasoning_tokens, 350);
  assert.equal(stats7.summary.cached_tokens, 900);
  assert.equal(stats7.summary.total_tokens, 5250);

  console.log("PASS: TokenStatsStore daily aggregation, persistence, and summary calculations");

  // ==========================================
  // 3. AuditLogStore unit and persistence tests
  // ==========================================
  const auditStore1 = new AuditLogStore({
    storagePath: auditLogPath,
    tokenStatsStore: tokenStore2
  });

  await auditStore1.addLog({
    id: "log_test_01",
    timestamp: nowMs,
    time_formatted: "2026-11-08 16:00:00",
    method: "POST",
    url: "/v1/chat/completions",
    status_code: 200,
    username: "admin",
    model: "gemini-2.5-flash-agy",
    request_body: { model: "gemini-2.5-flash-agy", messages: [{ role: "user", content: "Hello!" }] },
    response_body: { id: "chatcmpl-1", choices: [{ message: { content: "Hi there!" } }] },
    usage: { prompt_tokens: 20, output_tokens: 10, total_tokens: 30 }
  });

  await auditStore1.addLog({
    id: "log_test_02",
    timestamp: nowMs + 100,
    time_formatted: "2026-11-08 16:00:01",
    method: "POST",
    url: "/v1/messages",
    status_code: 200,
    username: "userB",
    model: "claude-3-7-sonnet-agy",
    request_body: { model: "claude-3-7-sonnet-agy", messages: [{ role: "user", content: "Write a poem" }] },
    response_body: { id: "msg-1", content: [{ type: "text", text: "Roses are red" }] },
    usage: { prompt_tokens: 40, output_tokens: 25, total_tokens: 65 }
  });

  assert.ok(fs.existsSync(auditLogPath), "Audit log file must be written to disk");

  const auditStore2 = new AuditLogStore({ storagePath: auditLogPath });
  const logsLatest = await auditStore2.getLogs(10);
  assert.equal(logsLatest.length, 2);
  assert.equal(logsLatest[0].id, "log_test_02", "Newest log must be first (index 0)");
  assert.equal(logsLatest[1].id, "log_test_01");
  assert.equal(logsLatest[0].request_body.model, "claude-3-7-sonnet-agy");

  // Test user filtering
  const adminLogs = await auditStore2.getLogs(10, "admin");
  assert.equal(adminLogs.length, 1);
  assert.equal(adminLogs[0].id, "log_test_01");

  // Test limit n
  const limit1Logs = await auditStore2.getLogs(1);
  assert.equal(limit1Logs.length, 1);
  assert.equal(limit1Logs[0].id, "log_test_02");

  console.log("PASS: AuditLogStore storage, ordering, user filtering, and limit n tests");

  // ==========================================
  // 4. Worker Endpoints & Dashboard Integration
  // ==========================================
  class MemoryKvStore {
    constructor() { this.map = new Map(); }
    async get(k, type) {
      const v = this.map.get(k);
      if (v == null) return null;
      return type === "json" ? (typeof v === "string" ? JSON.parse(v) : v) : v;
    }
    async put(k, v) { this.map.set(k, typeof v === "string" ? v : JSON.stringify(v)); }
    async delete(k) { this.map.delete(k); }
  }

  const kv = new MemoryKvStore();
  await kv.put("user:admin", {
    password_hash: "hash",
    api_config: { custom_path: "admin", api_key: "sk-test-admin" },
    accounts: []
  });
  await kv.put("session:sess_admin", "admin");
  await kv.put("key:sk-test-admin", "admin");
  await kv.put("path:admin", "admin");

  const vpsEnv = {
    GEMINI_KV: kv,
    IS_VPS: "true",
    auditLogStore: auditStore2,
    tokenStatsStore: tokenStore2
  };

  const dummyCtx = { waitUntil: () => {}, drain: async () => {} };

  // 4a. Unauthorized access to /api/logs/recent and /api/token-stats must return 401
  const unauthLogs = await worker.fetch(new Request("https://localhost/api/logs/recent?n=10"), vpsEnv, dummyCtx);
  assert.equal(unauthLogs.status, 401, "Unauthenticated access to logs must be rejected with 401");

  const unauthStats = await worker.fetch(new Request("https://localhost/api/token-stats?days=7"), vpsEnv, dummyCtx);
  assert.equal(unauthStats.status, 401, "Unauthenticated access to token stats must be rejected with 401");

  // 4b. Authenticated access returns valid JSON
  const authLogsReq = new Request("https://localhost/api/logs/recent?n=1", {
    headers: { "Cookie": "session_id=sess_admin" }
  });
  const authLogsRes = await worker.fetch(authLogsReq, vpsEnv, dummyCtx);
  assert.equal(authLogsRes.status, 200);
  const logsJson = await authLogsRes.json();
  assert.equal(logsJson.success, true);
  assert.equal(logsJson.n, 1);
  assert.equal(logsJson.logs.length, 1);
  assert.ok(logsJson.logs[0].request_body, "Request body must be present");
  assert.ok(logsJson.logs[0].response_body, "Response body must be present");

  // 4c. Authenticated access to /api/token-stats
  const authStatsReq = new Request("https://localhost/api/token-stats?days=7", {
    headers: { "Cookie": "session_id=sess_admin" }
  });
  const authStatsRes = await worker.fetch(authStatsReq, vpsEnv, dummyCtx);
  assert.equal(authStatsRes.status, 200);
  const statsJson = await authStatsRes.json();
  assert.equal(statsJson.success, true);
  assert.equal(statsJson.daily.length, 7);
  assert.ok(statsJson.summary.total_tokens > 0);

  // 4d. Dashboard HTML in VPS mode contains Card 5 and Card 6
  const dashReq = new Request("https://localhost/dashboard", {
    headers: { "Cookie": "session_id=sess_admin" }
  });
  const dashRes = await worker.fetch(dashReq, vpsEnv, dummyCtx);
  assert.equal(dashRes.status, 200);
  const dashHtml = await dashRes.text();

  assert.ok(dashHtml.includes("id=\"audit-logs-card\""), "Dashboard in VPS mode must contain audit logs card");
  assert.ok(dashHtml.includes("id=\"view-audit-logs-btn\""), "Dashboard in VPS mode must contain view audit logs button");
  assert.ok(dashHtml.includes("id=\"audit-log-n\""), "Dashboard in VPS mode must contain n input for user setting");
  assert.ok(dashHtml.includes("id=\"token-stats-card\""), "Dashboard in VPS mode must contain token stats card");
  assert.ok(dashHtml.includes("id=\"token-bar-svg\""), "Dashboard in VPS mode must contain token bar svg");
  assert.ok(dashHtml.includes("fetchRecentAuditLogs"), "Dashboard in VPS mode must have fetchRecentAuditLogs script");
  assert.ok(dashHtml.includes("renderTokenBarChart"), "Dashboard in VPS mode must have renderTokenBarChart script");

  // Verify that the injected script has zero syntax errors
  const scriptMatch = dashHtml.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, "Dashboard HTML must contain a script block");
  const vm = await import("node:vm");
  assert.doesNotThrow(() => {
    new vm.Script(scriptMatch[1]);
  }, "Dashboard embedded JavaScript must compile with zero syntax errors");

  // 4e. Dashboard HTML in non-VPS mode (Cloudflare Worker) omits Card 5 and Card 6
  const cfEnv = { GEMINI_KV: kv, IS_VPS: "false" };
  const cfDashRes = await worker.fetch(dashReq, cfEnv, dummyCtx);
  assert.equal(cfDashRes.status, 200);
  const cfDashHtml = await cfDashRes.text();
  assert.ok(!cfDashHtml.includes("id=\"audit-logs-card\""), "CF Worker dashboard must NOT contain audit logs card");
  assert.ok(!cfDashHtml.includes("id=\"token-stats-card\""), "CF Worker dashboard must NOT contain token stats card");

  console.log("PASS: Worker endpoints and Dashboard HTML rendering for VPS vs CF Worker");

  console.log("\nALL VPS AUDIT LOGS & TOKEN STATS TESTS PASSED!");
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
