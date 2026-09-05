// Regression checks: retrying an Antigravity request must preserve the full
// request contents and only rotate the outer requestId.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");

const forbiddenContextMutation = [
  "RETRY_CONTINUE_TEXTS",
  "effectiveContents.concat",
  "compactContentsForRetry",
  "compactFraction",
  "emptyCompactFraction"
];
for (const marker of forbiddenContextMutation) {
  if (src.includes(marker)) {
    throw new Error(`retry still mutates or compacts context: ${marker}`);
  }
}

if (!src.includes("const serializeAttemptPayload = (attemptPayload) =>")) {
  throw new Error("retry serializer is missing");
}
if (!src.includes("return { ...basePayload, requestId: `agent/${timestampMs}/${randomHex}` };")) {
  throw new Error("Antigravity retry requestId rotation is missing");
}
if (!src.includes("return retrySerializedPrefix + JSON.stringify(attemptPayload.requestId) + retrySerializedSuffix;")) {
  throw new Error("retry serializer does not preserve the serialized request body");
}

console.log("PASS: retries preserve complete context and rotate only requestId");
