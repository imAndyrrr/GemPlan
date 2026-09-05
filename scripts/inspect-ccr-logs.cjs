const Database = require("better-sqlite3");
const path = "C:\\Users\\imAndyrrr\\AppData\\Roaming\\claude-code-router\\request-logs.sqlite";
const db = new Database(path, { readonly: true });
const rows = db.prepare(`
  SELECT id, created_at, provider, model, requested_model, is_stream, status_code,
         input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
         substr(response_body_text, 1, 1) as resp_start
  FROM request_logs
  WHERE provider LIKE '%gemplan%' OR url LIKE '%gemplan%' OR requested_model LIKE '%agy%'
  ORDER BY id DESC LIMIT 15
`).all();
console.log(`found ${rows.length} gemplan rows`);
console.table(rows.map(r => ({
  id: r.id,
  created: new Date(r.created_at).toISOString().slice(5, 19),
  provider: (r.provider || "").slice(0, 40),
  model: r.requested_model,
  stream: r.is_stream ? "Y" : "N",
  status: r.status_code,
  in: r.input_tokens,
  out: r.output_tokens,
  reason: r.reasoning_tokens,
  cacheR: r.cache_read_tokens,
  total: r.total_tokens
})));
