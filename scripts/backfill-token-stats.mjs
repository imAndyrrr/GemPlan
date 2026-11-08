import fsp from "node:fs/promises";
import path from "node:path";
import { TokenStatsStore, extractUsageFromText, normalizeTokenUsage } from "../api/audit-log-store.js";

async function main() {
  const auditFile = process.argv[2] || path.resolve(process.cwd(), "data/request-audit-logs.jsonl");
  const statsFile = process.argv[3] || path.resolve(process.cwd(), "data/daily-token-stats.json");

  console.log(`Backfilling token stats from ${auditFile} into ${statsFile}...`);
  const raw = await fsp.readFile(auditFile, "utf8");
  const lines = raw.split("\n");

  const store = new TokenStatsStore({ storagePath: statsFile });
  await store.ready();

  let parsedCount = 0;
  let backfilled = 0;

  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    parsedCount++;
    try {
      const item = JSON.parse(line);
      if (item.status_code !== 200) continue;
      let usage = item.usage;
      if (!usage && typeof item.response_body === "string") {
        usage = extractUsageFromText(item.response_body);
      }
      if (usage) {
        const normalized = normalizeTokenUsage(usage);
        if (normalized) {
          store.recordUsage(normalized, item.timestamp || Date.now());
          backfilled++;
        }
      }
    } catch (_) {}
  }

  await store.persist();
  console.log(`Done! Scanned ${parsedCount} entries, recorded ${backfilled} usages into stats.`);
  const stats = await store.getStats({ days: 1 });
  console.log("Current stats summary:", JSON.stringify(stats.summary, null, 2));
}

main().catch(console.error);
