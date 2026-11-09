import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileBackedKV } from "../api/vercel-kv.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-gemplan-cluster-kv-"));
const storePath = path.join(tmpDir, "cluster-store.json");

try {
  // Simulate worker A and worker B
  const workerA = new FileBackedKV({}, storePath);
  const workerB = new FileBackedKV({}, storePath);

  // User logs in on worker A -> creates session:sess_1
  await workerA.put("session:sess_1", "admin", { expirationTtl: 3600 });

  // Immediate request hits worker B with session:sess_1
  const userOnB = await workerB.get("session:sess_1");
  assert.equal(userOnB, "admin", "Worker B must see the session written by Worker A immediately via file sync");

  // Worker B updates an account / config
  await workerB.put("user:admin", JSON.stringify({ name: "admin", accounts: ["acc_1"] }));

  // Worker A must see updated user
  const userOnA = await workerA.get("user:admin", "json");
  assert.deepEqual(userOnA, { name: "admin", accounts: ["acc_1"] }, "Worker A must see user update written by Worker B");

  // Worker A logs out / deletes session
  await workerA.delete("session:sess_1");
  assert.equal(await workerA.get("session:sess_1"), null);
  assert.equal(await workerB.get("session:sess_1"), null, "Worker B must see session deletion");

  console.log("PASS: Multi-worker cluster KV session sync verified!");
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
