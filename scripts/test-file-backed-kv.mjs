import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileBackedKV, createMemoryOrRestKV } from "../api/vercel-kv.js";

const tmpDir = path.join(os.tmpdir(), `test-gemplan-kv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(tmpDir, { recursive: true });

try {
  const testStorePath = path.join(tmpDir, "store.json");

  // 1. Initial creation when file does not exist: auto-seeds imAndyrrr admin account
  const kv1 = new FileBackedKV({}, testStorePath);
  const adminUser = await kv1.get("user:imAndyrrr", "json");
  assert.ok(adminUser, "admin user imAndyrrr must be automatically seeded");
  assert.equal(await kv1.get("path:imAndyrrr"), "imAndyrrr");
  assert.equal(await kv1.get("key:sk-b43e875b46b418f217c41f1a"), "imAndyrrr");
  assert.ok(fs.existsSync(testStorePath), "store file must be written to disk");

  // 2. Writes across all key categories (user, key, path, session, oauth)
  await kv1.put("user:customUser", { name: "custom", accounts: [] });
  await kv1.put("key:sk-test-12345", "customUser");
  await kv1.put("path:customPath", "customUser");
  await kv1.put("session:sess_12345", "customUser", { expirationTtl: 3600 });
  await kv1.put("oauth:state_xyz", { state: "xyz", mode: "antigravity" }, { expirationTtl: 600 });

  assert.deepEqual(await kv1.get("user:customUser", "json"), { name: "custom", accounts: [] });
  assert.equal(await kv1.get("key:sk-test-12345"), "customUser");
  assert.equal(await kv1.get("path:customPath"), "customUser");
  assert.equal(await kv1.get("session:sess_12345"), "customUser");
  assert.deepEqual(await kv1.get("oauth:state_xyz", "json"), { state: "xyz", mode: "antigravity" });

  // 3. Persistence reload across instances
  const kv2 = new FileBackedKV({}, testStorePath);
  assert.deepEqual(await kv2.get("user:customUser", "json"), { name: "custom", accounts: [] });
  assert.equal(await kv2.get("key:sk-test-12345"), "customUser");
  assert.equal(await kv2.get("session:sess_12345"), "customUser");

  // 4. Deletion works and persists
  await kv2.delete("key:sk-test-12345");
  assert.equal(await kv2.get("key:sk-test-12345"), null);
  const kv3 = new FileBackedKV({}, testStorePath);
  assert.equal(await kv3.get("key:sk-test-12345"), null);

  // 5. List with prefix, limit, cursor
  const listUsers = await kv3.list({ prefix: "user:" });
  assert.ok(listUsers.keys.some((k) => k.name === "user:imAndyrrr"));
  assert.ok(listUsers.keys.some((k) => k.name === "user:customUser"));

  // 6. createMemoryOrRestKV with KV_MODE=local strictly avoids remote CF KV
  const localEnv = {
    KV_MODE: "local",
    DATA_STORE_PATH: testStorePath,
    CF_API_TOKEN: "should_be_ignored_cf_token",
    CF_ACCOUNT_ID: "should_be_ignored_acc",
    CF_KV_NAMESPACE_ID: "should_be_ignored_ns"
  };
  const factoryKv = createMemoryOrRestKV(localEnv, () => {
    throw new Error("NETWORK_FETCH_CALLED: Cloudflare KV must never be called in local mode!");
  });
  assert.ok(factoryKv instanceof FileBackedKV, "Must instantiate FileBackedKV");
  assert.equal(await factoryKv.get("path:imAndyrrr"), "imAndyrrr");

  console.log("PASS: FileBackedKV local file persistence, auto-seed, and offline isolation tests passed!");
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
