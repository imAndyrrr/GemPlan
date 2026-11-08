// Regression tests for the VPS-only audit log viewer + daily token stats.
//
// These tests deliberately exercise the paths that broke production:
//   * a streaming request WITH audit logging enabled must still stream to the
//     client in full (the old readable.tee() implementation deadlocked here),
//   * a burst of large requests must not block the event loop on disk I/O
//     (the old implementation rewrote the whole log file per request),
//   * the dashboard script must compile.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { AuditLogStore, TokenStatsStore, normalizeTokenUsage, extractUsageFromText } from "../api/audit-log-store.js";
import worker from "../src/worker.js";

const tmpDir = path.join(os.tmpdir(), `test-gemplan-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(tmpDir, { recursive: true });

const originalFetch = globalThis.fetch;

function makeKv(entries) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    async get(key, type) {
      const value = map.get(key);
      if (value === undefined) return null;
      if (type === "json") return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    async put(key, value) {
      map.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    async delete(key) {
      map.delete(key);
    }
  };
}

function makeCtx() {
  const pending = [];
  return {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    async drain() {
      await Promise.allSettled(pending);
    }
  };
}

function makeUser(customPath = "rt", apiKey = "sk-rt") {
  return {
    password_hash: "x",
    machine_id: "m",
    accounts: [
      {
        id: "acc_stream",
        email: "stream@example.test",
        mode: "antigravity",
        enabled: true,
        status: "active",
        last_used_at: 0,
        cooldown_until: 0,
        machine_id: "m",
        tokens: {
          access_token: "token",
          refresh_token: "refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          project_id: "project"
        }
      }
    ],
    api_config: {
      custom_path: customPath,
      api_key: apiKey,
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
}

function sseChunk(text, usage) {
  return (
    "data: " +
    JSON.stringify({
      response: {
        candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
        ...(usage ? { usageMetadata: usage } : {})
      }
    }) +
    "\n\n"
  );
}

function streamUpstream(chunkCount) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (let i = 0; i < chunkCount; i++) {
          controller.enqueue(encoder.encode(sseChunk(`part-${i} `)));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        controller.enqueue(
          encoder.encode(sseChunk("DONE", { promptTokenCount: 11, candidatesTokenCount: 7, thoughtsTokenCount: 3, cachedContentTokenCount: 4, totalTokenCount: 21 }))
        );
        controller.close();
      }
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

async function readAllWithTimeout(body, timeoutMs) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`stream stalled: only ${text.length} chars after ${timeoutMs}ms`);
    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), remaining))
    ]);
    if (result.__timeout) throw new Error(`stream stalled: only ${text.length} chars after ${timeoutMs}ms`);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
    await new Promise((resolve) => setTimeout(resolve, 1)); // simulate a slow consumer
  }
  return text + decoder.decode();
}

try {
  const auditPath = path.join(tmpDir, "request-audit-logs.jsonl");
  const statsPath = path.join(tmpDir, "daily-token-stats.json");

  // ---------------------------------------------------------------- tokens ---
  const googleUsage = normalizeTokenUsage({
    promptTokenCount: 120,
    candidatesTokenCount: 50,
    thoughtsTokenCount: 15,
    cachedContentTokenCount: 30,
    totalTokenCount: 185
  });
  assert.deepEqual(googleUsage, {
    prompt_tokens: 120,
    output_tokens: 50,
    reasoning_tokens: 15,
    cached_tokens: 30,
    total_tokens: 185
  });

  const openAiUsage = normalizeTokenUsage({
    prompt_tokens: 200,
    completion_tokens: 80,
    total_tokens: 280,
    cache_read_input_tokens: 50
  });
  assert.deepEqual(openAiUsage, {
    prompt_tokens: 200,
    output_tokens: 80,
    reasoning_tokens: 0,
    cached_tokens: 50,
    total_tokens: 280
  });
  assert.equal(normalizeTokenUsage({}), null, "empty usage must be ignored");

  const sseTail = 'data: {"x":1}\n\n' + sseChunk("hi", { promptTokenCount: 300, candidatesTokenCount: 90, thoughtsTokenCount: 20, totalTokenCount: 410 });
  const extracted = extractUsageFromText(sseTail);
  assert.equal(extracted.prompt_tokens, 300);
  assert.equal(extracted.output_tokens, 90);
  assert.equal(extracted.reasoning_tokens, 20);
  console.log("PASS: token usage normalization and SSE extraction");

  // ----------------------------------------------------------- token stats ---
  const tokenStore = new TokenStatsStore({ storagePath: statsPath });
  const nowMs = Date.now();
  tokenStore.recordUsage({ prompt_tokens: 1000, output_tokens: 400, reasoning_tokens: 100, cached_tokens: 300, total_tokens: 1500 }, nowMs);
  tokenStore.recordUsage({ prompt_tokens: 500, output_tokens: 200, reasoning_tokens: 50, cached_tokens: 100, total_tokens: 750 }, nowMs);
  tokenStore.recordUsage({ prompt_tokens: 2000, output_tokens: 800, reasoning_tokens: 200, cached_tokens: 500, total_tokens: 3000 }, nowMs - 86400000);
  await tokenStore.persist();
  assert.ok(fs.existsSync(statsPath), "token stats must be persisted");

  const reloaded = new TokenStatsStore({ storagePath: statsPath });
  const stats7 = await reloaded.getStats({ days: 7 });
  assert.equal(stats7.daily.length, 7, "must return a continuous 7-day series");
  assert.equal(stats7.summary.request_count, 3);
  assert.equal(stats7.summary.prompt_tokens, 3500);
  assert.equal(stats7.summary.output_tokens, 1400);
  assert.equal(stats7.summary.reasoning_tokens, 350);
  assert.equal(stats7.summary.cached_tokens, 900);
  assert.equal(stats7.summary.total_tokens, 5250);

  const statsWithRange = await reloaded.getStats({ startDate: "2026-01-01", endDate: "2026-01-03" });
  assert.equal(statsWithRange.daily.length, 3, "custom date range must be inclusive");
  console.log("PASS: daily token stats aggregation, persistence, and range queries");

  // Two cluster workers share one file. Neither may clobber the other, and both
  // must answer /api/token-stats with the same totals.
  const sharedStatsPath = path.join(tmpDir, "daily-token-stats-cluster.json");
  const workerA = new TokenStatsStore({ storagePath: sharedStatsPath });
  const workerB = new TokenStatsStore({ storagePath: sharedStatsPath });
  await workerA.ready();
  await workerB.ready();
  workerA.recordUsage({ prompt_tokens: 100, output_tokens: 10, total_tokens: 110 }, nowMs);
  await workerA.persist();
  workerB.recordUsage({ prompt_tokens: 200, output_tokens: 20, total_tokens: 220 }, nowMs);
  await workerB.persist();
  workerA.recordUsage({ prompt_tokens: 7, output_tokens: 3, total_tokens: 10 }, nowMs);
  await workerA.persist();

  const viewA = await workerA.getStats({ days: 1 });
  const viewB = await workerB.getStats({ days: 1 });
  for (const view of [viewA, viewB]) {
    assert.equal(view.summary.request_count, 3, "both workers must see every worker's usage");
    assert.equal(view.summary.prompt_tokens, 307, "prompt tokens must be merged, not overwritten");
    assert.equal(view.summary.output_tokens, 33, "output tokens must be merged, not overwritten");
  }
  const onDisk = JSON.parse(fs.readFileSync(sharedStatsPath, "utf8"));
  const today = new Date(nowMs);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(onDisk[todayKey].request_count, 3, "the shared file must hold the merged totals");

  // A worker that has not flushed yet must still see its own usage.
  const workerC = new TokenStatsStore({ storagePath: sharedStatsPath });
  workerC.recordUsage({ prompt_tokens: 5, output_tokens: 5, total_tokens: 10 }, nowMs);
  const unflushedView = await workerC.getStats({ days: 1 });
  assert.equal(unflushedView.summary.request_count, 4, "unflushed usage must be visible locally");
  await workerC.persist();
  const afterFlush = await workerA.getStats({ days: 1 });
  assert.equal(afterFlush.summary.request_count, 4, "flushed usage must be visible to the other worker");
  console.log("PASS: token stats stay consistent across cluster workers");

  // ---------------------------------------------------------- audit store ---
  const auditStore = new AuditLogStore({ storagePath: auditPath, tokenStatsStore: reloaded });
  await auditStore.addLog({
    id: "log_a",
    timestamp: nowMs,
    method: "POST",
    url: "/rt/v1/chat/completions",
    status_code: 200,
    username: "admin",
    model: "gemini-test-agy",
    request_body: '{"model":"gemini-test-agy"}',
    response_body: '{"choices":[]}',
    usage: { prompt_tokens: 20, output_tokens: 10, total_tokens: 30 }
  });
  await auditStore.addLog({
    id: "log_b",
    timestamp: nowMs + 100,
    method: "POST",
    url: "/rt/v1/messages",
    status_code: 200,
    username: "someone-else",
    model: "claude-test-agy",
    request_body: '{"model":"claude-test-agy"}',
    response_body: '{"content":[]}',
    usage: { prompt_tokens: 40, output_tokens: 25, total_tokens: 65 }
  });

  assert.ok(fs.existsSync(auditPath), "audit log must be written as JSONL");
  const rawAudit = await fsp.readFile(auditPath, "utf8");
  assert.equal(rawAudit.trim().split("\n").length, 2, "one request must append exactly one line");
  assert.ok(rawAudit.startsWith("{"), "JSONL storage must not be a JSON array");

  const newest = await auditStore.getLogs(10);
  assert.equal(newest.length, 2);
  assert.equal(newest[0].id, "log_b", "newest entry must come first");
  assert.equal((await auditStore.getLogs(1)).length, 1, "n must be honoured");
  const adminOnly = await auditStore.getLogs(10, "admin");
  assert.deepEqual(adminOnly.map((item) => item.id), ["log_a"]);

  // Bodies larger than the capture limit must be truncated, never stored whole.
  await auditStore.addLog({
    id: "log_big",
    timestamp: nowMs + 200,
    status_code: 200,
    request_body: "x".repeat(1024 * 1024),
    response_body: "y".repeat(1024 * 1024)
  });
  const bigEntry = (await auditStore.getLogs(1))[0];
  assert.equal(bigEntry.id, "log_big");
  assert.ok(bigEntry.request_body.length < 300 * 1024, "oversized request body must be capped");
  assert.ok(bigEntry.request_body.includes("TRUNCATED"), "truncation must be marked in the record");
  console.log("PASS: audit log JSONL storage, ordering, filtering, n limit, and body caps");

  // ------------------------------------------------- request-path pressure ---
  // A burst of large requests must stay fast: the old implementation rewrote
  // the entire log file synchronously for every single request.
  {
    const bulkStore = new AuditLogStore({ storagePath: path.join(tmpDir, "bulk.jsonl") });
    const bigBody = "z".repeat(200 * 1024);
    const started = Date.now();
    const writes = [];
    for (let i = 0; i < 40; i++) {
      writes.push(
        bulkStore.addLog({
          id: `bulk_${i}`,
          timestamp: nowMs + i,
          status_code: 200,
          request_body: bigBody,
          response_body: bigBody
        })
      );
    }
    await Promise.all(writes);
    const elapsed = Date.now() - started;
    const bulkSize = (await fsp.stat(path.join(tmpDir, "bulk.jsonl"))).size;
    assert.ok(elapsed < 5000, `40 audited requests must not take ${elapsed}ms (disk I/O must not block)`);
    assert.ok(bulkSize < 24 * 1024 * 1024, "audit file must stay below the rotation threshold");
    const bulkLogs = await bulkStore.getLogs(5);
    assert.equal(bulkLogs.length, 5);
  }
  console.log("PASS: audit writes stay off the critical path under burst load");

  // ------------------------------------------ end-to-end streaming + audit ---
  {
    const kv = makeKv({
      "key:sk-rt": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser())
    });
    const streamAudit = new AuditLogStore({ storagePath: path.join(tmpDir, "stream.jsonl") });
    const env = { GEMINI_KV: kv, IS_VPS: "true", auditLogStore: streamAudit, tokenStatsStore: reloaded };
    const ctx = makeCtx();
    globalThis.fetch = async () => streamUpstream(12);

    const response = await worker.fetch(
      new Request("https://example.test/rt/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-rt" },
        body: JSON.stringify({ model: "gemini-test-agy", messages: [{ role: "user", content: "hi" }], stream: true })
      }),
      env,
      ctx
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/event-stream");
    const streamed = await readAllWithTimeout(response.body, 8000);
    assert.ok(streamed.includes("part-0"), "first chunk must reach the client");
    assert.ok(streamed.includes("part-11"), "last chunk must reach the client");
    assert.ok(streamed.includes("DONE"), "stream must be complete");
    assert.ok(streamed.includes("[DONE]"), "stream must be terminated properly");

    await ctx.drain();
    await streamAudit.appendChain;
    const recorded = await streamAudit.getLogs(5);
    assert.equal(recorded.length, 1, "the streamed request must be audited");
    assert.equal(recorded[0].model, "gemini-test-agy");
    assert.equal(recorded[0].status_code, 200);
    assert.ok(recorded[0].request_body.includes("gemini-test-agy"), "request body must be captured");
    assert.ok(recorded[0].response_body.includes("part-0"), "streamed response body must be captured");
    assert.ok(recorded[0].duration_ms >= 0);
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: streaming request completes while audit logging is enabled");

  // --------------------------------------- non-streaming + failure capture ---
  {
    const kv = makeKv({
      "key:sk-rt": "runtime-user",
      "user:runtime-user": JSON.stringify(makeUser())
    });
    const plainAudit = new AuditLogStore({ storagePath: path.join(tmpDir, "plain.jsonl") });
    const env = { GEMINI_KV: kv, IS_VPS: "true", auditLogStore: plainAudit };
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: "plain-ok" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const response = await worker.fetch(
      new Request("https://example.test/rt/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-rt" },
        body: JSON.stringify({ model: "gemini-test-agy", messages: [{ role: "user", content: "hi" }] })
      }),
      env,
      makeCtx()
    );
    const payload = await response.json();
    assert.equal(payload.choices[0].message.content, "plain-ok");
    await plainAudit.appendChain;
    const entries = await plainAudit.getLogs(5);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].is_stream, false);
    assert.equal(entries[0].status_code, 200);
    globalThis.fetch = originalFetch;
  }
  console.log("PASS: non-streaming request still returns its payload and is audited");

  // --------------------------------------------------- dashboard / routes ---
  {
    const kv = makeKv({
      "key:sk-admin": "admin",
      "session:sess_admin": "admin",
      "user:admin": JSON.stringify({ ...makeUser("admin", "sk-admin"), accounts: [] })
    });
    const audit = new AuditLogStore({ storagePath: path.join(tmpDir, "dash.jsonl"), tokenStatsStore: reloaded });
    await audit.addLog({ id: "dash_1", timestamp: Date.now(), status_code: 200, username: "admin", request_body: '{"a":1}', response_body: '{"b":2}' });
    const env = { GEMINI_KV: kv, IS_VPS: "true", auditLogStore: audit, tokenStatsStore: reloaded };

    const unauth = await worker.fetch(new Request("https://example.test/api/logs/recent?n=5"), env, makeCtx());
    assert.equal(unauth.status, 401, "audit log endpoint must require a session");
    const unauthStats = await worker.fetch(new Request("https://example.test/api/token-stats?days=7"), env, makeCtx());
    assert.equal(unauthStats.status, 401, "token stats endpoint must require a session");

    const cookie = { Cookie: "session_id=sess_admin" };
    const logsRes = await worker.fetch(new Request("https://example.test/api/logs/recent?n=1", { headers: cookie }), env, makeCtx());
    assert.equal(logsRes.status, 200);
    const logsJson = await logsRes.json();
    assert.equal(logsJson.success, true);
    assert.equal(logsJson.logs.length, 1);
    assert.equal(logsJson.logs[0].request_body, undefined, "the list must not ship bodies");
    assert.equal(logsJson.logs[0].request_body_bytes, 7, "the list must report body sizes");
    assert.equal(logsJson.logs[0].has_body, true);

    const entryRes = await worker.fetch(new Request("https://example.test/api/logs/entry?id=dash_1", { headers: cookie }), env, makeCtx());
    assert.equal(entryRes.status, 200);
    const entryJson = await entryRes.json();
    assert.equal(entryJson.log.request_body, '{"a":1}', "the on-demand endpoint must return the body");
    assert.equal(entryJson.log.response_body, '{"b":2}');
    const missingEntry = await worker.fetch(new Request("https://example.test/api/logs/entry?id=nope", { headers: cookie }), env, makeCtx());
    assert.equal(missingEntry.status, 404);
    const unauthEntry = await worker.fetch(new Request("https://example.test/api/logs/entry?id=dash_1"), env, makeCtx());
    assert.equal(unauthEntry.status, 401, "entry endpoint must require a session");

    // A large n must not produce a multi-megabyte list that takes the page out.
    {
      const bulkAudit = new AuditLogStore({ storagePath: path.join(tmpDir, "budget.jsonl") });
      const chunk = "x".repeat(250 * 1024);
      for (let i = 0; i < 20; i += 1) {
        bulkAudit.enqueueAppend(
          JSON.stringify({
            id: `budget_${i}`,
            timestamp: Date.now() + i,
            status_code: 200,
            username: "admin",
            request_body: chunk,
            response_body: chunk
          }) + "\n"
        );
      }
      await bulkAudit.appendChain;
      const bulkEnv = { ...env, auditLogStore: bulkAudit };
      const bigRes = await worker.fetch(new Request("https://example.test/api/logs/recent?n=20", { headers: cookie }), bulkEnv, makeCtx());
      assert.equal(bigRes.status, 200);
      const listText = await bigRes.text();
      assert.ok(listText.length < 64 * 1024, `metadata list must stay small, got ${listText.length} bytes`);
      const bigJson = JSON.parse(listText);
      assert.ok(bigJson.logs.length >= 8, "the list must still contain the requested entries");

      const oneRes = await worker.fetch(new Request("https://example.test/api/logs/entry?id=budget_19", { headers: cookie }), bulkEnv, makeCtx());
      assert.equal(oneRes.status, 200);
      const oneJson = await oneRes.json();
      assert.ok(oneJson.log.request_body.length <= 260 * 1024, "a single body stays capped");
    }

    const statsRes = await worker.fetch(new Request("https://example.test/api/token-stats?days=7", { headers: cookie }), env, makeCtx());
    assert.equal(statsRes.status, 200);
    const statsJson = await statsRes.json();
    assert.equal(statsJson.daily.length, 7);

    const clearRes = await worker.fetch(new Request("https://example.test/api/logs/clear", { method: "POST", headers: cookie }), env, makeCtx());
    assert.equal(clearRes.status, 200);
    assert.equal((await audit.getLogs(5)).length, 0, "clear must empty the audit log");

    // The dashboard must render both cards and its inline script must compile.
    const dashRes = await worker.fetch(new Request("https://example.test/dashboard", { headers: cookie }), env, makeCtx());
    assert.equal(dashRes.status, 200);
    const dashHtml = await dashRes.text();
    assert.ok(dashHtml.includes('id="audit-logs-card"'));
    assert.ok(dashHtml.includes('id="audit-log-n"'));
    assert.ok(dashHtml.includes('id="token-stats-card"'));
    assert.ok(dashHtml.includes('id="token-bar-svg"'));
    const scriptMatch = dashHtml.match(/<script>([\s\S]*?)<\/script>/i);
    assert.ok(scriptMatch, "dashboard must embed its client script");
    assert.doesNotThrow(() => new vm.Script(scriptMatch[1]), "dashboard client script must compile");

    // Cloudflare deployments must not render VPS-only cards.
    const cfDash = await worker.fetch(new Request("https://example.test/dashboard", { headers: cookie }), { GEMINI_KV: kv }, makeCtx());
    const cfHtml = await cfDash.text();
    assert.ok(!cfHtml.includes('id="audit-logs-card"'));
    assert.ok(!cfHtml.includes('id="token-stats-card"'));
  }
  console.log("PASS: dashboard routes, auth guards, and VPS-vs-Cloudflare rendering");

  console.log("\nALL VPS AUDIT & TOKEN STATS TESTS PASSED!");
} finally {
  globalThis.fetch = originalFetch;
  // Let debounced token-stat writes finish before the temp directory vanishes.
  await new Promise((resolve) => setTimeout(resolve, 1300));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
