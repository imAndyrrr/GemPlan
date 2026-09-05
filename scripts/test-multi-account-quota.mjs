// Comprehensive tests for multi-account support and intelligent quota allocation.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");

function extract(name) {
  const regex = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = src.match(regex);
  if (!match) throw new Error(`${name} not found`);
  const start = match.index;
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const code = `
const __name = (f) => f;
const __name2 = (f) => f;
${extract("checkModelQuota")}
${extract("getUserAccounts")}
const accountUsageMemory = new Map();
${extract("getAccountUsageKey")}
${extract("getEffectiveLastUsed")}
${extract("recordAccountUsage")}
${extract("saveUser")}
async function getAccountCooldowns(accounts) {
  return new Map((accounts || [])
    .filter((account) => account?.id && Number(account.cooldown_until) > 0)
    .map((account) => [account.id, Number(account.cooldown_until)]));
}
${extract("rankAccountsForRequest")}
globalThis.__testFns = {
  checkModelQuota,
  getUserAccounts,
  recordAccountUsage,
  saveUser,
  rankAccountsForRequest
};
`;
new Function(code)();
const { checkModelQuota, getUserAccounts, recordAccountUsage, saveUser, rankAccountsForRequest } = globalThis.__testFns;

// Test 1: Legacy user migration
const legacyUser = {
  password_hash: "hash123",
  google_tokens: { access_token: "ca_tok", refresh_token: "ca_ref", expires_at: 9999999999 },
  antigravity_tokens: { access_token: "ag_tok", refresh_token: "ag_ref", expires_at: 9999999999 }
};
const migratedAccounts = getUserAccounts(legacyUser);
if (!Array.isArray(migratedAccounts) || migratedAccounts.length !== 2) {
  throw new Error("Failed to migrate legacy accounts into accounts array");
}
const caAcc = migratedAccounts.find((a) => a.mode === "codeassist");
const agAcc = migratedAccounts.find((a) => a.mode === "antigravity");
if (!caAcc || caAcc.tokens.access_token !== "ca_tok") {
  throw new Error("Legacy CodeAssist account not migrated accurately");
}
if (!agAcc || agAcc.tokens.access_token !== "ag_tok") {
  throw new Error("Legacy Antigravity account not migrated accurately");
}
console.log("PASS: legacy account migration succeeds");

// Test 2: saveUser backward compatibility sync
const mockKV = {
  store: new Map(),
  getCalls: [],
  async put(key, val) {
    this.store.set(key, val);
  },
  async get(key, format) {
    this.getCalls.push(key);
    if (Array.isArray(key)) {
      return new Map(key.map((item) => {
        const val = this.store.get(item);
        return [item, val == null ? null : format === "json" ? JSON.parse(val) : val];
      }));
    }
    const val = this.store.get(key);
    if (!val) return null;
    return format === "json" ? JSON.parse(val) : val;
  }
};
const multiUser = {
  password_hash: "hash",
  accounts: [
    {
      id: "acc_1",
      mode: "antigravity",
      enabled: false,
      tokens: { access_token: "disabled_tok" }
    },
    {
      id: "acc_2",
      mode: "antigravity",
      enabled: true,
      status: "active",
      tokens: { access_token: "active_tok" }
    }
  ]
};
await saveUser({ GEMINI_KV: mockKV }, multiUser, "testuser");
if (multiUser.antigravity_tokens?.access_token !== "active_tok") {
  throw new Error("saveUser did not sync active account to legacy antigravity_tokens");
}
console.log("PASS: saveUser maintains legacy token synchronization");

// Test 3: Intelligent quota ranking
const nowSec = Math.floor(Date.now() / 1000);
const accountsToRank = [
  {
    id: "acc_low_quota",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 100,
    tokens: { access_token: "tok1" }
  },
  {
    id: "acc_high_quota",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 50,
    tokens: { access_token: "tok2" }
  },
  {
    id: "acc_zero_quota",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 300,
    tokens: { access_token: "tok3" }
  },
  {
    id: "acc_cooling_down",
    mode: "antigravity",
    enabled: true,
    status: "cooldown",
    cooldown_until: nowSec + 60,
    tokens: { access_token: "tok4" }
  }
];

// Inject cached quotas into mock KV
mockKV.store.set("quota:testuser:acc_low_quota", JSON.stringify({
  models: [{ name: "gemini-2.5-flash", percentage: 20 }]
}));
mockKV.store.set("quota:testuser:acc_high_quota", JSON.stringify({
  models: [{ name: "gemini-2.5-flash", percentage: 95 }]
}));
mockKV.store.set("quota:testuser:acc_zero_quota", JSON.stringify({
  models: [{ name: "gemini-2.5-flash", percentage: 0 }]
}));

const ranked = await rankAccountsForRequest(accountsToRank, "gemini-2.5-flash", "testuser", { GEMINI_KV: mockKV });
if (ranked[0].id !== "acc_high_quota") {
  throw new Error(`Expected acc_high_quota first, got ${ranked[0].id}`);
}
if (ranked[1].id !== "acc_low_quota") {
  throw new Error(`Expected acc_low_quota second, got ${ranked[1].id}`);
}
if (ranked[2].id !== "acc_zero_quota") {
  throw new Error(`Expected acc_zero_quota third, got ${ranked[2].id}`);
}
if (ranked[3].id !== "acc_cooling_down") {
  throw new Error(`Expected acc_cooling_down last, got ${ranked[3].id}`);
}
const rankingReads = mockKV.getCalls.filter((key) => Array.isArray(key));
if (rankingReads.length !== 1 || rankingReads[0].length !== 3) {
  throw new Error(`Expected one bulk quota read for three eligible accounts, got ${JSON.stringify(rankingReads)}`);
}
console.log("PASS: rankAccountsForRequest prioritizes higher quota and penalizes 0% and cooldowns");

// Test 3b: Unknown quota must remain usable and beat a confirmed 0% account.
const unknownVsZero = [
  {
    id: "acc_unknown_quota",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 10,
    tokens: { access_token: "tok-unknown" }
  },
  {
    id: "acc_confirmed_zero",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 1000,
    tokens: { access_token: "tok-zero" }
  }
];
mockKV.store.set("quota:testuser:acc_confirmed_zero", JSON.stringify({
  models: [{ name: "gemini-2.5-flash", percentage: 0 }]
}));
const unknownRanked = await rankAccountsForRequest(unknownVsZero, "gemini-2.5-flash", "testuser", { GEMINI_KV: mockKV });
if (unknownRanked[0].id !== "acc_unknown_quota") {
  throw new Error(`Expected unknown quota account before confirmed 0%, got ${unknownRanked[0].id}`);
}
console.log("PASS: unknown quota remains eligible ahead of confirmed 0%");

// Test 4: Equal quota tie-breaker (least recently used)
const tieAccounts = [
  {
    id: "acc_recently_used",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 10,
    tokens: { access_token: "tok1" }
  },
  {
    id: "acc_idle_longer",
    mode: "antigravity",
    enabled: true,
    status: "active",
    last_used_at: nowSec - 1000,
    tokens: { access_token: "tok2" }
  }
];
mockKV.store.set("quota:testuser:acc_recently_used", JSON.stringify({
  models: [{ name: "gemini-2.5-flash", percentage: 80 }]
}));
mockKV.store.set("quota:testuser:acc_idle_longer", JSON.stringify({
  models: [{ name: "gemini-2.5-flash", percentage: 80 }]
}));
const tieRanked = await rankAccountsForRequest(tieAccounts, "gemini-2.5-flash", "testuser", { GEMINI_KV: mockKV });
if (tieRanked[0].id !== "acc_idle_longer") {
  throw new Error(`Expected acc_idle_longer to win tie-break, got ${tieRanked[0].id}`);
}
console.log("PASS: LRU load-balancing tie-break works as expected");

// Test 4b: isolate-local activity must immediately influence LRU without a
// persistent user write on every successful request.
recordAccountUsage("testuser", tieAccounts[1], nowSec);
const localUsageRanked = await rankAccountsForRequest(tieAccounts, "gemini-2.5-flash", "testuser", { GEMINI_KV: mockKV });
if (localUsageRanked[0].id !== "acc_recently_used") {
  throw new Error(`Expected local recent-use state to rotate the tie, got ${localUsageRanked[0].id}`);
}
console.log("PASS: isolate-local LRU rotates equal-quota accounts without KV persistence");

// Test 5: Deleting all accounts must clear legacy mirrors rather than
// recreating a removed account on the next request.
const deleteUser = {
  accounts: [],
  google_tokens: { access_token: "stale-ca" },
  antigravity_tokens: { access_token: "stale-ag" }
};
await saveUser({ GEMINI_KV: mockKV }, deleteUser, "delete-test");
if (deleteUser.google_tokens !== null || deleteUser.antigravity_tokens !== null) {
  throw new Error("saveUser preserved legacy tokens after all accounts were deleted");
}
console.log("PASS: deleting all accounts clears legacy token mirrors");

console.log("\nALL MULTI-ACCOUNT & QUOTA TESTS PASSED!");
