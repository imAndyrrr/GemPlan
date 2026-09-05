var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var CODEASSIST_OAUTH = {
  redirect_uri: "http://localhost:8085/oauth2callback",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ].join(" ")
};
var ANTIGRAVITY_OAUTH = {
  redirect_uri: "http://localhost:8080/callback",
  scopes: [
    "openid",
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs"
  ].join(" ")
};
function getOauthConfig(mode, env) {
  if (mode === "antigravity") {
    return {
      client_id: String(env?.ANTIGRAVITY_CLIENT_ID || "").trim(),
      client_secret: String(env?.ANTIGRAVITY_CLIENT_SECRET || "").trim(),
      redirect_uri: env?.ANTIGRAVITY_REDIRECT_URI || ANTIGRAVITY_OAUTH.redirect_uri,
      scopes: ANTIGRAVITY_OAUTH.scopes
    };
  } else {
    return {
      client_id: String(env?.CODEASSIST_CLIENT_ID || "").trim(),
      client_secret: String(env?.CODEASSIST_CLIENT_SECRET || "").trim(),
      redirect_uri: env?.CODEASSIST_REDIRECT_URI || CODEASSIST_OAUTH.redirect_uri,
      scopes: CODEASSIST_OAUTH.scopes
    };
  }
}
__name(getOauthConfig, "getOauthConfig");
__name2(getOauthConfig, "getOauthConfig");
function hasOauthCredentials(config) {
  return !!(config?.client_id && config?.client_secret);
}
__name(hasOauthCredentials, "hasOauthCredentials");
__name2(hasOauthCredentials, "hasOauthCredentials");
var GEMINI_ENDPOINT = "https://cloudcode-pa.googleapis.com";
var HEADERS_CA = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI"
};
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
__name2(sha256, "sha256");
function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (dec) => dec.toString(16).padStart(2, "0")).join("").substring(0, length);
}
__name(generateRandomString, "generateRandomString");
__name2(generateRandomString, "generateRandomString");
async function generatePKCE() {
  const verifier = generateRandomString(32);
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}
__name(generatePKCE, "generatePKCE");
__name2(generatePKCE, "generatePKCE");
function getCookie(request, name) {
  const cookieString = request.headers.get("Cookie");
  if (!cookieString) return null;
  const cookies = cookieString.split(";");
  for (let cookie of cookies) {
    const [k, v] = cookie.trim().split("=");
    if (k === name) return v;
  }
  return null;
}
__name(getCookie, "getCookie");
__name2(getCookie, "getCookie");
function matchPattern(modelName, pattern) {
  if (!pattern || !pattern.includes("{modelname}")) {
    return null;
  }
  const parts = pattern.split("{modelname}");
  const prefix = parts[0];
  const suffix = parts[1];
  if (modelName.startsWith(prefix) && modelName.endsWith(suffix)) {
    const extracted = modelName.slice(prefix.length, modelName.length - suffix.length);
    if (extracted.length > 0) {
      return extracted;
    }
  }
  return null;
}
__name(matchPattern, "matchPattern");
__name2(matchPattern, "matchPattern");

function getGeminiRouteInfo(request) {
  try {
    const url = new URL(request.url);
    const marker = "/models/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    const rawTail = url.pathname.slice(markerIndex + marker.length);
    if (!rawTail) return null;
    const colonIndex = rawTail.lastIndexOf(":");
    const rawModel = colonIndex === -1 ? rawTail : rawTail.slice(0, colonIndex);
    const action = colonIndex === -1 ? "" : rawTail.slice(colonIndex + 1);
    return {
      model: decodeURIComponent(rawModel),
      action,
      stream: action === "streamGenerateContent" || url.searchParams.get("alt") === "sse"
    };
  } catch (_) {
    return null;
  }
}
__name(getGeminiRouteInfo, "getGeminiRouteInfo");
__name2(getGeminiRouteInfo, "getGeminiRouteInfo");
function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey.trim();
  const xGoogApiKey = request.headers.get("x-goog-api-key");
  if (xGoogApiKey) return xGoogApiKey.trim();
  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key") || url.searchParams.get("api_key");
    if (keyParam) return keyParam.trim();
  } catch (e) {
  }
  return null;
}
__name(extractApiKey, "extractApiKey");
__name2(extractApiKey, "extractApiKey");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*"
    }
  });
}
__name(jsonResponse, "jsonResponse");
__name2(jsonResponse, "jsonResponse");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
__name2(escapeHtml, "escapeHtml");
function hasNonWhitespace(text) {
  return typeof text === "string" && /\S/u.test(text);
}
__name(hasNonWhitespace, "hasNonWhitespace");
__name2(hasNonWhitespace, "hasNonWhitespace");
function trimForStructuralParse(text) {
  const start = text.search(/\S/u);
  if (start === -1) return "";
  let end = text.length - 1;
  while (end >= start && /\s/u.test(text[end])) end--;
  if (start === 0 && end === text.length - 1) return text;
  return start <= end ? text.slice(start, end + 1) : "";
}
__name(trimForStructuralParse, "trimForStructuralParse");
__name2(trimForStructuralParse, "trimForStructuralParse");
// CPU 优化：Codex CLI 等客户端每次请求携带完全相同的 tools schema（可达数十 KB），
// optimizeAndCleanSchema 是全量递归 + structuredClone 的 CPU 热点。将清洗结果按
// （模式, 工具名, 源 schema JSON）缓存到 isolate 级 Map，跨请求直接复用清洗后的
// 深拷贝（structuredClone 只需一次）。源 schema 来自 request.json() 的临时对象，
// 清洗结果只读地进入上游 payload，缓存不会造成跨请求污染。
// 两个上限防止内存膨胀：schema 源串 >64KB 不缓存；每模式最多缓存 50 条（FIFO 淘汰）。
var SCHEMA_CACHE_MAX_SCHEMA_BYTES = 65536;
var SCHEMA_CACHE_MAX_ENTRIES = 50;
var schemaCleanCache = { openai: /* @__PURE__ */ new Map(), claude: /* @__PURE__ */ new Map(), gemini: /* @__PURE__ */ new Map() };
function getCleanedSchema(apiType, cacheKey, sourceSchema, needsUppercase) {
  const cache = schemaCleanCache[apiType];
  if (!cache) {
    optimizeAndCleanSchema(sourceSchema, needsUppercase);
    return sourceSchema;
  }
  let serialized = null;
  try {
    const candidate = JSON.stringify(sourceSchema);
    // Do not retain very large schemas in the isolate cache. They still get
    // cleaned for this request, but skipping the cache entry avoids pinning a
    // large duplicate across requests and keeps eviction work bounded.
    if (candidate.length <= SCHEMA_CACHE_MAX_SCHEMA_BYTES) {
      serialized = candidate;
    }
  } catch (e) {
    serialized = null;
  }
  // needsUppercase 必须进 key：同一工具名经 openai API 可能以两种模式出现
  //（Gemini 模型需大写类型 / Claude 模型保留 draft 小写类型），互相不可复用。
  const key = (needsUppercase ? "U" : "L") + "\u0000" + cacheKey + "\u0000" + (serialized === null ? "\u0001nojson\u0001" : serialized);
  if (serialized !== null && cache.has(key)) {
    return structuredClone(cache.get(key));
  }
  optimizeAndCleanSchema(sourceSchema, needsUppercase);
  if (serialized !== null) {
    const cleanedClone = structuredClone(sourceSchema);
    if (cache.size >= SCHEMA_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, cleanedClone);
  }
  return sourceSchema;
}
__name(getCleanedSchema, "getCleanedSchema");
__name2(getCleanedSchema, "getCleanedSchema");
var sleep = /* @__PURE__ */ __name2((ms) => new Promise((resolve) => setTimeout(resolve, ms)), "sleep");
// 判断裁剪后的文本是否像 content-block 数组（真实 block 数组一定以
// [{ "type" 开头，允许空白变体）。只检查头部 32 字符，O(1) 开销，
// 用于跳过恰好形如数组的大段纯文本（文件列表、JSON 代码块等）的 JSON.parse。
function looksLikeBlockArray(t) {
  return t.charCodeAt(0) === 0x5b && /^\[\s*\{\s*"type"/.test(t.slice(0, 32));
}
__name(looksLikeBlockArray, "looksLikeBlockArray");
__name2(looksLikeBlockArray, "looksLikeBlockArray");
// 每次 optimizeAndCleanSchema 调用都会遍历此列表做 delete，提前到模块级
// 避免递归每个 schema 节点都重新分配 24 元素数组。
var GOOGLE_FORBIDDEN_KEYS = [
  "multipleOf",
  "dependentRequired",
  "dependentSchemas",
  "patternProperties",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "minContains",
  "maxContains",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "$dynamicRef",
  "$dynamicAnchor",
  "$anchor",
  "$comment"
];
function collectAllDefs(schema) {
  const map = {};
  function walk(s) {
    if (!s || typeof s !== "object") return;
    if (s.$defs) for (const [k, v] of Object.entries(s.$defs)) {
      if (!map[k]) {
        map[k] = v;
        walk(v);
      }
    }
    if (s.definitions) for (const [k, v] of Object.entries(s.definitions)) {
      if (!map[k]) {
        map[k] = v;
        walk(v);
      }
    }
    for (const key of ["properties"]) {
      if (s[key] && typeof s[key] === "object") for (const v of Object.values(s[key])) walk(v);
    }
    for (const key of ["additionalProperties", "not", "if", "then", "else"]) {
      if (s[key] && typeof s[key] === "object") walk(s[key]);
    }
    if (s.items) {
      if (Array.isArray(s.items)) s.items.forEach(walk);
      else walk(s.items);
    }
    if (Array.isArray(s.prefixItems)) s.prefixItems.forEach(walk);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(s[key])) s[key].forEach(walk);
    }
  }
  __name(walk, "walk");
  __name2(walk, "walk");
  walk(schema);
  return map;
}
__name(collectAllDefs, "collectAllDefs");
__name2(collectAllDefs, "collectAllDefs");
function optimizeAndCleanSchema(schema, needsUppercase, defs = null, depth = 0, seenRefs = null) {
  if (!schema || typeof schema !== "object" || depth > 20) return;
  if (defs === null) {
    defs = collectAllDefs(schema);
  }
  if (seenRefs === null) {
    seenRefs = /* @__PURE__ */ new Set();
  }
  if (schema.$ref && typeof schema.$ref === "string") {
    let refName = null;
    if (schema.$ref.startsWith("#/$defs/")) refName = schema.$ref.slice(8);
    else if (schema.$ref.startsWith("#/definitions/")) refName = schema.$ref.slice(14);
    if (refName && defs[refName]) {
      if (seenRefs.has(refName)) {
        delete schema.$ref;
        schema.type = "object";
        schema.description = schema.description || `Bypassed circular reference to ${refName}`;
        return;
      }
      const resolved = structuredClone(defs[refName]);
      const extra = {};
      for (const k of Object.keys(schema)) {
        if (k !== "$ref") extra[k] = schema[k];
      }
      for (const k of Object.keys(schema)) {
        delete schema[k];
      }
      Object.assign(schema, resolved, extra);
      seenRefs.add(refName);
      optimizeAndCleanSchema(schema, needsUppercase, defs, depth + 1, seenRefs);
      seenRefs.delete(refName);
      return;
    }
  }
  if (Array.isArray(schema.anyOf)) {
    let allEnums = [];
    let isAllString = true;
    for (const item of schema.anyOf) {
      if (item && typeof item === "object") {
        if (item.type === "string" || !item.type) {
          if (Array.isArray(item.enum)) {
            allEnums.push(...item.enum);
          } else if (item.const !== void 0) {
            allEnums.push(item.const);
          } else {
            isAllString = false;
          }
        } else {
          isAllString = false;
        }
      } else {
        isAllString = false;
      }
    }
    if (isAllString && allEnums.length > 0) {
      const uniqueEnums = Array.from(new Set(allEnums));
      schema.type = "string";
      schema.enum = uniqueEnums;
      delete schema.anyOf;
    } else {
      const firstValid = schema.anyOf.find((x) => x && typeof x === "object");
      if (firstValid) {
        // 选中分支若是 $ref，先解析为实际定义，避免残留悬空 $ref。
        // （agent API 不接受 $ref；Claude 侧 $defs 已被删除，引用会失效。）
        if (firstValid.$ref && typeof firstValid.$ref === "string" && defs) {
          let refName = null;
          if (firstValid.$ref.startsWith("#/$defs/")) refName = firstValid.$ref.slice(8);
          else if (firstValid.$ref.startsWith("#/definitions/")) refName = firstValid.$ref.slice(14);
          if (refName && defs[refName]) {
            if (seenRefs.has(refName)) {
              delete firstValid.$ref;
              firstValid.type = "object";
              firstValid.description = firstValid.description || `Bypassed circular reference to ${refName}`;
            } else {
              const resolvedRef = structuredClone(defs[refName]);
              const extraRef = {};
              for (const k of Object.keys(firstValid)) {
                if (k !== "$ref") extraRef[k] = firstValid[k];
              }
              for (const k of Object.keys(firstValid)) delete firstValid[k];
              Object.assign(firstValid, resolvedRef, extraRef);
              seenRefs.add(refName);
              optimizeAndCleanSchema(firstValid, needsUppercase, defs, depth + 1, seenRefs);
              seenRefs.delete(refName);
            }
          }
        }
        const resolved = structuredClone(firstValid);
        const extra = {};
        for (const k of Object.keys(schema)) {
          if (k !== "anyOf") extra[k] = schema[k];
        }
        for (const k of Object.keys(schema)) {
          delete schema[k];
        }
        Object.assign(schema, resolved, extra);
      }
    }
  }
  if ("const" in schema) {
    schema.enum = [schema.const];
    delete schema.const;
  }
  if ("additionalProperties" in schema) {
    const ap = schema.additionalProperties;
    if (ap === true || ap && typeof ap === "object" && Object.keys(ap).length === 0) {
      delete schema.additionalProperties;
    }
  }
  for (const key of GOOGLE_FORBIDDEN_KEYS) {
    delete schema[key];
  }
  if (needsUppercase && typeof schema.type === "string") {
    schema.type = schema.type.toUpperCase();
  }
  for (const key of ["properties", "$defs", "definitions"]) {
    const obj = schema[key];
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) {
        if (v && typeof v === "object") optimizeAndCleanSchema(v, needsUppercase, defs, depth + 1, seenRefs);
      }
    }
  }
  for (const key of ["additionalProperties", "not", "if", "then", "else"]) {
    const sub = schema[key];
    if (sub && typeof sub === "object") optimizeAndCleanSchema(sub, needsUppercase, defs, depth + 1, seenRefs);
  }
  if (schema.items) {
    if (Array.isArray(schema.items)) {
      for (const item of schema.items) {
        if (item && typeof item === "object") optimizeAndCleanSchema(item, needsUppercase, defs, depth + 1, seenRefs);
      }
    } else if (typeof schema.items === "object") {
      optimizeAndCleanSchema(schema.items, needsUppercase, defs, depth + 1, seenRefs);
    }
  }
  if (Array.isArray(schema.prefixItems)) {
    for (const item of schema.prefixItems) {
      if (item && typeof item === "object") optimizeAndCleanSchema(item, needsUppercase, defs, depth + 1, seenRefs);
    }
  }
  for (const key of ["oneOf", "allOf"]) {
    const arr = schema[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === "object") optimizeAndCleanSchema(item, needsUppercase, defs, depth + 1, seenRefs);
      }
    }
  }
}
__name(optimizeAndCleanSchema, "optimizeAndCleanSchema");
__name2(optimizeAndCleanSchema, "optimizeAndCleanSchema");
function uppercaseSchemaTypes(schema) {
  if (!schema || typeof schema !== "object") return;
  if (typeof schema.type === "string") {
    schema.type = schema.type.toUpperCase();
  }
  for (const key of ["properties", "$defs", "definitions"]) {
    const obj = schema[key];
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) {
        if (v && typeof v === "object") uppercaseSchemaTypes(v);
      }
    }
  }
  for (const key of ["additionalProperties", "not", "if", "then", "else"]) {
    const sub = schema[key];
    if (sub && typeof sub === "object") uppercaseSchemaTypes(sub);
  }
  if (schema.items) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((item) => {
        if (item && typeof item === "object") uppercaseSchemaTypes(item);
      });
    } else if (typeof schema.items === "object") {
      uppercaseSchemaTypes(schema.items);
    }
  }
  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((item) => {
      if (item && typeof item === "object") uppercaseSchemaTypes(item);
    });
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const arr = schema[key];
    if (Array.isArray(arr)) arr.forEach((item) => {
      if (item && typeof item === "object") uppercaseSchemaTypes(item);
    });
  }
}
__name(uppercaseSchemaTypes, "uppercaseSchemaTypes");
__name2(uppercaseSchemaTypes, "uppercaseSchemaTypes");
function mergeOpenAIMessages(messages) {
  if (!messages || messages.length <= 1) return messages || [];
  const merged = [];
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "assistant" : msg.role === "system" || msg.role === "developer" ? "system" : "user";
    if (msg.role === "tool") {
      // 工具结果消息保持独立，不参与合并：
      // 合并会丢失各自的 tool_call_id，导致 Claude 的 tool_use→tool_result 无法一一配对。
      merged.push({ ...msg, role: "tool" });
      continue;
    }
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      const prev = merged[merged.length - 1];
      if (msg.content) {
        if (typeof prev.content === "string" && typeof msg.content === "string") {
          // CPU 优化：相邻同角色字符串消息合并时不再每条做 (acc+"\n"+part).trim()
          // 对整个累积字符串的重扫描（O(N²) 总开销）。将原逻辑逐步 trim 精确
          // 等价地转换为片段收集：非空白片段仅做尾部 rtrim（原 trim 只剥最新
          // 尾部空白）；纯空白片段使整个累积串被 rtrim（原 trim 会将其连同
          // 分隔符和前段尾部空白一并剥掉）。首片段首部空白延迟到最终 trim。
          if (!prev.__mergeParts) prev.__mergeParts = [prev.content];
          if (msg.content.trim() === "") {
            const segs = prev.__mergeParts;
            if (segs.length > 0) {
              const rt = segs[segs.length - 1].replace(/\s+$/, "");
              if (rt === "") segs.pop();
              else segs[segs.length - 1] = rt;
            }
          } else {
            prev.__mergeParts.push(msg.content.replace(/\s+$/, ""));
          }
          prev.__isMerging = true;
        } else {
          if (prev.__isMerging) {
            // 此前在做字符串延迟合并，现遇到数组内容：先把字符串结果落地，
            // 再走原有的块合并路径，保证顺序和内容完整。
            prev.content = prev.__mergeParts.join("\n").trim();
            delete prev.__mergeParts;
            delete prev.__isMerging;
          }
          let prevBlocks = Array.isArray(prev.content) ? prev.content : prev.content ? [{ type: "text", text: prev.content }] : [];
          let currBlocks = Array.isArray(msg.content) ? msg.content : msg.content ? [{ type: "text", text: msg.content }] : [];
          // 原地追加，避免每条消息 concat 一次产生 O(N²) 的数组拷贝。
          if (prev.content === prevBlocks || !Array.isArray(prev.content)) {
            prev.content = prevBlocks;
          }
          for (const blk of currBlocks) prev.content.push(blk);
        }
      }
      if (msg.tool_calls) {
        if (prev.tool_calls) {
          for (const tc of msg.tool_calls) prev.tool_calls.push(tc);
        } else {
          prev.tool_calls = msg.tool_calls.slice();
        }
      }
      if (msg.reasoning_content) {
        prev.reasoning_content = ((prev.reasoning_content || "") + "\n" + msg.reasoning_content).trim();
      }
    } else {
      merged.push({ ...msg, role });
    }
  }
  // 合并完成后对延迟拼接的字符串统一 join + trim，一次性完成。
  for (const m of merged) {
    if (m.__isMerging) {
      m.content = m.__mergeParts.join("\n").trim();
      delete m.__mergeParts;
      delete m.__isMerging;
    }
  }
  return merged;
}
__name(mergeOpenAIMessages, "mergeOpenAIMessages");
__name2(mergeOpenAIMessages, "mergeOpenAIMessages");

// Tool-call IDs are opaque correlation keys, but some clients may reuse one
// after editing/forking a long conversation. Antigravity treats the entire
// request as one tool history, so a reused ID can bind an earlier response to
// a later call (especially when the two calls use different tool names).
//
// Repair only that protocol-level ambiguity: retain every content/part in its
// original order, keep the first occurrence unchanged, give later occurrences
// a deterministic unique ID, and apply the same ID/name to the matching
// functionResponse. No message, functionCall, functionResponse, arguments, or
// output is removed or synthesized.
function normalizeToolHistoryIdentities(contents) {
  if (!Array.isArray(contents) || contents.length === 0) return;
  const callCounts = new Map();
  const pendingByOriginalId = new Map();
  for (const content of contents) {
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const functionCall = part?.functionCall;
      if (functionCall?.id) {
        const originalId = functionCall.id;
        const occurrence = (callCounts.get(originalId) || 0) + 1;
        callCounts.set(originalId, occurrence);
        const normalizedId = occurrence === 1 ? originalId : `${originalId}__dup${occurrence}`;
        if (normalizedId !== originalId) functionCall.id = normalizedId;
        let pending = pendingByOriginalId.get(originalId);
        if (!pending) {
          pending = { calls: [], next: 0 };
          pendingByOriginalId.set(originalId, pending);
        }
        pending.calls.push({ id: normalizedId, name: functionCall.name });
      }
      const functionResponse = part?.functionResponse;
      if (functionResponse?.id) {
        const originalId = functionResponse.id;
        const pending = pendingByOriginalId.get(originalId);
        if (pending && pending.next < pending.calls.length) {
          const matchingCall = pending.calls[pending.next++];
          functionResponse.id = matchingCall.id;
          if (matchingCall.name) functionResponse.name = matchingCall.name;
          if (pending.next === pending.calls.length) pendingByOriginalId.delete(originalId);
        }
      }
    }
  }
}
__name(normalizeToolHistoryIdentities, "normalizeToolHistoryIdentities");
__name2(normalizeToolHistoryIdentities, "normalizeToolHistoryIdentities");

// Combine the Antigravity function-call scan, thought-signature injection, and
// duplicate-ID normalization into one pass. Long OpenAI histories used to be
// walked once to detect calls, once to clone/inject signatures, and once again
// to normalize IDs. This helper keeps the exact same output while avoiding two
// full extra walks over the history on tool turns.
function prepareAntigravityContents(contents, cachedSignature, includeThinking) {
  if (!Array.isArray(contents) || contents.length === 0) return contents || [];
  const callCounts = new Map();
  const pendingByOriginalId = new Map();
  const prepared = new Array(contents.length);
  for (let contentIndex = 0; contentIndex < contents.length; contentIndex++) {
    const content = contents[contentIndex];
    const sourceParts = Array.isArray(content?.parts) ? content.parts : null;
    if (!sourceParts) {
      prepared[contentIndex] = content;
      continue;
    }
    let partsChanged = false;
    const parts = new Array(sourceParts.length);
    for (let partIndex = 0; partIndex < sourceParts.length; partIndex++) {
      const part = sourceParts[partIndex];
      const functionCall = part?.functionCall;
      const functionResponse = part?.functionResponse;
      let nextPart = part;
      if (functionCall) {
        const originalId = functionCall.id;
        let normalizedId = originalId;
        if (originalId) {
          const occurrence = (callCounts.get(originalId) || 0) + 1;
          callCounts.set(originalId, occurrence);
          normalizedId = occurrence === 1 ? originalId : `${originalId}__dup${occurrence}`;
          let pending = pendingByOriginalId.get(originalId);
          if (!pending) {
            pending = { calls: [], next: 0 };
            pendingByOriginalId.set(originalId, pending);
          }
          pending.calls.push({ id: normalizedId, name: functionCall.name });
        }
        // Clone only tool-call parts. Large text/image parts stay shared with
        // the parsed request object, so this optimization does not duplicate
        // the long history payload in memory.
        const nextFunctionCall = { ...functionCall };
        if (originalId && normalizedId !== originalId) nextFunctionCall.id = normalizedId;
        nextPart = { ...part, functionCall: nextFunctionCall };
        // A tool round can arrive from a client that was created before the
        // OpenAI-compatible ID transport carried Gemini's real signature.
        // Keep real/cached signatures when available, and use the upstream
        // validator bypass marker for legacy calls with no signature. This
        // changes only protocol metadata; all calls, arguments, and outputs
        // remain intact.
        const signature = part.thoughtSignature || part.thought_signature || cachedSignature || "skip_thought_signature_validator";
        nextPart.thoughtSignature = signature;
        nextPart.thought_signature = signature;
        partsChanged = true;
      }
      if (functionResponse?.id) {
        const originalId = functionResponse.id;
        const pending = pendingByOriginalId.get(originalId);
        if (pending && pending.next < pending.calls.length) {
          const matchingCall = pending.calls[pending.next++];
          const nextFunctionResponse = {
            ...functionResponse,
            id: matchingCall.id
          };
          if (matchingCall.name) nextFunctionResponse.name = matchingCall.name;
          nextPart = { ...nextPart, functionResponse: nextFunctionResponse };
          partsChanged = true;
          if (pending.next === pending.calls.length) pendingByOriginalId.delete(originalId);
        }
      }
      parts[partIndex] = nextPart;
    }
    prepared[contentIndex] = partsChanged ? { ...content, parts } : content;
  }
  return prepared;
}
__name(prepareAntigravityContents, "prepareAntigravityContents");
__name2(prepareAntigravityContents, "prepareAntigravityContents");

// OpenAI-compatible tool_call IDs are the only metadata that reliably
// survives a tool round trip through CCR. Preserve a real Gemini thought
// signature there when one is present, then restore it when converting the
// next request back to Gemini. The separator is outside the base64 alphabet
// used by Gemini signatures.
function encodeToolCallIdentity(id, thoughtSignature) {
  if (typeof id !== "string" || !id || typeof thoughtSignature !== "string" || thoughtSignature.length < 50) {
    return id;
  }
  return `${id}|${thoughtSignature}`;
}
__name(encodeToolCallIdentity, "encodeToolCallIdentity");
__name2(encodeToolCallIdentity, "encodeToolCallIdentity");
function decodeToolCallIdentity(id) {
  if (typeof id !== "string") return { id, thoughtSignature: null };
  const separator = id.indexOf("|");
  if (separator <= 0 || id.length - separator - 1 < 50) {
    return { id, thoughtSignature: null };
  }
  return {
    id: id.slice(0, separator),
    thoughtSignature: id.slice(separator + 1)
  };
}
__name(decodeToolCallIdentity, "decodeToolCallIdentity");
__name2(decodeToolCallIdentity, "decodeToolCallIdentity");
function mergeClaudeMessages(messages) {
  if (!messages || messages.length <= 1) return messages || [];
  const merged = [];
  for (const msg of messages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      const prev = merged[merged.length - 1];
      let prevBlocks = Array.isArray(prev.content) ? prev.content : [{ type: "text", text: prev.content || "" }];
      let currBlocks = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content || "" }];
      // 原地追加，避免每条消息 concat 一次产生 O(N²) 的数组拷贝。
      prev.content = prevBlocks;
      for (const blk of currBlocks) prevBlocks.push(blk);
    } else {
      merged.push({
        role: msg.role,
        content: Array.isArray(msg.content) ? [...msg.content] : msg.content
      });
    }
  }
  return merged;
}
__name(mergeClaudeMessages, "mergeClaudeMessages");
__name2(mergeClaudeMessages, "mergeClaudeMessages");
function sortClaudeBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  const thinking = [];
  const text = [];
  const toolUse = [];
  const other = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      thinking.push(block);
    } else if (block.type === "text") {
      if (block.text && block.text.trim() !== "") {
        text.push(block);
      }
    } else if (block.type === "tool_use") {
      toolUse.push(block);
    } else {
      other.push(block);
    }
  }
  return [...thinking, ...text, ...other, ...toolUse];
}
__name(sortClaudeBlocks, "sortClaudeBlocks");
__name2(sortClaudeBlocks, "sortClaudeBlocks");
function deriveSessionId(accountId) {
  let hash = -3750763034362895579n;
  const bytes = new TextEncoder().encode(accountId);
  for (const byte of bytes) {
    hash = BigInt.asIntN(64, hash * 1099511628211n);
    hash = BigInt.asIntN(64, hash ^ BigInt(byte));
  }
  return hash.toString();
}
__name(deriveSessionId, "deriveSessionId");
__name2(deriveSessionId, "deriveSessionId");
// Antigravity 的 sessionId 必须按“客户端会话 + 模型”隔离。
// 旧逻辑在 CCR 没有转发 user/prompt_cache_key 时退回 username，导致同一个
// Google 账号下所有 Codex/Claude 对话共享一个上游会话和 thought signature。
// 这会把不同对话或不同模型的状态混在一起，尤其容易在连续工具调用时触发
// RESOURCE_EXHAUSTED。优先使用客户端显式会话键；CCR 丢弃这些字段时，再用
// 前几个稳定的用户消息建立确定性回退键。只读取消息前缀，不改变或裁剪发送内容。
function getRequestSessionKey(body, request) {
  const headerCandidates = [
    request?.headers?.get("thread-id"),
    request?.headers?.get("session-id"),
    request?.headers?.get("x-codex-window-id"),
    request?.headers?.get("x-client-session-id")
  ];
  const directCandidates = [
    ...headerCandidates,
    body?.client_metadata?.thread_id,
    body?.client_metadata?.session_id,
    body.user,
    body.session_id,
    body.sessionId,
    body.prompt_cache_key,
    body.promptCacheKey,
    body.client_metadata?.session_id,
    body.client_metadata?.sessionId
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let firstUserText = "";
  let firstAssistantText = "";
  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    let text = "";
    if (typeof message.content === "string") {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if ((block?.type === "text" || block?.type === "input_text" || block?.type === "output_text") && typeof block.text === "string") {
          text += (text ? "\n" : "") + block.text;
        }
      }
    }
    if (!text.trim()) continue;
    if (message.role === "user" && !firstUserText) firstUserText = text;
    else if (message.role === "assistant" && !firstAssistantText) firstAssistantText = text;
    if (firstUserText) break;
  }
  if (firstUserText) return `user:${firstUserText.slice(0, 8192)}`;
  return firstAssistantText ? `assistant:${firstAssistantText.slice(0, 8192)}` : "default";
}
__name(getRequestSessionKey, "getRequestSessionKey");
__name2(getRequestSessionKey, "getRequestSessionKey");
async function getSessionSignature(env, sessionId) {
  if (!sessionId) return null;
  const data = await getTransientJsonCacheWithKvFallback(
    env,
    "signature",
    sessionId,
    `sig:session:${sessionId}`,
    7200
  );
  return data?.signature || null;
}
__name(getSessionSignature, "getSessionSignature");
__name2(getSessionSignature, "getSessionSignature");
async function getSessionSignatureRecord(env, sessionId) {
  if (!sessionId) return null;
  return await getTransientJsonCacheWithKvFallback(
    env,
    "signature",
    sessionId,
    `sig:session:${sessionId}`,
    7200
  );
}
__name(getSessionSignatureRecord, "getSessionSignatureRecord");
__name2(getSessionSignatureRecord, "getSessionSignatureRecord");
async function cacheSessionSignature(env, sessionId, signature, messageCount, ctx) {
  if (!sessionId || !signature || signature.length < 50) return;
  const existing = await getSessionSignatureRecord(env, sessionId);
  let shouldStore = false;
  if (!existing) {
    shouldStore = true;
  } else {
    const existingCount = existing.message_count || 0;
    const existingSig = existing.signature || "";
    if (messageCount < existingCount) {
      shouldStore = true;
    } else if (messageCount === existingCount) {
      shouldStore = signature.length > existingSig.length;
    } else {
      shouldStore = true;
    }
  }
  if (shouldStore) {
    putTransientJsonCache("signature", sessionId, {
      signature,
      message_count: messageCount
    }, 7200, ctx);
  }
}
__name(cacheSessionSignature, "cacheSessionSignature");
__name2(cacheSessionSignature, "cacheSessionSignature");

// Signatures and quota snapshots are recoverable, short-lived caches rather
// than durable application state. Persisting every refresh in KV consumes the
// free plan's daily write allowance and can make unrelated API requests fail.
// Keep a bounded isolate cache for the hot path and use the Workers Cache API
// as a best-effort second tier. Existing KV entries are still read as a
// backwards-compatible fallback, but these transient values are no longer
// written to KV.
const TRANSIENT_CACHE_MAX_ENTRIES = 2048;
const transientJsonCache = /* @__PURE__ */ new Map();
function transientCacheKey(namespace, key) {
  return `${namespace}\u0000${key}`;
}
__name(transientCacheKey, "transientCacheKey");
__name2(transientCacheKey, "transientCacheKey");
function transientCacheRequest(namespace, key) {
  const digest = deriveSessionId(`${namespace}\u0000${key}`);
  return new Request(`https://gemplan-cache.invalid/${encodeURIComponent(namespace)}/${digest}`, {
    method: "GET"
  });
}
__name(transientCacheRequest, "transientCacheRequest");
function cloneTransientValue(value) {
  if (value === null || value === void 0 || typeof value !== "object") return value;
  return structuredClone(value);
}
__name(cloneTransientValue, "cloneTransientValue");
async function getTransientJsonCache(namespace, key, ttlSeconds = 7200) {
  const memoryKey = transientCacheKey(namespace, key);
  const memoryEntry = transientJsonCache.get(memoryKey);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > Date.now()) {
      return cloneTransientValue(memoryEntry.value);
    }
    transientJsonCache.delete(memoryKey);
  }
  if (typeof caches !== "undefined" && caches.default) {
    try {
      const response = await caches.default.match(transientCacheRequest(namespace, key));
      if (response) {
        const value = await response.json();
        rememberTransientJsonCache(namespace, key, value, ttlSeconds);
        return cloneTransientValue(value);
      }
    } catch (e) {
      // Cache API is best effort. The caller can fall back to KV or upstream.
    }
  }
  return null;
}
__name(getTransientJsonCache, "getTransientJsonCache");
__name2(getTransientJsonCache, "getTransientJsonCache");
function rememberTransientJsonCache(namespace, key, value, ttlSeconds) {
  const memoryKey = transientCacheKey(namespace, key);
  if (transientJsonCache.has(memoryKey)) transientJsonCache.delete(memoryKey);
  transientJsonCache.set(memoryKey, {
    value: cloneTransientValue(value),
    expiresAt: Date.now() + Math.max(1, ttlSeconds || 1) * 1e3
  });
  while (transientJsonCache.size > TRANSIENT_CACHE_MAX_ENTRIES) {
    transientJsonCache.delete(transientJsonCache.keys().next().value);
  }
}
__name(rememberTransientJsonCache, "rememberTransientJsonCache");
__name2(rememberTransientJsonCache, "rememberTransientJsonCache");
function putTransientJsonCache(namespace, key, value, ttlSeconds, ctx) {
  rememberTransientJsonCache(namespace, key, value, ttlSeconds);
  if (typeof caches === "undefined" || !caches.default) return;
  const response = new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${Math.max(1, ttlSeconds || 1)}`
    }
  });
  const promise = caches.default.put(transientCacheRequest(namespace, key), response).catch(() => {});
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
  }
}
__name(putTransientJsonCache, "putTransientJsonCache");
__name2(putTransientJsonCache, "putTransientJsonCache");
async function getTransientJsonCacheWithKvFallback(env, namespace, key, legacyKey, ttlSeconds) {
  const cached = await getTransientJsonCache(namespace, key, ttlSeconds);
  if (cached !== null && cached !== void 0) return cached;
  if (!env?.GEMINI_KV?.get) return null;
  const legacyValue = await env.GEMINI_KV.get(legacyKey, "json");
  if (legacyValue !== null && legacyValue !== void 0) {
    putTransientJsonCache(namespace, key, legacyValue, ttlSeconds);
  }
  return legacyValue;
}
__name(getTransientJsonCacheWithKvFallback, "getTransientJsonCacheWithKvFallback");
__name2(getTransientJsonCacheWithKvFallback, "getTransientJsonCacheWithKvFallback");

function extractThinkingParams(body) {
  // 缓存于 body 对象上（body 是本请求独占的临时对象），
  // getUpstreamThinkingConfig / shouldEnableThinking 每请求会被调用 3-5 次，
  // 每次都 Object.keys(body) 全量遍历 + toLowerCase 比较是纯浪费。
  if (body && typeof body === "object" && body.__thinkingParams !== void 0) {
    return body.__thinkingParams;
  }
  let thinkingBudget = void 0;
  let thinkingLevel = void 0;
  let reasoningEffort = void 0;
  let thinkingObj = void 0;
  let rawThinkingConfig = void 0;
  let outputConfig = void 0;
  if (body && typeof body === "object") {
    for (const k of Object.keys(body)) {
      const kl = k.toLowerCase();
      if (kl === "thinkingbudget" || kl === "thinking_budget") {
        thinkingBudget = body[k];
      } else if (kl === "thinkinglevel" || kl === "thinking_level") {
        thinkingLevel = body[k];
      } else if (kl === "reasoning_effort" || kl === "reasoningeffort" || kl === "reasoningbudget" || kl === "reasoning_budget") {
        reasoningEffort = body[k];
      } else if (kl === "thinking") {
        thinkingObj = body[k];
      } else if (kl === "thinkingconfig" || kl === "thinking_config") {
        rawThinkingConfig = body[k];
      } else if (kl === "output_config" || kl === "outputconfig") {
        outputConfig = body[k];
      } else if (kl === "generationconfig" || kl === "generation_config") {
        const genConfig = body[k];
        if (genConfig && typeof genConfig === "object") {
          for (const gk of Object.keys(genConfig)) {
            const gkl = gk.toLowerCase();
            if (gkl === "thinkingconfig" || gkl === "thinking_config") {
              rawThinkingConfig = genConfig[gk];
            } else if (gkl === "thinkingbudget" || gkl === "thinking_budget") {
              thinkingBudget = genConfig[gk];
            } else if (gkl === "thinkinglevel" || gkl === "thinking_level") {
              thinkingLevel = genConfig[gk];
            }
          }
        }
      }
    }
  }
  if (rawThinkingConfig && typeof rawThinkingConfig === "object") {
    for (const rk of Object.keys(rawThinkingConfig)) {
      const rkl = rk.toLowerCase();
      if (rkl === "thinkingbudget" || rkl === "thinking_budget") {
        if (thinkingBudget === void 0) thinkingBudget = rawThinkingConfig[rk];
      } else if (rkl === "thinkinglevel" || rkl === "thinking_level") {
        if (thinkingLevel === void 0) thinkingLevel = rawThinkingConfig[rk];
      }
    }
  }
  const params = { thinkingBudget, thinkingLevel, reasoningEffort, thinkingObj, rawThinkingConfig, outputConfig };
  if (body && typeof body === "object") {
    // 不可枚举属性：JSON.stringify 不输出，避免 gemini 原生路径 innerRequest=body
    // 时缓存键泄漏进上游 payload。普通属性读取（body.__thinkingParams）不受影响。
    Object.defineProperty(body, "__thinkingParams", { value: params, enumerable: false, writable: true, configurable: true });
  }
  return params;
}
__name(extractThinkingParams, "extractThinkingParams");
__name2(extractThinkingParams, "extractThinkingParams");
function getUpstreamThinkingConfig(body, resolvedModel, apiType) {
  const pmLower = resolvedModel ? resolvedModel.toLowerCase() : "";
  const isGemini25 = pmLower.includes("2.5");
  const { thinkingBudget, thinkingLevel, reasoningEffort, thinkingObj, rawThinkingConfig, outputConfig } = extractThinkingParams(body);
  const clientExplicitlyDisabled = thinkingObj?.type === "disabled" || thinkingObj?.budget_tokens === 0 || outputConfig?.effort === "none" || reasoningEffort === "none" || thinkingBudget === 0 || thinkingLevel !== void 0 && (thinkingLevel === "MINIMAL" || thinkingLevel === "minimal") || rawThinkingConfig?.thinkingBudget === 0 || rawThinkingConfig?.thinkingLevel !== void 0 && (rawThinkingConfig.thinkingLevel === "MINIMAL" || rawThinkingConfig.thinkingLevel === "minimal");
  if (clientExplicitlyDisabled) {
    if (apiType === "openai") {
      if (isGemini25) {
        return { thinkingBudget: 0 };
      } else {
        return { thinkingLevel: "MINIMAL" };
      }
    } else {
      if (isGemini25) {
        return { thinkingBudget: 0 };
      } else {
        return { thinkingLevel: "MINIMAL" };
      }
    }
  }
  const clientWantsThinking = thinkingObj?.type === "enabled" || thinkingObj?.type === "adaptive" || thinkingObj?.budget_tokens !== void 0 && thinkingObj.budget_tokens > 0 || (thinkingObj?.effort_level !== void 0 || thinkingObj?.effortLevel !== void 0 || thinkingObj?.effort !== void 0) || outputConfig?.effort !== void 0 && outputConfig.effort !== "none" || reasoningEffort !== void 0 && reasoningEffort !== "none" || thinkingBudget !== void 0 || thinkingLevel !== void 0 || rawThinkingConfig?.thinkingBudget !== void 0 || rawThinkingConfig?.thinkingLevel !== void 0;
  if (!clientWantsThinking) {
    return void 0;
  }
  const config = {
    includeThoughts: true
  };
  if (rawThinkingConfig && typeof rawThinkingConfig === "object") {
    for (const key of Object.keys(rawThinkingConfig)) {
      const kl = key.toLowerCase();
      if (kl === "thinkingbudget" || kl === "thinking_budget") {
        config.thinkingBudget = rawThinkingConfig[key];
      } else if (kl === "thinkinglevel" || kl === "thinking_level") {
        config.thinkingLevel = rawThinkingConfig[key];
      } else {
        config[key] = rawThinkingConfig[key];
      }
    }
  }
  if (thinkingBudget !== void 0) {
    config.thinkingBudget = thinkingBudget;
  }
  if (thinkingLevel !== void 0) {
    config.thinkingLevel = thinkingLevel;
  }
  if (thinkingObj && typeof thinkingObj === "object" && thinkingObj.budget_tokens !== void 0) {
    config.thinkingBudget = thinkingObj.budget_tokens;
  }
  if (thinkingObj && typeof thinkingObj === "object") {
    const claudeEffort = thinkingObj.effort_level || thinkingObj.effortLevel || thinkingObj.effort;
    if (claudeEffort !== void 0) {
      const eff = String(claudeEffort).toLowerCase();
      if (isGemini25) {
        if (eff === "low" || eff === "minimal") config.thinkingBudget = 2048;
        else if (eff === "medium") config.thinkingBudget = 4096;
        else if (eff === "high" || eff === "xhigh" || eff === "max") config.thinkingBudget = -1;
      } else {
        if (eff === "low" || eff === "minimal") config.thinkingLevel = "LOW";
        else if (eff === "medium") config.thinkingLevel = "MEDIUM";
        else if (eff === "high" || eff === "xhigh" || eff === "max") config.thinkingLevel = "HIGH";
        else if (eff === "none") config.thinkingLevel = "MINIMAL";
      }
    }
  }
  if (outputConfig && typeof outputConfig === "object") {
    const claudeEffort = outputConfig.effort;
    if (claudeEffort !== void 0) {
      const eff = String(claudeEffort).toLowerCase();
      if (isGemini25) {
        if (eff === "low" || eff === "minimal") config.thinkingBudget = 2048;
        else if (eff === "medium") config.thinkingBudget = 4096;
        else if (eff === "high" || eff === "xhigh" || eff === "max") config.thinkingBudget = -1;
      } else {
        if (eff === "low" || eff === "minimal") config.thinkingLevel = "LOW";
        else if (eff === "medium") config.thinkingLevel = "MEDIUM";
        else if (eff === "high" || eff === "xhigh" || eff === "max") config.thinkingLevel = "HIGH";
        else if (eff === "none") config.thinkingLevel = "MINIMAL";
      }
    }
  }
  if (reasoningEffort !== void 0) {
    const eff = reasoningEffort.toLowerCase();
    if (apiType === "openai") {
      if (isGemini25) {
        if (eff === "low" || eff === "minimal") config.thinkingBudget = 2048;
        else if (eff === "medium") config.thinkingBudget = 4096;
        else config.thinkingBudget = -1;
      } else {
        if (eff === "low") config.thinkingLevel = "LOW";
        else if (eff === "medium") config.thinkingLevel = "MEDIUM";
        else if (eff === "high") config.thinkingLevel = "HIGH";
        else if (eff === "minimal") config.thinkingLevel = "MINIMAL";
        else config.thinkingLevel = reasoningEffort.toUpperCase();
      }
    } else {
      if (isGemini25) {
        if (eff === "low" || eff === "minimal") config.thinkingBudget = 2048;
        else if (eff === "medium") config.thinkingBudget = 4096;
        else config.thinkingBudget = -1;
      } else {
        if (eff === "low") config.thinkingLevel = "LOW";
        else if (eff === "medium") config.thinkingLevel = "MEDIUM";
        else if (eff === "high") config.thinkingLevel = "HIGH";
        else if (eff === "minimal") config.thinkingLevel = "MINIMAL";
        else config.thinkingLevel = reasoningEffort.toUpperCase();
      }
    }
  }
  return config;
}
__name(getUpstreamThinkingConfig, "getUpstreamThinkingConfig");
__name2(getUpstreamThinkingConfig, "getUpstreamThinkingConfig");
function shouldEnableThinking(body, resolvedModel, apiType) {
  const config = getUpstreamThinkingConfig(body, resolvedModel, apiType);
  if (!config) return false;
  return config.thinkingBudget !== 0 && config.thinkingLevel !== "MINIMAL";
}
__name(shouldEnableThinking, "shouldEnableThinking");
__name2(shouldEnableThinking, "shouldEnableThinking");
function mapTools(body, apiType, needsUppercase = true, preserveDraft2020 = false) {
  if (!body.tools || !Array.isArray(body.tools)) {
    return void 0;
  }
  let functionDeclarations = [];
  if (apiType === "openai") {
    for (const t of body.tools) {
      if (t.type === "function" && t.function) {
        // CPU 优化：相同 tools schema 的清洗结果在 isolate 级缓存复用，
        // 跳过每次请求对大 schema 的全量递归清洗。缓存命中时 structuredClone
        // 出独立副本，与原来的原地清洗语义一致。
        const cleanedParams = getCleanedSchema(apiType, t.function.name || "", t.function.parameters || {}, preserveDraft2020 ? false : needsUppercase);
        const fd = {
          name: t.function.name === "local_shell_call" ? "shell" : t.function.name,
          description: t.function.description || "",
          // body 由 request.json() 反序列化而来，是本请求独占的临时对象，
          // 直接原地修改无需 structuredClone（性能：大工具 schema 免去一次深拷贝）。
          parameters: cleanedParams
        };
        functionDeclarations.push(fd);
      }
    }
  } else if (apiType === "claude") {
    for (const t of body.tools) {
      if (t.name === "google_search" || t.name === "builtin_web_search") continue;
      if (t.name) {
        const cleanedParams = getCleanedSchema(apiType, t.name, t.input_schema || {}, needsUppercase);
        const fd = {
          name: t.name === "local_shell_call" ? "shell" : t.name,
          description: t.description || "",
          parameters: cleanedParams
        };
        functionDeclarations.push(fd);
      }
    }
  }
  if (functionDeclarations.length > 0) {
    return [{ functionDeclarations }];
  }
  return void 0;
}
__name(mapTools, "mapTools");
__name2(mapTools, "mapTools");
// Normalize the OpenAI Responses envelope into the Chat Completions-shaped
// messages consumed by the existing Gemini/Claude conversion path.
function responseInputContentToChat(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  return content.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.type === "input_text" || item.type === "output_text") {
      return { ...item, type: "text" };
    }
    if (item.type === "input_image") {
      const imageUrl = item.image_url || item.imageUrl;
      return {
        ...item,
        type: "image_url",
        image_url: typeof imageUrl === "string" ? imageUrl : imageUrl?.url || imageUrl
      };
    }
    return item;
  });
}
__name(responseInputContentToChat, "responseInputContentToChat");
__name2(responseInputContentToChat, "responseInputContentToChat");
function responseOutputToChatText(output) {
  if (typeof output === "string") return output;
  if (output == null) return "";
  return typeof output === "object" ? JSON.stringify(output) : String(output);
}
__name(responseOutputToChatText, "responseOutputToChatText");
__name2(responseOutputToChatText, "responseOutputToChatText");
function responsesInputToChatMessages(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];
  const messages = [];
  const topLevelContent = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      if (typeof item === "string") topLevelContent.push({ type: "text", text: item });
      continue;
    }
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id || item.id || `call_${generateRandomString(8)}`,
          type: "function",
          function: {
            name: item.name || "unknown",
            arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
          }
        }]
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id || item.id || "",
        content: responseOutputToChatText(item.output)
      });
      continue;
    }
    if (item.type === "message" || item.role) {
      const role = ["developer", "system", "assistant", "tool"].includes(item.role) ? item.role : "user";
      messages.push({ role, content: responseInputContentToChat(item.content) });
      continue;
    }
    if (item.type === "input_text" || item.type === "output_text" || item.type === "input_image") {
      topLevelContent.push(responseInputContentToChat(item));
    }
  }
  if (topLevelContent.length > 0) messages.push({ role: "user", content: topLevelContent });
  return messages;
}
__name(responsesInputToChatMessages, "responsesInputToChatMessages");
__name2(responsesInputToChatMessages, "responsesInputToChatMessages");
function responsesRequestToChatRequest(body) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  } else if (Array.isArray(body.instructions)) {
    const instructionMessages = responsesInputToChatMessages(body.instructions);
    if (instructionMessages.length > 0) {
      for (const message of instructionMessages) {
        messages.push({ ...message, role: "developer" });
      }
    } else {
      messages.push({ role: "developer", content: responseInputContentToChat(body.instructions) });
    }
  }
  messages.push(...responsesInputToChatMessages(body.input));
  const tools = Array.isArray(body.tools) ? body.tools.flatMap((tool) => {
    if (!tool || tool.type !== "function") return [];
    return [{
      type: "function",
      function: {
        name: tool.name || "unknown",
        description: tool.description || "",
        parameters: tool.parameters || {},
        ...(tool.strict !== void 0 ? { strict: tool.strict } : {})
      }
    }];
  }) : void 0;
  const textFormat = body.text?.format;
  let responseFormat = void 0;
  if (textFormat?.type === "json_object") {
    responseFormat = { type: "json_object" };
  } else if (textFormat?.type === "json_schema") {
    responseFormat = {
      type: "json_schema",
      json_schema: {
        name: textFormat.name || "response",
        schema: textFormat.schema || {},
        strict: textFormat.strict !== false
      }
    };
  }
  return {
    ...body,
    messages,
    tools,
    max_tokens: body.max_output_tokens ?? body.max_tokens,
    response_format: responseFormat,
    reasoning_effort: body.reasoning?.effort || body.reasoning?.effort_level,
    reasoning: body.reasoning,
    prompt_cache_key: body.prompt_cache_key || body.promptCacheKey || body.previous_response_id
  };
}
__name(responsesRequestToChatRequest, "responsesRequestToChatRequest");
__name2(responsesRequestToChatRequest, "responsesRequestToChatRequest");
function getOpenAIToolConfig(body) {
  const choice = body?.tool_choice;
  if (choice === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  if (choice === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }
  if (choice && typeof choice === "object" && choice.type === "function" && choice.name) {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [choice.name]
      }
    };
  }
  return { functionCallingConfig: { mode: "AUTO" } };
}
__name(getOpenAIToolConfig, "getOpenAIToolConfig");
__name2(getOpenAIToolConfig, "getOpenAIToolConfig");
function responseUsageFromGoogle(usageMetadata) {
  if (!usageMetadata) return void 0;
  const cachedTokens = usageMetadata.cachedContentTokenCount || 0;
  const reasoningTokens = usageMetadata.thoughtsTokenCount || 0;
  return {
    input_tokens: usageMetadata.promptTokenCount || 0,
    output_tokens: (usageMetadata.candidatesTokenCount || 0) + reasoningTokens,
    total_tokens: usageMetadata.totalTokenCount || 0,
    input_tokens_details: { cached_tokens: cachedTokens },
    output_tokens_details: { reasoning_tokens: reasoningTokens }
  };
}
__name(responseUsageFromGoogle, "responseUsageFromGoogle");
__name2(responseUsageFromGoogle, "responseUsageFromGoogle");
function responsesStatusFromFinishReason(finishReason) {
  const upperReason = String(finishReason || "STOP").toUpperCase();
  if (upperReason === "MAX_TOKENS") {
    return { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } };
  }
  if (upperReason === "SAFETY" || upperReason === "RECITATION") {
    return { status: "incomplete", incomplete_details: { reason: "content_filter" } };
  }
  return { status: "completed", incomplete_details: null };
}
__name(responsesStatusFromFinishReason, "responsesStatusFromFinishReason");
__name2(responsesStatusFromFinishReason, "responsesStatusFromFinishReason");
function googleResponseToResponses(data, inputModel, mode) {
  const raw = data?.response || data || {};
  const output = [];
  const statusInfo = responsesStatusFromFinishReason(raw.candidates?.[0]?.finishReason);
  for (let candidateIndex = 0; candidateIndex < (raw.candidates || []).length; candidateIndex++) {
    const candidate = raw.candidates[candidateIndex];
    const textParts = [];
    const reasoningParts = [];
    const functionCalls = [];
    const parts = candidate?.content?.parts || [];
    const hasExplicitThought = parts.some((part) => part?.thought === true);
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      const isThought = part?.thought === true || (!hasExplicitThought && mode === "antigravity" && partIndex === 0 && parts.length >= 2);
      if (part?.text) (isThought ? reasoningParts : textParts).push(part.text);
      if (part?.functionCall) {
        const fc = part.functionCall;
        const rawId = fc.id || `call_${fc.name || "function"}_${generateRandomString(8)}`;
        const callId = encodeToolCallIdentity(rawId, part.thoughtSignature || part.thought_signature);
        functionCalls.push({
          type: "function_call",
          id: `fc_${generateRandomString(16)}`,
          call_id: callId,
          name: fc.name || "unknown",
          arguments: typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args || {}),
          status: "completed"
        });
      }
    }
    if (reasoningParts.length > 0) {
      output.push({
        type: "reasoning",
        id: `rs_${generateRandomString(16)}`,
        status: "completed",
        summary: [{ type: "summary_text", text: reasoningParts.join("") }]
      });
    }
    if (textParts.length > 0 || functionCalls.length === 0) {
      output.push({
        type: "message",
        id: `msg_${generateRandomString(24)}`,
        status: statusInfo.status,
        role: "assistant",
        content: [{ type: "output_text", text: textParts.join(""), annotations: [], logprobs: [] }]
      });
    }
    output.push(...functionCalls);
  }
  const outputText = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
  return {
    id: `resp_${generateRandomString(24)}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1e3),
    status: statusInfo.status,
    incomplete_details: statusInfo.incomplete_details,
    model: inputModel,
    output,
    output_text: outputText,
    completed_at: Math.floor(Date.now() / 1e3),
    error: null,
    instructions: null,
    max_output_tokens: null,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    user: null,
    metadata: {},
    usage: responseUsageFromGoogle(raw.usageMetadata)
  };
}
__name(googleResponseToResponses, "googleResponseToResponses");
__name2(googleResponseToResponses, "googleResponseToResponses");
async function callUpstream(method, requestHeaders, payload, isStream, serializedPayload) {
  const isCodeAssist = requestHeaders && requestHeaders["Client-Metadata"] && !requestHeaders["x-client-name"];
  const baseUrls = isCodeAssist ? [
    "https://cloudcode-pa.googleapis.com/v1internal"
  ] : [
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal",
    "https://daily-cloudcode-pa.googleapis.com/v1internal",
    "https://cloudcode-pa.googleapis.com/v1internal"
  ];
  let hasTriggeredDowngrade = false;
  let headersCopy = { ...requestHeaders };
  // payload 序列化是 O(N) 的 CPU 热点（上下文越长越明显）。调用方
  // handleApiProxy 可能已序列化过一次（用于重试），传入可复用避免重复序列化。
  if (serializedPayload === void 0) {
    serializedPayload = JSON.stringify(payload);
  }
  while (true) {
    let lastError = null;
    let shouldRetryWithoutHeader = false;
    for (let i = 0; i < baseUrls.length; i++) {
      const baseUrl = baseUrls[i];
      const hasNext = i + 1 < baseUrls.length;
      let url = `${baseUrl}:${method}`;
      if (isStream) {
        url += "?alt=sse";
      }
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: headersCopy,
          body: serializedPayload
        });
        // 临时可观测性：只记录端点、状态、方法、请求体字节数和顶层
        // requestId，不记录上下文、工具参数或 OAuth 信息。用于确认
        // Antigravity 的 429 是单个端点问题还是所有端点都拒绝。
        console.warn(`[upstream] endpoint=${i + 1}/${baseUrls.length} method=${method} status=${response.status} bytes=${serializedPayload.length} requestId=${payload?.requestId || "none"}`);
        if (response.ok) {
          return response;
        }
        const status = response.status;
        if (status === 403 && !hasTriggeredDowngrade && headersCopy["x-goog-user-project"]) {
          shouldRetryWithoutHeader = true;
          break;
        }
        // 400 (INVALID_ARGUMENT) 也会偶发出现于 Antigravity agent API。
        // 对于 403 Forbidden（如 sandbox 权限拦截或订阅限制），如果有后续端点，也允许回退到生产端点。
        const isRetryable = status === 429 || status === 408 || status === 404 || status === 400 || status === 403 || status >= 500;
        if (hasNext && isRetryable) {
          if (response.body) {
            await response.body.cancel();
          }
          lastError = `Upstream ${baseUrl} returned status ${status}`;
          continue;
        }
        return response;
      } catch (e) {
        lastError = `HTTP request failed at ${baseUrl}: ${e.message || e}`;
        if (hasNext) {
          continue;
        }
        break;
      }
    }
    if (shouldRetryWithoutHeader) {
      delete headersCopy["x-goog-user-project"];
      // CPU 优化：project 已为空时跳过整包 JSON.stringify（对 400KB+ 上下文
      // 是显著的 O(N) CPU 开销）。首次调用 antigravity 模式时 payload.project
      // 本来就是 ""，降级重试时无需重新序列化。
      if (payload && payload.project === "") {
        // project 已为空：payload 未变，serializedPayload 仍然有效。
      } else if (payload && payload.project) {
        payload.project = "";
        serializedPayload = JSON.stringify(payload);
      }
      hasTriggeredDowngrade = true;
      continue;
    }
    throw new Error(lastError || "All upstream endpoints failed");
  }
}
__name(callUpstream, "callUpstream");
__name2(callUpstream, "callUpstream");
function isResponseEmpty(data) {
  if (!data) return true;
  const raw = data.response || data;
  if (!raw || typeof raw !== "object") return true;
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) return true;
  let hasAnyContent = false;
  for (const candidate of raw.candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const parts = candidate.content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      for (const part of parts) {
        if (!part || typeof part !== "object") continue;
        if (typeof part.text === "string" && /\S/u.test(part.text)) {
          hasAnyContent = true;
          break;
        }
        if (part.functionCall && typeof part.functionCall === "object") {
          hasAnyContent = true;
          break;
        }
        if (part.inlineData || part.fileData) {
          hasAnyContent = true;
          break;
        }
        if (part.thought === true && typeof part.text === "string" && /\S/u.test(part.text)) {
          hasAnyContent = true;
          break;
        }
      }
    }
    if (hasAnyContent) break;
  }
  return !hasAnyContent;
}
__name(isResponseEmpty, "isResponseEmpty");
__name2(isResponseEmpty, "isResponseEmpty");
// 流式响应逐块读取。空流判定在读取过程中增量完成：一旦发现有效内容行
// 即停止 JSON 解析，消除旧版 isSseLinesEmpty 对全部行的二次遍历。
async function readSseLines(readableStream) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines = [];
  let hasAnyContent = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let splitLines = buffer.split("\n");
      buffer = splitLines.pop();
      for (const line of splitLines) {
        lines.push(line);
        if (!hasAnyContent) {
          hasAnyContent = isSseDataLineMeaningful(line);
        }
      }
    }
    if (buffer.length > 0) {
      lines.push(buffer);
      if (!hasAnyContent) {
        hasAnyContent = isSseDataLineMeaningful(buffer);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {}
  }
  return { lines, hasAnyContent };
}
__name(readSseLines, "readSseLines");
__name2(readSseLines, "readSseLines");
// 判断单个 SSE data 行是否包含有效内容（与旧版 isSseLinesEmpty 语义一致）。
function isSseDataLineMeaningful(line) {
  if (!line.startsWith("data: ")) return false;
  const dataStr = line.slice(6).trim();
  if (dataStr === "[DONE]") return false;
  try {
    return !isResponseEmpty(JSON.parse(dataStr));
  } catch (e) {
    return false;
  }
}
__name(isSseDataLineMeaningful, "isSseDataLineMeaningful");
__name2(isSseDataLineMeaningful, "isSseDataLineMeaningful");
async function writeResponsesEvent(writer, encoder, type, payload, sequenceNumber) {
  const event = { type, ...payload };
  if (sequenceNumber !== void 0) event.sequence_number = sequenceNumber;
  await writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`));
}
__name(writeResponsesEvent, "writeResponsesEvent");
__name2(writeResponsesEvent, "writeResponsesEvent");
async function processResponsesStreamLines(lines, writableStream, inputModel, mode, env, sessionId, messageCount, ctx) {
  const writer = writableStream.getWriter();
  const encoder = new TextEncoder();
  let sequenceNumber = 1;
  const emit = (type, payload) => writeResponsesEvent(writer, encoder, type, payload, sequenceNumber++);
  const responseId = `resp_${generateRandomString(24)}`;
  const createdAt = Math.floor(Date.now() / 1e3);
  const output = [];
  const functionCallStates = new Map();
  let messageState = null;
  let reasoningState = null;
  let responseText = "";
  let finishReason = "STOP";
  let finalUsage = null;
  const responseSkeleton = {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    completed_at: null,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: inputModel,
    output: [],
    output_text: "",
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    user: null,
    metadata: {},
    usage: null
  };
  try {
    await emit("response.created", { response: responseSkeleton });
    await emit("response.in_progress", { response: responseSkeleton });
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === "[DONE]") continue;
      let chunk;
      try {
        chunk = JSON.parse(dataStr);
      } catch (_) {
        continue;
      }
      const responseBlock = chunk.response || chunk;
      if (responseBlock?.usageMetadata) finalUsage = responseBlock.usageMetadata;
      const candidate = responseBlock?.candidates?.[0];
      if (!candidate) continue;
      if (candidate.finishReason) finishReason = candidate.finishReason;
      const parts = candidate.content?.parts;
      if (!Array.isArray(parts)) continue;
      const hasExplicitThought = parts.some((part) => part?.thought === true);
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        const isThought = part?.thought === true || (!hasExplicitThought && mode === "antigravity" && partIndex === 0 && parts.length >= 2);
        if (part?.text) {
          if (isThought) {
            if (!reasoningState) {
              reasoningState = {
                type: "reasoning",
                id: `rs_${generateRandomString(16)}`,
                status: "in_progress",
                summary: [{ type: "summary_text", text: "" }],
                output_index: output.length
              };
              output.push(reasoningState);
              await emit("response.output_item.added", {
                output_index: reasoningState.output_index,
                item: { ...reasoningState, output_index: void 0 }
              });
              await emit("response.reasoning_summary_part.added", {
                item_id: reasoningState.id,
                output_index: reasoningState.output_index,
                summary_index: 0,
                part: { type: "summary_text", text: "" }
              });
            }
            reasoningState.summary[0].text += part.text;
            await emit("response.reasoning_summary_text.delta", {
              item_id: reasoningState.id,
              output_index: reasoningState.output_index,
              summary_index: 0,
              delta: part.text
            });
          } else {
            if (!messageState) {
              messageState = {
                type: "message",
                id: `msg_${generateRandomString(24)}`,
                status: "in_progress",
                role: "assistant",
                content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }],
                output_index: output.length
              };
              output.push(messageState);
              await emit("response.output_item.added", {
                output_index: messageState.output_index,
                item: { ...messageState, output_index: void 0 }
              });
              await emit("response.content_part.added", {
                item_id: messageState.id,
                output_index: messageState.output_index,
                content_index: 0,
                part: { type: "output_text", text: "", annotations: [], logprobs: [] }
              });
            }
            messageState.content[0].text += part.text;
            responseText += part.text;
            await emit("response.output_text.delta", {
              item_id: messageState.id,
              output_index: messageState.output_index,
              content_index: 0,
              delta: part.text,
              logprobs: []
            });
          }
        }
        if (part?.functionCall) {
          const fc = part.functionCall;
          const rawId = fc.id || `call_${fc.name || "function"}_${generateRandomString(8)}`;
          const callId = encodeToolCallIdentity(rawId, part.thoughtSignature || part.thought_signature);
          let state = functionCallStates.get(callId);
          if (!state) {
            state = {
              type: "function_call",
              id: `fc_${generateRandomString(16)}`,
              call_id: callId,
              name: fc.name || "unknown",
              arguments: "",
              status: "in_progress",
              output_index: output.length
            };
            functionCallStates.set(callId, state);
            output.push(state);
            await emit("response.output_item.added", {
              output_index: state.output_index,
              item: { ...state, output_index: void 0 }
            });
          }
          const args = typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args || {});
          state.arguments += args;
          await emit("response.function_call_arguments.delta", {
            item_id: state.id,
            output_index: state.output_index,
            delta: args
          });
        }
      }
    }
    if (reasoningState) {
      reasoningState.status = "completed";
      await emit("response.reasoning_summary_text.done", {
        item_id: reasoningState.id,
        output_index: reasoningState.output_index,
        summary_index: 0,
        text: reasoningState.summary[0].text
      });
      await emit("response.reasoning_summary_part.done", {
        item_id: reasoningState.id,
        output_index: reasoningState.output_index,
        summary_index: 0,
        part: reasoningState.summary[0]
      });
      await emit("response.output_item.done", {
        output_index: reasoningState.output_index,
        item: { ...reasoningState, output_index: void 0 }
      });
    }
    if (messageState) {
      const statusInfo = responsesStatusFromFinishReason(finishReason);
      messageState.status = statusInfo.status;
      await emit("response.output_text.done", {
        item_id: messageState.id,
        output_index: messageState.output_index,
        content_index: 0,
        text: messageState.content[0].text,
        logprobs: []
      });
      await emit("response.content_part.done", {
        item_id: messageState.id,
        output_index: messageState.output_index,
        content_index: 0,
        part: messageState.content[0]
      });
      await emit("response.output_item.done", {
        output_index: messageState.output_index,
        item: { ...messageState, output_index: void 0 }
      });
    }
    for (const state of functionCallStates.values()) {
      state.status = "completed";
      await emit("response.function_call_arguments.done", {
        item_id: state.id,
        output_index: state.output_index,
        arguments: state.arguments
      });
      await emit("response.output_item.done", {
        output_index: state.output_index,
        item: { ...state, output_index: void 0 }
      });
    }
    const statusInfo = responsesStatusFromFinishReason(finishReason);
    const finalResponse = {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: statusInfo.status,
      incomplete_details: statusInfo.incomplete_details,
      model: inputModel,
    output: output.map(({ output_index, ...item }) => item),
    output_text: responseText,
    completed_at: Math.floor(Date.now() / 1e3),
    error: null,
    instructions: null,
    max_output_tokens: null,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    user: null,
    metadata: {},
    usage: responseUsageFromGoogle(finalUsage)
  };
    await emit("response.completed", { response: finalResponse });
  } finally {
    try {
      await writer.close();
    } catch (_) {}
  }
}
__name(processResponsesStreamLines, "processResponsesStreamLines");
__name2(processResponsesStreamLines, "processResponsesStreamLines");
async function streamResponsesSimulatedResponse(data, writableStream, inputModel, mode, env, sessionId, messageCount, ctx) {
  return processResponsesStreamLines([`data: ${JSON.stringify(data)}`], writableStream, inputModel, mode, env, sessionId, messageCount, ctx);
}
__name(streamResponsesSimulatedResponse, "streamResponsesSimulatedResponse");
__name2(streamResponsesSimulatedResponse, "streamResponsesSimulatedResponse");
async function processStreamLines(lines, writableStream, apiType, modelName, env, sessionId, messageCount, ctx) {
  const writer = writableStream.getWriter();
  const encoder = new TextEncoder();
  // 每个 SSE 流只生成一次 chunk ID 和 created 时间戳（OpenAI SSE 规范要求同一
  // 消息的 chunk 共享同一 id），避免旧版每 chunk 重新调用 crypto.randomUUID()
  // 和 Date.now() 带来的分配与时钟开销。
  const oaiChunkId = "chatcmpl-" + generateRandomString(12);
  const oaiChunkCreated = Math.floor(Date.now() / 1e3);
  const oaiIdPrefix = JSON.stringify(oaiChunkId);
  const oaiObjectStr = JSON.stringify("chat.completion.chunk");
  const oaiCreatedStr = String(oaiChunkCreated);
  const oaiModelStr = JSON.stringify(modelName);
  // 上游 SSE 每个 chunk 都可能携带 usageMetadata（最终计数在最后一个 chunk）。
  // 预扫一遍：仅对包含 "usageMetadata" 的行做 JSON.parse，开销可忽略。
  // 用于 OpenAI usage chunk 和 Claude message_start/message_delta 的真实用量。
  let finalUsage = null;
  for (const line of lines) {
    if (!line.startsWith("data: ") || !line.includes('"usageMetadata"')) continue;
    try {
      const parsed = JSON.parse(line.slice(6).trim());
      const meta = (parsed.response || parsed).usageMetadata;
      if (meta) finalUsage = meta;
    } catch (e) {
    }
  }
  let claudeStarted = false;
  let claudeTextIndex = 0;
  let currentBlockType = null;
  let lastQueuedSignature = null;
  let cachedSignaturePromise = null;
  // Chat Completions tool calls must use a distinct, stable index for each
  // function call. Reusing index 0 makes CCR merge multiple calls into one
  // malformed call (for example, `{}{"cmd":"..."}`), which can make the
  // client repeat tools indefinitely.
  let nextOpenAiToolIndex = 0;
  const openAiToolIndexById = /* @__PURE__ */ new Map();
  try {
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.slice(6).trim();
      if (dataStr === "[DONE]") continue;
      try {
        const chunk = JSON.parse(dataStr);
        const responseBlock = chunk.response || chunk;
        const candidate = responseBlock?.candidates?.[0];
        if (!candidate) continue;
        const parts = candidate.content?.parts;
        if (Array.isArray(parts) && sessionId && env && ctx) {
          for (const part of parts) {
            const sig = part["thoughtSignature"] || part["thought_signature"];
            if (sig && sig.length >= 50 && sig !== lastQueuedSignature) {
              lastQueuedSignature = sig;
              ctx.waitUntil(cacheSessionSignature(env, sessionId, sig, messageCount, ctx));
            }
          }
        }
        if (apiType === "openai") {
          if (Array.isArray(parts)) {
            const hasExplicitThought = parts.some((p) => p["thought"] === true);
            for (let pIdx = 0; pIdx < parts.length; pIdx++) {
              const part = parts[pIdx];
              const isThought = part["thought"] === true || (!hasExplicitThought && pIdx === 0 && parts.length >= 2);
              if (part.text) {
                // 手动拼接 SSE JSON，避免对固定字段反复 JSON.stringify 和
                // 中间对象的分配。语义与逐字段 JSON.stringify 完全等价。
                const deltaKey = isThought ? "reasoning_content" : "content";
                const deltaVal = JSON.stringify(part.text);
                await writer.write(encoder.encode(
                  `data: {"id":${oaiIdPrefix},"object":${oaiObjectStr},"created":${oaiCreatedStr},"model":${oaiModelStr},"choices":[{"index":0,"delta":{"${deltaKey}":${deltaVal}}}]}\n\n`
                ));
              }
              if (part.functionCall) {
                const fc = part.functionCall;
                const name = fc.name || "unknown";
                const rawId = fc.id || `call_${name}_${generateRandomString(8)}`;
                const id = encodeToolCallIdentity(rawId, part["thoughtSignature"] || part["thought_signature"]);
                let toolIndex = openAiToolIndexById.get(id);
                if (toolIndex === void 0) {
                  toolIndex = nextOpenAiToolIndex++;
                  openAiToolIndexById.set(id, toolIndex);
                }
                const toolIdStr = JSON.stringify(id);
                const toolNameStr = JSON.stringify(name);
                // OpenAI 协议要求 arguments 是字符串（JSON 文本），对象需双重编码。
                const toolArgsStr = typeof fc.args === "object" ? JSON.stringify(JSON.stringify(fc.args)) : JSON.stringify(fc.args || "{}");
                await writer.write(encoder.encode(
                  `data: {"id":${oaiIdPrefix},"object":${oaiObjectStr},"created":${oaiCreatedStr},"model":${oaiModelStr},"choices":[{"index":0,"delta":{"tool_calls":[{"index":${toolIndex},"id":${toolIdStr},"type":"function","function":{"name":${toolNameStr},"arguments":${toolArgsStr}}}]}}]}\n\n`
                ));
              }
            }
          }
          if (candidate.finishReason) {
            let oaiFinishReason = "stop";
            const upperReason = candidate.finishReason.toUpperCase();
            if (upperReason === "MAX_TOKENS") {
              oaiFinishReason = "length";
            } else if (upperReason === "SAFETY" || upperReason === "RECITATION") {
              oaiFinishReason = "content_filter";
            }
            const finishReasonStr = JSON.stringify(oaiFinishReason);
            await writer.write(encoder.encode(
              `data: {"id":${oaiIdPrefix},"object":${oaiObjectStr},"created":${oaiCreatedStr},"model":${oaiModelStr},"choices":[{"index":0,"delta":{},"finish_reason":${finishReasonStr}}]}\n\n`
            ));
          }
        } else if (apiType === "claude") {
          if (!claudeStarted) {
            const startEvent = {
              type: "message_start",
              message: {
                id: "msg_" + generateRandomString(24),
                type: "message",
                role: "assistant",
                model: modelName,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: Math.max(0, (finalUsage?.promptTokenCount || 0) - (finalUsage?.cachedContentTokenCount || 0)),
                  output_tokens: 0,
                  cache_read_input_tokens: finalUsage?.cachedContentTokenCount || 0
                }
              }
            };
            await writer.write(encoder.encode(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`));
            claudeStarted = true;
          }
          if (Array.isArray(parts)) {
            const hasExplicitThought = parts.some((p) => p["thought"] === true);
            for (let pIdx = 0; pIdx < parts.length; pIdx++) {
              const part = parts[pIdx];
              const isThought = part["thought"] === true || (!hasExplicitThought && pIdx === 0 && parts.length >= 2);
              if (isThought && part.text) {
                if (currentBlockType !== "thinking") {
                  if (currentBlockType !== null) {
                    await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: claudeTextIndex })}\n\n`));
                    claudeTextIndex++;
                  }
                  let signatureToUse = part["thoughtSignature"] || part["thought_signature"];
                  if (!signatureToUse && sessionId && env) {
                    if (!cachedSignaturePromise) {
                      cachedSignaturePromise = getSessionSignature(env, sessionId);
                    }
                    signatureToUse = await cachedSignaturePromise;
                  }
                  if (!signatureToUse) {
                    signatureToUse = "skip_thought_signature_validator";
                  }
                  const blockStart = {
                    type: "content_block_start",
                    index: claudeTextIndex,
                    content_block: { type: "thinking", thinking: "", signature: signatureToUse }
                  };
                  await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`));
                  currentBlockType = "thinking";
                }
                const deltaEvent = {
                  type: "content_block_delta",
                  index: claudeTextIndex,
                  delta: { type: "thinking_delta", thinking: part.text }
                };
                await writer.write(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`));
              } else if (!isThought && part.text) {
                if (currentBlockType !== "text") {
                  if (currentBlockType !== null) {
                    await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: claudeTextIndex })}\n\n`));
                    claudeTextIndex++;
                  }
                  const blockStart = {
                    type: "content_block_start",
                    index: claudeTextIndex,
                    content_block: { type: "text", text: "" }
                  };
                  await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`));
                  currentBlockType = "text";
                }
                const deltaEvent = {
                  type: "content_block_delta",
                  index: claudeTextIndex,
                  delta: { type: "text_delta", text: part.text }
                };
                await writer.write(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`));
              }
              if (part.functionCall) {
                if (currentBlockType !== null) {
                  await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: claudeTextIndex })}\n\n`));
                  claudeTextIndex++;
                  currentBlockType = null;
                }
                const fc = part.functionCall;
                const name = fc.name || "unknown";
                const id = fc.id || `toolu_${generateRandomString(12)}`;
                const toolBlockStart = {
                  type: "content_block_start",
                  index: claudeTextIndex,
                  content_block: { type: "tool_use", id, name, input: {} }
                };
                await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(toolBlockStart)}\n\n`));
                const argsStr = typeof fc.args === "object" ? JSON.stringify(fc.args) : fc.args || "{}";
                const toolDelta = {
                  type: "content_block_delta",
                  index: claudeTextIndex,
                  delta: { type: "input_json_delta", partial_json: argsStr }
                };
                await writer.write(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(toolDelta)}\n\n`));
                await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: claudeTextIndex })}\n\n`));
                claudeTextIndex++;
              }
            }
          }
          if (candidate.finishReason) {
            if (currentBlockType !== null) {
              await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: claudeTextIndex })}\n\n`));
              currentBlockType = null;
            }
            const msgDelta = {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: {
                input_tokens: Math.max(0, (finalUsage?.promptTokenCount || 0) - (finalUsage?.cachedContentTokenCount || 0)),
                output_tokens: (finalUsage?.candidatesTokenCount || 0) + (finalUsage?.thoughtsTokenCount || 0),
                cache_read_input_tokens: finalUsage?.cachedContentTokenCount || 0
              }
            };
            await writer.write(encoder.encode(`event: message_delta\ndata: ${JSON.stringify(msgDelta)}\n\n`));
            await writer.write(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`));
          }
        } else {
          await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (e) {
      }
    }
    if (apiType === "openai") {
      if (finalUsage) {
        const cachedStr = finalUsage.cachedContentTokenCount ? `,"prompt_tokens_details":{"cached_tokens":${finalUsage.cachedContentTokenCount}}` : "";
        const cachedTop = finalUsage.cachedContentTokenCount ? `,"cache_read_input_tokens":${finalUsage.cachedContentTokenCount}` : "";
        const usageStr = `{"prompt_tokens":${finalUsage.promptTokenCount || 0},"completion_tokens":${(finalUsage.candidatesTokenCount || 0) + (finalUsage.thoughtsTokenCount || 0)},"total_tokens":${finalUsage.totalTokenCount || 0}${cachedStr}${cachedTop}}`;
        await writer.write(encoder.encode(
          `data: {"id":${oaiIdPrefix},"object":${oaiObjectStr},"created":${oaiCreatedStr},"model":${oaiModelStr},"choices":[],"usage":${usageStr}}\n\n`
        ));
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    }
  } finally {
    try {
      await writer.close();
    } catch (_) {
    }
  }
}
__name(processStreamLines, "processStreamLines");
__name2(processStreamLines, "processStreamLines");
async function processStream(readableStream, writableStream, apiType, modelName, env, sessionId, messageCount, ctx) {
  const { lines } = await readSseLines(readableStream);
  return processStreamLines(lines, writableStream, apiType, modelName, env, sessionId, messageCount, ctx);
}
__name(processStream, "processStream");
__name2(processStream, "processStream");
async function streamTextChunks(text, writer, encoder, makeChunkFn, chunkSize = 16, delayMs = 15) {
  for (let i = 0; i < text.length; i += chunkSize) {
    const slice = text.slice(i, i + chunkSize);
    const chunkData = makeChunkFn(slice);
    await writer.write(encoder.encode(`data: ${JSON.stringify(chunkData)}

`));
    await sleep(delayMs);
  }
}
__name(streamTextChunks, "streamTextChunks");
__name2(streamTextChunks, "streamTextChunks");
// streamTextChunks 的零分配版本：闭包只负责拼 JSON 字符串，不在每 chunk
// 创建新对象再序列化。`created` 只在闭包创建时计算一次。
async function streamTextChunksFast(text, writer, encoder, makeData, chunkSize, delayMs) {
  for (let i = 0; i < text.length; i += chunkSize) {
    await writer.write(encoder.encode(makeData(text.slice(i, i + chunkSize))));
    await sleep(delayMs);
  }
}
__name(streamTextChunksFast, "streamTextChunksFast");
__name2(streamTextChunksFast, "streamTextChunksFast");
async function streamSimulatedResponse(data, apiType, inputModel, writer, encoder, env, sessionId, messageCount, ctx) {
  try {
    const raw = data.response || data;
    const candidate = raw.candidates?.[0];
    const simUsage = raw.usageMetadata || null;
    let contentOut = "";
    let thoughtOut = "";
    let thoughtSignature = null;
    const toolCalls = [];
    let nextToolIndex = 0;
    if (candidate?.content && Array.isArray(candidate.content.parts)) {
      const responseParts = candidate.content.parts;
      const hasExplicitThought = responseParts.some((p) => p["thought"] === true);
      for (let partIdx = 0; partIdx < responseParts.length; partIdx++) {
        const part = responseParts[partIdx];
        const sig = part["thoughtSignature"] || part["thought_signature"];
        if (sig && sig.length >= 50) {
          thoughtSignature = sig;
          if (sessionId && env && ctx) {
            ctx.waitUntil(cacheSessionSignature(env, sessionId, sig, messageCount, ctx));
          }
        }
        if (part["thought"] === true) {
          thoughtOut += part.text || "";
        } else if (part.text) {
          if (!hasExplicitThought && partIdx === 0 && responseParts.length >= 2) {
            thoughtOut += part.text || "";
          } else {
            contentOut += part.text || "";
          }
        }
        if (part.functionCall) {
          const fc = part.functionCall;
          const name = fc.name || "unknown";
          const id = fc.id || `call_${name}_${generateRandomString(8)}`;
          toolCalls.push({
            index: nextToolIndex++,
            id,
            type: "function",
            function: {
              name,
              arguments: typeof fc.args === "object" ? JSON.stringify(fc.args) : fc.args || "{}"
            }
          });
        }
      }
    }
    if (apiType === "openai") {
      const id = "chatcmpl-" + generateRandomString(12);
      const chunkCreated = Math.floor(Date.now() / 1e3);
      if (thoughtOut) {
        await streamTextChunksFast(
          thoughtOut,
          writer,
          encoder,
          (slice) => `data: {"id":${JSON.stringify(id)},"object":"chat.completion.chunk","created":${chunkCreated},"model":${JSON.stringify(inputModel)},"choices":[{"index":0,"delta":{"reasoning_content":${JSON.stringify(slice)}}}]}\n\n`,
          24,
          10
        );
      }
      if (contentOut) {
        await streamTextChunksFast(
          contentOut,
          writer,
          encoder,
          (slice) => `data: {"id":${JSON.stringify(id)},"object":"chat.completion.chunk","created":${chunkCreated},"model":${JSON.stringify(inputModel)},"choices":[{"index":0,"delta":{"content":${JSON.stringify(slice)}}}]}\n\n`,
          12,
          15
        );
      }
      if (toolCalls.length > 0) {
        const chunk = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1e3),
          model: inputModel,
          choices: [{ index: 0, delta: { tool_calls: toolCalls } }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}

`));
      }
      let oaiFinishReason = "stop";
      if (candidate && candidate.finishReason) {
        const upperReason = candidate.finishReason.toUpperCase();
        if (upperReason === "MAX_TOKENS") {
          oaiFinishReason = "length";
        } else if (upperReason === "SAFETY" || upperReason === "RECITATION") {
          oaiFinishReason = "content_filter";
        } else if (upperReason === "OTHER" || upperReason === "FINISH_REASON_UNSPECIFIED") {
          oaiFinishReason = "other";
        } else if (upperReason === "STOP") {
          oaiFinishReason = "stop";
        }
      }
      const finishChunk = {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1e3),
        model: inputModel,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: oaiFinishReason
        }]
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(finishChunk)}

`));
      if (simUsage) {
        const usageChunk = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1e3),
          model: inputModel,
          choices: [],
          usage: {
            prompt_tokens: simUsage.promptTokenCount || 0,
            completion_tokens: (simUsage.candidatesTokenCount || 0) + (simUsage.thoughtsTokenCount || 0),
            total_tokens: simUsage.totalTokenCount || 0,
            ...(simUsage.cachedContentTokenCount ? {
              prompt_tokens_details: { cached_tokens: simUsage.cachedContentTokenCount },
              cache_read_input_tokens: simUsage.cachedContentTokenCount
            } : {})
          }
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } else if (apiType === "claude") {
      const messageId = "msg_" + generateRandomString(24);
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: inputModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: Math.max(0, (simUsage?.promptTokenCount || 0) - (simUsage?.cachedContentTokenCount || 0)),
            output_tokens: 0,
            cache_read_input_tokens: simUsage?.cachedContentTokenCount || 0
          }
        }
      })}

`));
      let blockIndex = 0;
      if (thoughtOut) {
        void thoughtOut;
      }
      if (contentOut || toolCalls.length === 0) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: "content_block_start",
          index: blockIndex,
          content_block: { type: "text", text: "" }
        })}

`));
        if (contentOut) {
          await streamTextChunksFast(
            contentOut,
            writer,
            encoder,
            (slice) => `data: {"type":"content_block_delta","index":${blockIndex},"delta":{"type":"text_delta","text":${JSON.stringify(slice)}}}\n\n`,
            12,
            15
          );
        }
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: "content_block_stop",
          index: blockIndex
        })}

`));
        blockIndex++;
      }
      for (const tc of toolCalls) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: "content_block_start",
          index: blockIndex,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments)
          }
        })}

`));
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: "content_block_stop",
          index: blockIndex
        })}

`));
        blockIndex++;
      }
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: {
          input_tokens: Math.max(0, (simUsage?.promptTokenCount || 0) - (simUsage?.cachedContentTokenCount || 0)),
          output_tokens: (simUsage?.candidatesTokenCount || 0) + (simUsage?.thoughtsTokenCount || 0),
          cache_read_input_tokens: simUsage?.cachedContentTokenCount || 0
        }
      })}

`));
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "message_stop"
      })}

`));
    } else if (apiType === "gemini") {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}

`));
    }
  } finally {
    await writer.close();
  }
}
__name(streamSimulatedResponse, "streamSimulatedResponse");
__name2(streamSimulatedResponse, "streamSimulatedResponse");
async function handleLogin(request, env) {
  if (request.method === "POST") {
    const formData = await request.formData();
    const username = formData.get("username");
    const password = formData.get("password");
    const pwdHash = await sha256(password);
    let user = await env.GEMINI_KV.get(`user:${username}`, "json");
    if (!user) {
      user = {
        password_hash: pwdHash,
        is_first_login: true,
        accounts: [],
        google_tokens: null,
        antigravity_tokens: null,
        api_config: {
          custom_path: generateRandomString(8),
          api_key: "sk-" + generateRandomString(24),
          codeassist_pattern: "{modelname}",
          antigravity_pattern: "{modelname}-agy"
        }
      };
      await env.GEMINI_KV.put(`user:${username}`, JSON.stringify(user));
      await env.GEMINI_KV.put(`path:${user.api_config.custom_path}`, username);
      await env.GEMINI_KV.put(`key:${user.api_config.api_key}`, username);
    } else if (user.password_hash !== pwdHash) {
      return new Response("\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF", { status: 401 });
    }
    const sessionId = generateRandomString(32);
    await env.GEMINI_KV.put(`session:${sessionId}`, username, { expirationTtl: 86400 });
    return new Response("Logged in", {
      status: 302,
      headers: { "Location": "/dashboard", "Set-Cookie": `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax` }
    });
  }
  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>\u767B\u5F55</title>
    <style>body{font-family:sans-serif;max-width:400px;margin:50px auto;padding:20px;}input,button{width:100%;margin-bottom:15px;padding:10px;}</style></head>
    <body><h2>\u767B\u5F55/\u6CE8\u518C</h2><p>\u8F93\u5165\u672A\u6CE8\u518C\u7684\u8D26\u53F7\u5C06\u81EA\u52A8\u521B\u5EFA</p>
    <form method="POST"><input name="username" placeholder="\u7528\u6237\u540D" required><input type="password" name="password" placeholder="\u5BC6\u7801" required><button type="submit">\u8FDB\u5165\u63A7\u5236\u53F0</button></form>
    </body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}
__name(handleLogin, "handleLogin");
__name2(handleLogin, "handleLogin");
async function handleDashboard(request, env) {
  const username = await getSessionUser(request, env);
  if (!username) return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  const user = await env.GEMINI_KV.get(`user:${username}`, "json");
  const accounts = getUserAccounts(user);
  const transientCooldownByAccountId = await getAccountCooldowns(accounts, username);
  const codeassist_pattern = user.api_config.codeassist_pattern || "{modelname}";
  const antigravity_pattern = user.api_config.antigravity_pattern || "{modelname}-agy";
  const safeUsername = escapeHtml(username);
  const safeCustomPath = escapeHtml(user.api_config.custom_path);
  const safeApiKey = escapeHtml(user.api_config.api_key);
  const safeCodeassistPattern = escapeHtml(codeassist_pattern);
  const safeAntigravityPattern = escapeHtml(antigravity_pattern);
  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>\u63A7\u5236\u53F0</title>
    <style>body{font-family:sans-serif;max-width:600px;margin:20px auto;line-height:1.6;} .card{border:1px solid #ddd;padding:20px;border-radius:8px;margin-bottom:20px;} input,button{padding:8px;margin-top:5px;width:100%;box-sizing:border-box;} button{background:#007bff;color:#fff;border:none;cursor:pointer;font-weight:bold;} .status{color:green;font-weight:bold;} .sub-mode{border-left:4px solid #007bff;padding-left:15px;margin-bottom:15px;}</style>
    </head><body>
    <style>
      body { max-width: 720px !important; }
      .acc-item { border: 1px solid #dee2e6; border-radius: 6px; padding: 12px; margin-top: 10px; background: #fff; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
      .acc-item.disabled { background: #f8f9fa; border-color: #e9ecef; opacity: 0.7; }
      .tag-ag { background: #28a745; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
      .tag-ca { background: #007bff; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
      .btn-sm { width: auto !important; margin: 0 !important; padding: 4px 10px !important; font-size: 12px !important; border-radius: 4px !important; }
    </style>
    <h1>\u6B22\u8FCE, ${safeUsername}</h1>
    <h3>GemPlan\u5C06\u4F7F\u7528GoogleOAuth\u7684GeminiCodeAssist\u53CAAntigravity\u8C03\u7528\u5C01\u88C5\u4E3AAPI.</h3>
    <p>\u5236\u4F5C\u4EBA\uFF1AimAndyrrr<br>
	\u53C2\u8003\u9879\u76EE\uFF1Aglowingjade/obsidian-smart-composer\uFF1Blbjlaq/Antigravity-Manager<br>
        \u9879\u76EE\u5730\u5740\uFF1A<a href="https://github.com/imAndyrrr/GemPlan" target="_blank" rel="noopener noreferrer">https://github.com/imAndyrrr/GemPlan</a></p>
    
    <div class="card">
      <h3>\u7B2C\u4E00\u90E8\u5206\uFF1A\u4FEE\u6539\u5BC6\u7801</h3>
      <form action="/api/user/update" method="POST">
        <input type="hidden" name="action" value="password">
        <input type="password" name="new_password" placeholder="\u65B0\u5BC6\u7801" required>
        <button type="submit">\u4FEE\u6539\u5BC6\u7801</button>
      </form>
    </div>

    <div class="card">
      <h3>\u7B2C\u4E8C\u90E8\u5206\uFF1AGoogle \u8D26\u53F7\u7BA1\u7406\uFF08\u591A\u8D26\u53F7\u667A\u80FD\u8C03\u5EA6\u4E0E\u914D\u989D\u6C60\uFF09</h3>
      <p style="font-size:13px;color:#555;margin-bottom:15px;">
        \u652F\u6301\u6DFB\u52A0\u591A\u4E2A Google \u8D26\u53F7\u3002\u7CFB\u7EDF\u4F1A\u5B9E\u65F6\u76D1\u63A7\u5404\u8D26\u53F7\u914D\u989D\uFF0C<b>\u667A\u80FD\u4F18\u5148\u8C03\u5EA6\u53EF\u7528\u914D\u989D\u6700\u5145\u88D5\u7684\u8D26\u53F7</b>\uFF1B\u5F53\u67D0\u8D26\u53F7\u906D\u9047 429 \u9891\u63A7\u6216\u914D\u989D\u7528\u5C3D\u65F6\uFF0C<b>\u5168\u81EA\u52A8\u65E0\u7F1D\u6545\u969C\u8F6C\u79FB</b>\u5230\u5907\u7528\u8D26\u53F7\uFF0C\u63D0\u4F9B\u4E0D\u95F4\u65AD\u7684\u9AD8\u53EF\u7528\u6A21\u5F0F\u670D\u52A1\u3002
      </p>
      
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:15px;">
        <button onclick="window.open('/api/auth/google/start?mode=antigravity', '_blank')" style="flex:1;min-width:200px;background:#28a745;">+ \u6388\u6743\u6DFB\u52A0 Antigravity \u8D26\u53F7 (\u63A8\u8350)</button>
        <button onclick="window.open('/api/auth/google/start?mode=codeassist', '_blank')" style="flex:1;min-width:200px;background:#007bff;">+ \u6388\u6743\u6DFB\u52A0 CodeAssist \u8D26\u53F7</button>
      </div>

      <form action="/api/auth/google/callback" method="POST" style="background:#f8f9fa; border:1px solid #e9ecef; border-radius:6px; padding:12px; margin-bottom:18px;">
        <label style="font-size:13px; font-weight:bold; color:#333;">\u63D0\u4EA4\u65B0\u8D26\u53F7\u6388\u6743\uFF1A</label>
        <p style="font-size:12px; color:#666; margin:4px 0 8px;">\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u5B8C\u6210\u6388\u6743\u540E\uFF0C\u590D\u5236\u6D4F\u89C8\u5668\u4E2D\u6253\u4E0D\u5F00\u7684 localhost \u5B8C\u6574\u7F51\u5740\u7C98\u8D34\u5230\u4E0B\u65B9\uFF1A</p>
        <div style="display:flex; gap:8px;">
          <input type="text" name="redirect_url" placeholder="\u7C98\u8D34 http://localhost:8080/callback?code=... \u6216 8085 \u94FE\u63A5" required style="margin:0; flex:1;">
          <button type="submit" style="width:auto; margin:0; padding:8px 16px; background:#17a2b8; white-space:nowrap;">\u4FDD\u5B58\u6DFB\u52A0</button>
        </div>
      </form>

      <h4 style="margin:16px 0 6px; font-size:14px; color:#333;">\u5DF2\u7ED1\u5B9A\u8D26\u53F7\u5217\u8868 (${accounts.length})</h4>
      <div id="accounts-container">
        ${accounts.length === 0 ? '<div style="color:#888;font-size:13px;padding:10px 0;">\u6682\u672A\u7ED1\u5B9A\u4EFB\u4F55 Google \u8D26\u53F7\uFF0C\u8BF7\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u6388\u6743\u6DFB\u52A0\u3002</div>' : accounts.map((acc) => {
          const nowSec = Math.floor(Date.now() / 1000);
          const cooldownUntil = Math.max(Number(acc.cooldown_until) || 0, transientCooldownByAccountId.get(acc.id) || 0);
          const isCooling = cooldownUntil > nowSec;
          const remainCooldown = isCooling ? cooldownUntil - nowSec : 0;
          let statusBadge = '<span style="color:#28a745;font-weight:bold;">\uD83D\uDFE2 \u6B63\u5E38</span>';
          if (acc.enabled === false) {
            statusBadge = '<span style="color:#6c757d;font-weight:bold;">\u26AA \u5DF2\u7981\u7528</span>';
          } else if (isCooling) {
            statusBadge = `<span style="color:#fd7e14;font-weight:bold;">\u23F3 429\u51B7\u5374\u4E2D (${remainCooldown}s)</span>`;
          } else if (acc.status === "error") {
            statusBadge = '<span style="color:#dc3545;font-weight:bold;">\uD83D\uDD34 \u6388\u6743\u5F02\u5E38</span>';
          } else if (acc.status === "quota_unavailable") {
            statusBadge = '<span style="color:#fd7e14;font-weight:bold;">\u26A0\uFE0F \u914D\u989D\u67E5\u8BE2\u53D7\u9650</span>';
          }
          return `
            <div class="acc-item ${acc.enabled === false ? 'disabled' : ''}">
              <div style="flex:1; min-width:200px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                  <span class="${acc.mode === 'antigravity' ? 'tag-ag' : 'tag-ca'}">${acc.mode === 'antigravity' ? 'Antigravity' : 'CodeAssist'}</span>
                  <span style="font-weight:bold; font-size:14px; color:#212529;">${escapeHtml(acc.email || 'Google \u8D26\u53F7')}</span>
                  ${acc.name ? `<span style="font-size:12px; color:#6c757d;">(${escapeHtml(acc.name)})</span>` : ''}
                </div>
                <div style="font-size:12px; color:#6c757d;">
                  \u72B6\u6001: ${statusBadge}
                  ${acc.last_used_at ? ` \u00B7 \u6700\u8FD1\u4F7F\u7528: ${new Date(acc.last_used_at * 1000).toLocaleTimeString()}` : ''}
                  ${acc.error_message ? ` \u00B7 <span style="color:#dc3545;">${escapeHtml(acc.error_message)}</span>` : ''}
                </div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="btn-sm" onclick="toggleAccount('${acc.id}', ${acc.enabled === false})" style="background:${acc.enabled !== false ? '#6c757d' : '#28a745'};">${acc.enabled !== false ? '\u7981\u7528' : '\u542F\u7528'}</button>
                ${isCooling ? `<button class="btn-sm" onclick="resetAccountCooldown('${acc.id}')" style="background:#fd7e14;">\u89E3\u9664\u51B7\u5374</button>` : ''}
                <button class="btn-sm" onclick="deleteAccount('${acc.id}')" style="background:#dc3545;">\u5220\u9664</button>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>

    <div class="card">
      <h3 style="color:#28a745;">Antigravity \u6A21\u5F0F\u914D\u989D\u67E5\u770B</h3>
      <p style="font-size:12px;color:#666;">\u4EFF\u7167 Antigravity-Manager \u5B9E\u73B0\uFF0C\u5C55\u793A\u5F53\u524D\u7ED1\u5B9A\u8D26\u53F7\u7684\u6A21\u578B\u914D\u989D\u4E0E\u5206\u7EC4\u914D\u989D\uFF085 \u5C0F\u65F6 / \u6BCF\u5468\u7A97\u53E3\uFF09\u3002\u6570\u636E\u5728\u670D\u52A1\u7AEF\u7F13\u5B58 60 \u79D2\uFF0C\u70B9\u51FB\u300C\u5237\u65B0\u914D\u989D\u300D\u5F3A\u5236\u62C9\u53D6\u6700\u65B0\u6570\u636E\u3002</p>
      ${accounts.filter((a) => a.mode === "antigravity").length > 1 ? `
      <div style="margin-bottom:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <span style="font-size:13px; font-weight:bold;">\u67E5\u770B\u89C6\u89D2\uFF1A</span>
        <select id="ag-account-select" onchange="loadAntigravityQuota(false)" style="padding:6px 10px; border-radius:4px; border:1px solid #ced4da; font-size:13px; flex:1; min-width:220px;">
          <option value="">\u5168\u90E8\u8D26\u53F7\u805A\u5408\u914D\u989D\u6C60\uFF08\u667A\u80FD\u8C03\u5EA6\u6700\u9AD8\u53EF\u7528\u89C6\u89D2\uFF09</option>
          ${accounts.filter((a) => a.mode === "antigravity").map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.email || a.id)} ${a.name ? '(' + escapeHtml(a.name) + ')' : ''} ${a.enabled === false ? '[\u5DF2\u7981\u7528]' : ''}</option>`).join("")}
        </select>
      </div>` : ''}
      <div id="ag-quota-status" style="margin-bottom:10px;font-size:13px;">${accounts.some((a) => a.mode === "antigravity") ? '\u5C1A\u672A\u52A0\u8F7D' : '<span style="color:red;">\u26A0\uFE0F \u672A\u7ED1\u5B9A Antigravity \u8D26\u53F7\uFF0C\u8BF7\u5148\u5728\u7B2C\u4E8C\u90E8\u5206\u5B8C\u6210\u6388\u6743</span>'}</div>
      <div style="display:flex; gap:8px;">
        <button id="ag-quota-refresh-btn" onclick="loadAntigravityQuota(true)" ${accounts.some((a) => a.mode === "antigravity") ? '' : 'disabled'} style="width:auto;background:#28a745;">\u5237\u65B0\u914D\u989D</button>
      </div>
      <div id="ag-quota-content" style="margin-top:15px;"></div>
    </div>

    <div class="card">
      <h3>\u7B2C\u4E09\u90E8\u5206\uFF1AAPI \u7AEF\u70B9\u4E0E\u6A21\u5F0F\u8BBE\u7F6E</h3>
      <form action="/api/user/update" method="POST">
        <input type="hidden" name="action" value="api_config">
        
        <label>\u60A8\u7684\u4E13\u5C5E\u7AEF\u70B9\u8DEF\u5F84 (\u81EA\u5B9A\u4E49):</label>
        <input type="text" name="custom_path" value="${safeCustomPath}" required>
        
        <label>API \u5BC6\u94A5 (API Key):</label>
        <input type="text" name="api_key" value="${safeApiKey}" required>
        
        <label>CodeAssist \u6A21\u5F0F\u5339\u914D\u6A21\u578B\u540D:</label>
        <input type="text" name="codeassist_pattern" value="${safeCodeassistPattern}" placeholder="{modelname}" required>
        
        <label>Antigravity \u6A21\u5F0F\u5339\u914D\u6A21\u578B\u540D:</label>
        <input type="text" name="antigravity_pattern" value="${safeAntigravityPattern}" placeholder="{modelname}-agy" required>
        
        <button type="submit" style="margin-top:15px;">\u4FDD\u5B58\u914D\u7F6E</button>
      </form>
      <div style="background:#f4f4f4;padding:10px;margin-top:10px;font-size:13px;word-break:break-all;">
        <b>\u8C03\u7528\u8BF4\u660E:</b><br>
        OpenAI Chat\u683C\u5F0F: <code>https://${escapeHtml(new URL(request.url).host)}/${safeCustomPath}/v1/chat/completions</code><br>
        OpenAI Responses \u683C\u5F0F: <code>https://${escapeHtml(new URL(request.url).host)}/${safeCustomPath}/v1/responses</code><br>
        \u6A21\u578B\u5217\u8868: <code>https://${escapeHtml(new URL(request.url).host)}/${safeCustomPath}/v1/models</code> (GET)<br>
        Claude \u683C\u5F0F: <code>https://${escapeHtml(new URL(request.url).host)}/${safeCustomPath}/v1/messages</code><br>
        Gemini \u683C\u5F0F: <code>https://${escapeHtml(new URL(request.url).host)}/${safeCustomPath}/v1beta/models/{modelname}:generateContent</code><br>
        Auth Header: <code>Authorization: Bearer ${safeApiKey}</code>
      </div>
    </div>

    <div class="card">
      <h3>\u7B2C\u56DB\u90E8\u5206\uFF1A\u4E34\u65F6\u804A\u5929\u6D4B\u8BD5</h3>
      <p style="font-size:12px;color:#666;margin-bottom:15px;">\u60A8\u53EF\u4EE5\u5728\u6B64\u8FDB\u884C\u4E34\u65F6\u7684\u591A\u8F6E\u804A\u5929\u6D4B\u8BD5\u3002\u5BF9\u8BDD\u5386\u53F2\u548C\u9009\u62E9\u7684\u6A21\u578B\u4F1A\u6253\u5305\u76F4\u63A5\u8BF7\u6C42\u60A8\u7684\u4E13\u5C5E\u7AEF\u70B9\uFF0C\u5386\u53F2\u4EC5\u4FDD\u5B58\u5728\u6D4F\u89C8\u5668\u5185\u5B58\u4E2D\uFF0C\u4E0D\u4F1A\u5728\u670D\u52A1\u5668\u7AEF\u6301\u4E45\u4FDD\u5B58\u3002</p>
      
      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;">
        <span style="font-weight: bold; font-size: 14px; color: #495057;">\u6D4B\u8BD5\u6A21\u578B\u540D\u79F0:</span>
        <input type="text" id="chat-model-input" value="gemini-2.5-flash-agy" style="padding: 8px; border: 1px solid #ced4da; border-radius: 4px; flex: 1; min-width: 200px;" placeholder="\u8F93\u5165\u6A21\u578B\u540D\u79F0" />
      </div>

      <div style="border: 1px solid #dee2e6; border-radius: 8px; background: #ffffff; display: flex; flex-direction: column; height: 380px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
        <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid #dee2e6;">
        </div>
        <div style="display: flex; padding: 10px; gap: 8px; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;">
          <input type="text" id="chat-input" placeholder="\u8F93\u5165\u6D4B\u8BD5\u6D88\u606F\uFF0C\u6309 Enter \u53D1\u9001..." onkeydown="if(event.key==='Enter') sendChatMessage()" style="flex: 1; margin: 0; padding: 10px; border: 1px solid #ced4da; border-radius: 4px; background: #fff; font-size: 14px;" />
          <button id="chat-send-btn" onclick="sendChatMessage()" style="width: auto; margin: 0; padding: 10px 20px; background: #007bff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">\u53D1\u9001</button>
          <button onclick="clearChatHistory()" style="width: auto; margin: 0; padding: 10px 15px; background: #6c757d; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">\u6E05\u7A7A</button>
        </div>
      </div>
    </div>

    <script>
      let chatHistory = [];

      function clearChatHistory() {
        chatHistory = [];
        const messagesDiv = document.getElementById("chat-messages");
        messagesDiv.innerHTML = '';
      }

      async function sendChatMessage() {
        const inputEl = document.getElementById("chat-input");
        const sendBtn = document.getElementById("chat-send-btn");
        const messagesDiv = document.getElementById("chat-messages");
        const modelInput = document.getElementById("chat-model-input");

        const text = inputEl.value.trim();
        if (!text) return;

        const model = modelInput.value.trim();
        if (!model) {
          alert("\u8BF7\u8F93\u5165\u6D4B\u8BD5\u6A21\u578B\u540D\u79F0");
          return;
        }

        // 1. \u6DFB\u52A0\u7528\u6237\u6D88\u606F\u5230 UI
        const userMsgDiv = document.createElement("div");
        userMsgDiv.style.alignSelf = "flex-end";
        userMsgDiv.style.background = "#007bff";
        userMsgDiv.style.color = "#ffffff";
        userMsgDiv.style.maxWidth = "85%";
        userMsgDiv.style.padding = "10px 14px";
        userMsgDiv.style.borderRadius = "12px 12px 2px 12px";
        userMsgDiv.style.fontSize = "14px";
        userMsgDiv.style.lineHeight = "1.5";
        userMsgDiv.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
        userMsgDiv.style.whiteSpace = "pre-wrap";
        userMsgDiv.textContent = text;
        messagesDiv.appendChild(userMsgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // \u7981\u7528\u8F93\u5165
        inputEl.value = "";
        inputEl.disabled = true;
        sendBtn.disabled = true;

        // 2. \u5C06\u6D88\u606F\u63A8\u5165\u5386\u53F2
        chatHistory.push({ role: "user", content: text });

        // 3. \u521B\u5EFA\u52A9\u624B\u601D\u8003\u72B6\u6001\u5360\u4F4D
        const assistantMsgDiv = document.createElement("div");
        assistantMsgDiv.style.alignSelf = "flex-start";
        assistantMsgDiv.style.background = "#e9ecef";
        assistantMsgDiv.style.color = "#495057";
        assistantMsgDiv.style.maxWidth = "85%";
        assistantMsgDiv.style.padding = "10px 14px";
        assistantMsgDiv.style.borderRadius = "12px 12px 12px 2px";
        assistantMsgDiv.style.fontSize = "14px";
        assistantMsgDiv.style.lineHeight = "1.5";
        assistantMsgDiv.style.fontStyle = "italic";
        assistantMsgDiv.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
        assistantMsgDiv.textContent = "\u601D\u8003\u4E2D\uFF0C\u8BF7\u7A0D\u5019...";
        messagesDiv.appendChild(assistantMsgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        try {
          const customPath = "${user.api_config.custom_path}";
          const apiKey = "${user.api_config.api_key}";
          
          const response = await fetch("/" + customPath + "/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + apiKey
            },
            body: JSON.stringify({
              model: model,
              messages: chatHistory
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            let parsedErr;
            try { parsedErr = JSON.parse(errText); } catch(e) {}
            
            let errMsg = "";
            if (parsedErr) {
              if (parsedErr.error) {
                if (typeof parsedErr.error === "object") {
                  errMsg = parsedErr.error.message || JSON.stringify(parsedErr.error);
                } else {
                  errMsg = parsedErr.error;
                }
              } else if (parsedErr.message) {
                errMsg = parsedErr.message;
              }
            }
            if (!errMsg) {
              errMsg = errText || ("HTTP " + response.status);
            }
            
            const customErr = new Error(errMsg);
            customErr.raw = errText || ("HTTP " + response.status);
            throw customErr;
          }

          const data = await response.json();
          const reply = data.choices?.[0]?.message?.content || "";
          
          assistantMsgDiv.style.fontStyle = "normal";
          assistantMsgDiv.style.color = "#212529";
          assistantMsgDiv.style.whiteSpace = "pre-wrap";
          assistantMsgDiv.textContent = reply;
          
          chatHistory.push({ role: "assistant", content: reply });
        } catch (err) {
          console.error(err);
          assistantMsgDiv.style.fontStyle = "normal";
          assistantMsgDiv.style.background = "#f8d7da";
          assistantMsgDiv.style.color = "#721c24";
          assistantMsgDiv.style.border = "1px solid #f5c6cb";
          
          assistantMsgDiv.innerHTML = 
            '<div style="font-weight: bold; margin-bottom: 4px;">\u26A0\uFE0F \u51FA\u9519\u4E86: <span class="err-summary"></span></div>' +
            '<div class="toggle-link" style="font-size: 11px; color: #856404; text-decoration: underline; margin-top: 4px; cursor: pointer; user-select: none; display: inline-block;">\u70B9\u51FB\u5C55\u5F00/\u6298\u53E0\u5B8C\u6574\u539F\u59CB\u54CD\u5E94 (JSON)</div>' +
            '<pre class="err-details" style="display: none; font-family: monospace; font-size: 11px; margin-top: 8px; padding: 6px; background: rgba(0,0,0,0.03); border-radius: 4px; border-top: 1px dashed #f5c6cb; white-space: pre-wrap; word-break: break-all; text-align: left; cursor: text;"></pre>';
          
          assistantMsgDiv.querySelector(".err-summary").textContent = err.message;
          assistantMsgDiv.querySelector(".err-details").textContent = err.raw || err.stack || String(err);
          
          assistantMsgDiv.querySelector(".toggle-link").onclick = function(e) {
            e.stopPropagation();
            const details = assistantMsgDiv.querySelector(".err-details");
            details.style.display = details.style.display === "none" ? "block" : "none";
          };
        } finally {
          inputEl.disabled = false;
          sendBtn.disabled = false;
          inputEl.focus();
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
      }

      async function toggleAccount(id, toEnable) {
        try {
          const res = await fetch("/api/user/account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggle", id, enabled: toEnable })
          });
          const d = await res.json();
          if (d.success) window.location.reload();
          else alert("\u64CD\u4F5C\u5931\u8D25: " + (d.error || "\u672A\u77E5\u9519\u8BEF"));
        } catch (e) {
          alert("\u8BF7\u6C42\u5931\u8D25: " + e.message);
        }
      }

      async function resetAccountCooldown(id) {
        try {
          const res = await fetch("/api/user/account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reset_cooldown", id })
          });
          const d = await res.json();
          if (d.success) window.location.reload();
          else alert("\u64CD\u4F5C\u5931\u8D25: " + (d.error || "\u672A\u77E5\u9519\u8BEF"));
        } catch (e) {
          alert("\u8BF7\u6C42\u5931\u8D25: " + e.message);
        }
      }

      async function deleteAccount(id) {
        if (!confirm("\u786E\u5B9A\u8981\u5220\u9664\u6B64 Google \u8D26\u53F7\u5417\uFF1F\u5220\u9664\u540E\u8BE5\u8D26\u53F7\u5C06\u4E0D\u518D\u53C2\u4E0E\u914D\u989D\u8C03\u5EA6\u3002")) return;
        try {
          const res = await fetch("/api/user/account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", id })
          });
          const d = await res.json();
          if (d.success) window.location.reload();
          else alert("\u5220\u9664\u5931\u8D25: " + (d.error || "\u672A\u77E5\u9519\u8BEF"));
        } catch (e) {
          alert("\u8BF7\u6C42\u5931\u8D25: " + e.message);
        }
      }

      let agQuotaHasAntigravity = ${accounts.some((a) => a.mode === "antigravity") ? "true" : "false"};

      function agEscHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
      }

      function agFmtReset(t) {
        if (!t) return "N/A";
        var target = new Date(t);
        if (isNaN(target.getTime())) return "N/A";
        var diff = target.getTime() - Date.now();
        if (diff <= 0) return "\u5373\u5C06\u91CD\u7F6E";
        var h = Math.floor(diff / 3600000);
        var m = Math.floor((diff % 3600000) / 60000);
        if (h >= 24) return Math.floor(h / 24) + "d " + (h % 24) + "h";
        return h + "h " + m + "m";
      }

      function agBarColor(p) {
        if (p >= 50) return "#28a745";
        if (p >= 20) return "#fd7e14";
        return "#dc3545";
      }

      function agBadgeStyle(p) {
        if (p >= 50) return "background:#d4edda;color:#155724;";
        if (p >= 20) return "background:#fff3cd;color:#856404;";
        return "background:#f8d7da;color:#721c24;";
      }

      function agProgress(p) {
        var pc = Math.max(0, Math.min(100, Math.round(p || 0)));
        return '<div style="height:8px;background:#e9ecef;border-radius:4px;margin-top:4px;overflow:hidden;">' +
          '<div style="height:100%;width:' + pc + '%;background:' + agBarColor(pc) + ';border-radius:4px;transition:width .5s;"></div></div>';
      }

      function agPctBadge(p) {
        var pc = Math.max(0, Math.min(100, Math.round(p || 0)));
        return '<span style="font-size:12px;font-weight:bold;padding:2px 8px;border-radius:4px;' + agBadgeStyle(pc) + '">' + pc + '%</span>';
      }

      async function loadAntigravityQuota(force) {
        var statusEl = document.getElementById("ag-quota-status");
        var contentEl = document.getElementById("ag-quota-content");
        var btn = document.getElementById("ag-quota-refresh-btn");
        var selEl = document.getElementById("ag-account-select");
        var targetAccId = selEl ? selEl.value : "";
        if (btn) { btn.disabled = true; btn.textContent = "\u5237\u65B0\u4E2D..."; }
        statusEl.innerHTML = "\u6B63\u5728\u83B7\u53D6\u914D\u989D...";
        try {
          var qParams = [];
          if (force) qParams.push("refresh=1");
          if (targetAccId) qParams.push("account_id=" + encodeURIComponent(targetAccId));
          var res = await fetch("/api/antigravity/quota" + (qParams.length > 0 ? "?" + qParams.join("&") : ""));
          var data;
          try { data = await res.json(); } catch (e) { data = {}; }
          if (!res.ok) {
            statusEl.innerHTML = '<span style="color:red;">\u2716 ' + agEscHtml(data.error || ("HTTP " + res.status)) + '</span>';
            return;
          }
          statusEl.innerHTML = "\u2705 \u66F4\u65B0\u4E8E " + new Date((data.last_updated || 0) * 1000).toLocaleTimeString();
          if (data.is_forbidden) {
            contentEl.innerHTML = '<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:6px;">' + agEscHtml(data.forbidden_reason || "\u8BE5\u8D26\u53F7\u5DF2\u88AB\u4E0A\u6E38\u7981\u6B62\u8BBF\u95EE\u914D\u989D\u63A5\u53E3 (403 Forbidden)") + '</div>';
            return;
          }
          var html = "";
          if (data.accounts && data.accounts.length > 0) {
            html += '<div style="margin-bottom:12px;padding:10px;background:#e8f4fd;border:1px solid #bee5eb;border-radius:6px;font-size:12px;">';
            html += '<b>\uD83D\uDCCA \u5F53\u524D\u914D\u989D\u6C60\u8D26\u53F7\u72B6\u6001 (' + data.accounts.length + ' \u4E2A):</b><div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">';
            for (var aIdx = 0; aIdx < data.accounts.length; aIdx++) {
              var accInfo = data.accounts[aIdx];
              var accStatusText = accInfo.enabled ? '<span style="color:#28a745;">\u2705 \u542F\u7528</span>' : '<span style="color:#6c757d;">\u26AA \u7981\u7528</span>';
              if (accInfo.status === "cooldown") accStatusText = '<span style="color:#fd7e14;">\u23F3 \u51B7\u5374\u4E2D</span>';
              if (accInfo.status === "error") accStatusText = '<span style="color:#dc3545;">\u274C \u5F02\u5E38</span>';
              if (accInfo.status === "quota_unavailable") accStatusText = '<span style="color:#fd7e14;">\u26A0\uFE0F \u914D\u989D\u67E5\u8BE2\u53D7\u9650</span>';
              html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
              html += '<span>\u00B7 ' + agEscHtml(accInfo.email || accInfo.id) + (accInfo.name ? ' (' + agEscHtml(accInfo.name) + ')' : '') + '</span>';
              html += '<span>' + accStatusText + '</span>';
              html += '</div>';
            }
            html += '</div></div>';
          }
          if (data.subscription_tier) {
            html += '<div style="margin-bottom:8px;font-size:13px;"><b>\u8BA2\u9605\u7B49\u7EA7:</b> <span style="background:#e2e3f0;color:#383d73;padding:2px 8px;border-radius:4px;font-weight:bold;">' + agEscHtml(data.subscription_tier) + '</span></div>';
          }
          if (!targetAccId && data.accounts && data.accounts.length > 1) {
            html += '<div style="font-size:12px;color:#28a745;font-weight:bold;margin-bottom:8px;">\u2728 \u4E0B\u65B9\u4E3A\u591A\u8D26\u53F7\u805A\u5408\u6700\u9AD8\u53EF\u7528\u914D\u989D\uFF0C\u8C03\u7528\u65F6\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u4F18\u5148\u8DEF\u7531\u5230\u914D\u989D\u6700\u9AD8\u7684\u8D26\u53F7</div>';
          }
          function agQuotaWindowInfo(bucket) {
            var raw = String(bucket.window || bucket.bucket_id || bucket.display_name || "").toUpperCase();
            if (raw.indexOf("WEEK") !== -1) return { key: "weekly", label: "\u5468\u914D\u989D" };
            if (raw.indexOf("FIVE") !== -1 || raw.indexOf("HOUR") !== -1 || raw.indexOf("5") !== -1) {
              return { key: "five-hour", label: "\u4E94\u5C0F\u65F6\u914D\u989D" };
            }
            return { key: "other", label: bucket.display_name || bucket.window || bucket.bucket_id || "\u5176\u4ED6\u914D\u989D" };
          }
          function agQuotaResetMatches(left, right) {
            if (!left || !right) return false;
            var leftMs = Date.parse(left);
            var rightMs = Date.parse(right);
            if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return Math.abs(leftMs - rightMs) <= 60000;
            return String(left) === String(right);
          }
          function agInferModelQuotaWindow(model, quotaGroups) {
            var modelPercent = Number.isFinite(model.percentage) ? model.percentage : null;
            var best = null;
            for (var groupIndex = 0; groupIndex < (quotaGroups || []).length; groupIndex++) {
              var groupBuckets = quotaGroups[groupIndex].buckets || [];
              for (var bucketIndex = 0; bucketIndex < groupBuckets.length; bucketIndex++) {
                var bucket = groupBuckets[bucketIndex];
                var windowInfo = agQuotaWindowInfo(bucket);
                if (windowInfo.key === "other") continue;
                var resetMatches = agQuotaResetMatches(model.reset_time, bucket.reset_time);
                var percentMatches = modelPercent !== null &&
                  Math.round((bucket.remaining_fraction || 0) * 100) === modelPercent;
                if (resetMatches || percentMatches) {
                  var score = (resetMatches ? 2 : 0) + (percentMatches ? 1 : 0);
                  if (!best || score > best.score) best = { key: windowInfo.key, label: windowInfo.key === "weekly" ? "\u5468\u7A97\u53E3" : "\u4E94\u5C0F\u65F6\u7A97\u53E3", score: score };
                }
              }
            }
            return best || { key: "unknown", label: "\u7A97\u53E3\u672A\u6807\u6CE8" };
          }
          var groups = data.quota_groups || [];
          var models = data.models || [];
          if (models.length === 0) {
            html += '<div style="font-weight:bold;margin:14px 0 6px;font-size:14px;">\u6A21\u578B\u7EA7\u914D\u989D</div>';
            html += '<div style="color:#888;font-size:13px;">' + agEscHtml("\u672A\u83B7\u53D6\u5230\u6A21\u578B\u914D\u989D\u6570\u636E\uFF08\u4E0A\u6E38\u53EF\u80FD\u8FD4\u56DE\u4E3A\u7A7A\uFF09\u3002") + '</div>';
          } else {
            html += '<div style="margin:14px 0 6px;">' +
              '<div style="font-weight:bold;font-size:14px;">\u6A21\u578B\u7EA7\u914D\u989D (' + models.length + ')</div>' +
              '<div style="font-size:11px;color:#6c757d;margin-top:2px;">\u6BCF\u4E2A\u6A21\u578B\u7684\u767E\u5206\u6BD4\u90FD\u4F1A\u660E\u786E\u6807\u6CE8\u5BF9\u5E94\u7684\u4E94\u5C0F\u65F6\u6216\u5468\u7A97\u53E3\uFF1B\u65E0\u6CD5\u4ECE\u4E0A\u6E38\u6570\u636E\u786E\u8BA4\u65F6\u4F1A\u663E\u793A\u201C\u7A97\u53E3\u672A\u6807\u6CE8\u201D\uFF0C\u4E0D\u4F1A\u8BEF\u5BFC\u4E3A\u4E94\u5C0F\u65F6\u6216\u5468\u914D\u989D\u3002</div>' +
            '</div>';
            for (var i = 0; i < models.length; i++) {
              var m = models[i];
              var p = Math.max(0, Math.min(100, Math.round(m.percentage || 0)));
              var label = m.display_name || m.name;
              var inferredWindow = agInferModelQuotaWindow(m, groups);
              var modelWindowKey = m.quota_window || inferredWindow.key;
              var modelWindowLabel = m.quota_window_label || (modelWindowKey === "weekly" ? "\u5468\u7A97\u53E3" : (modelWindowKey === "five-hour" ? "\u4E94\u5C0F\u65F6\u7A97\u53E3" : inferredWindow.label));
              var modelWindowColor = modelWindowKey === "weekly" ? "#6f42c1" : (modelWindowKey === "five-hour" ? "#fd7e14" : "#6c757d");
              html +=
                '<div style="border:1px solid #e9ecef;border-radius:6px;padding:8px;margin-top:8px;background:#fff;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;">' +
                    '<span style="font-family:monospace;word-break:break-all;">' + agEscHtml(label) +
                      (m.thinking_budget_auto ? ' <span style="font-size:10px;color:#6c757d;">(\u81EA\u52A8\u601D\u8003\u9884\u7B97)</span>' : (m.thinking_budget > 0 ? ' <span style="font-size:10px;color:#6c757d;">(\u601D\u8003\u9884\u7B97 ' + agEscHtml(m.thinking_budget) + ')</span>' : '')) +
                    '</span>' +
                    '<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">' +
                      '<span style="font-size:10px;font-weight:bold;padding:2px 6px;border-radius:4px;background:' + modelWindowColor + ';color:#fff;">' + agEscHtml(modelWindowLabel) + '</span>' +
                      agPctBadge(p) +
                    '</span>' +
                  '</div>' + agProgress(p) +
                  '<div style="font-size:11px;color:#6c757d;margin-top:4px;word-break:break-all;">\u6A21\u578B\u914D\u989D\uFF1A' + agEscHtml(modelWindowLabel) + ' \u00B7 \u91CD\u7F6E\uFF1A' + agEscHtml(agFmtReset(m.reset_time)) + ' \u00B7 ' + agEscHtml(m.name) + '</div>' +
                '</div>';
            }
          }
          if (groups.length > 0) {
            html += '<div style="margin:20px 0 6px;padding-top:12px;border-top:2px solid #dee2e6;">' +
              '<div style="font-weight:bold;font-size:14px;">\u5206\u7EC4\u914D\u989D\uFF08\u5171\u4EAB\u914D\u989D\u6C60\uFF09</div>' +
              '<div style="font-size:11px;color:#6c757d;margin-top:2px;">\u4EE5\u4E0B\u4E3A\u540C\u4E00\u5206\u7EC4\u5185\u6A21\u578B\u5171\u4EAB\u7684\u7A97\u53E3\u914D\u989D\uFF0C\u4E94\u5C0F\u65F6\u914D\u989D\u4E0E\u5468\u914D\u989D\u4F1A\u5206\u522B\u5217\u51FA\u3002</div>' +
            '</div>';
            for (var g = 0; g < groups.length; g++) {
              var grp = groups[g];
              html += '<div style="border:1px solid #b8daff;background:#e9f2ff;border-radius:8px;padding:10px;margin-top:8px;">';
              html += '<div style="font-weight:bold;font-size:13px;color:#004085;">' + agEscHtml(grp.display_name) + '</div>';
              if (grp.description) html += '<div style="font-size:11px;color:#6c757d;">' + agEscHtml(grp.description) + '</div>';
              var buckets = (grp.buckets || []).slice().sort(function(a, b) {
                var aInfo = agQuotaWindowInfo(a);
                var bInfo = agQuotaWindowInfo(b);
                var rank = { "five-hour": 0, weekly: 1, other: 2 };
                return (rank[aInfo.key] ?? 2) - (rank[bInfo.key] ?? 2);
              });
              html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px;">';
              for (var b = 0; b < buckets.length; b++) {
                var bk = buckets[b];
                var bp = Math.max(0, Math.min(100, Math.round((bk.remaining_fraction || 0) * 100)));
                var windowInfo = agQuotaWindowInfo(bk);
                html +=
                  '<div style="background:#fff;border:1px solid #cfe2ff;border-radius:6px;padding:8px;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">' +
                      '<span style="font-weight:bold;">' + agEscHtml(windowInfo.label) + '</span>' + agPctBadge(bp) +
                    '</div>' + agProgress(bp) +
                    '<div style="font-size:11px;color:#6c757d;margin-top:4px;">\u91CD\u7F6E: ' + agEscHtml(agFmtReset(bk.reset_time)) + '</div>' +
                  '</div>';
              }
              html += '</div>';
              html += '</div>';
            }
          }
          contentEl.innerHTML = html || '<div style="color:#888;">\u65E0\u914D\u989D\u6570\u636E\u3002</div>';
        } catch (e) {
          statusEl.innerHTML = '<span style="color:red;">\u2716 \u8BF7\u6C42\u5931\u8D25: ' + agEscHtml(e.message || String(e)) + '</span>';
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "\u5237\u65B0\u914D\u989D"; }
        }
      }

      if (agQuotaHasAntigravity) {
        loadAntigravityQuota(false);
      }
    <\/script>

	<p>\u6CE8\u610F\uFF1AGeminiCodeAssist\u4E2A\u4EBA\u7248\u5C06\u4E8E2026\u5E746\u670818\u65E5\u505C\u6B62\u670D\u52A1\uFF0C\u5C4A\u65F6CodeAssist\u6A21\u5F0F\u8C03\u7528\u53EF\u80FD\u5C06\u65E0\u6CD5\u4F7F\u7528\uFF0C\u4E14\u6CE8\u610FCodeAssist\u8C03\u7528\u7684\u6BCF\u5206\u949F\u901F\u7387\u9650\u5236\u8F83\u4E3A\u4E25\u683C\u3002<br>
	\u4EE5Antigravity\u6A21\u5F0F\u8C03\u7528API\u65F6\uFF0C\u914D\u989D\u548C\u901F\u7387\u9650\u5236\u8F83\u4E3A\u5BBD\u677E\uFF0C\u4F46\u4E0D\u652F\u6301\u6D41\u5F0F\u4F20\u8F93\uFF08\u82E5\u8BBE\u7F6E\u6D41\u5F0F\u4F20\u8F93\uFF0C\u672C\u670D\u52A1\u7AEF\u4F1A\u81EA\u52A8\u8986\u76D6\u4E3A\u975E\u6D41\u5F0F\uFF09\u3002<br>
	\u4F7F\u7528\u672C\u7AD9\u5373\u4EE3\u8868\u60A8\u5DF2\u77E5\u6089\u5E76\u81EA\u884C\u627F\u62C5\u53CD\u4EE3\u670D\u52A1\u7684\u98CE\u9669\u3002</p>
    </body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}
__name(handleDashboard, "handleDashboard");
__name2(handleDashboard, "handleDashboard");
async function handleUserUpdate(request, env) {
  const username = await getSessionUser(request, env);
  if (!username) return new Response("Unauthorized", { status: 401 });
  const formData = await request.formData();
  let user = await env.GEMINI_KV.get(`user:${username}`, "json");
  if (formData.get("action") === "password") {
    user.password_hash = await sha256(formData.get("new_password"));
  } else if (formData.get("action") === "api_config") {
    const oldPath = user.api_config.custom_path;
    const newPath = formData.get("custom_path").replace(/[^a-zA-Z0-9_-]/g, "");
    const codeassistPattern = formData.get("codeassist_pattern").trim();
    const antigravityPattern = formData.get("antigravity_pattern").trim();
    if (codeassistPattern === antigravityPattern) {
      return new Response("\u914D\u7F6E\u9519\u8BEF\uFF1ACodeAssist \u6A21\u5F0F\u4E0E Antigravity \u6A21\u5F0F\u7684\u5339\u914D\u89C4\u5219\u4E0D\u80FD\u76F8\u540C\uFF01", { status: 400 });
    }
    const newApiKey = formData.get("api_key").trim();
    const pathOwner = await env.GEMINI_KV.get(`path:${newPath}`);
    if (pathOwner && pathOwner !== username) {
      return new Response("\u914D\u7F6E\u9519\u8BEF\uFF1A\u8BE5\u4E13\u5C5E\u8DEF\u5F84\u5DF2\u88AB\u5176\u4ED6\u7528\u6237\u5360\u7528\uFF01", { status: 400 });
    }
    const keyOwner = await env.GEMINI_KV.get(`key:${newApiKey}`);
    if (keyOwner && keyOwner !== username) {
      return new Response("\u914D\u7F6E\u9519\u8BEF\uFF1A\u8BE5 API \u5BC6\u94A5\u5DF2\u88AB\u5176\u4ED6\u7528\u6237\u5360\u7528\uFF01", { status: 400 });
    }
    await env.GEMINI_KV.delete(`path:${oldPath}`);
    if (user.api_config.api_key) {
      await env.GEMINI_KV.delete(`key:${user.api_config.api_key}`);
    }
    user.api_config.custom_path = newPath;
    user.api_config.api_key = newApiKey;
    user.api_config.codeassist_pattern = codeassistPattern;
    user.api_config.antigravity_pattern = antigravityPattern;
    await env.GEMINI_KV.put(`path:${newPath}`, username);
    await env.GEMINI_KV.put(`key:${user.api_config.api_key}`, username);
  }
  await env.GEMINI_KV.put(`user:${username}`, JSON.stringify(user));
  return Response.redirect(`${new URL(request.url).origin}/dashboard`, 302);
}
__name(handleUserUpdate, "handleUserUpdate");
__name2(handleUserUpdate, "handleUserUpdate");

function getUserAccounts(user) {
  if (!user) return [];
  if (!Array.isArray(user.accounts)) {
    user.accounts = [];
  }
  if (user.google_tokens && user.google_tokens.refresh_token) {
    const exists = user.accounts.some((a) => a.mode === "codeassist");
    if (!exists) {
      user.accounts.push({
        id: "acc_ca_legacy",
        email: "CodeAssist \u8D26\u53F7 (\u9ED8\u8BA4)",
        name: "CodeAssist",
        mode: "codeassist",
        tokens: { ...user.google_tokens },
        enabled: true,
        created_at: Math.floor(Date.now() / 1e3),
        last_used_at: 0,
        status: "active",
        cooldown_until: 0,
        error_message: null
      });
    }
  }
  if (user.antigravity_tokens && user.antigravity_tokens.refresh_token) {
    const exists = user.accounts.some((a) => a.mode === "antigravity");
    if (!exists) {
      user.accounts.push({
        id: "acc_ag_legacy",
        email: "Antigravity \u8D26\u53F7 (\u9ED8\u8BA4)",
        name: "Antigravity",
        mode: "antigravity",
        tokens: { ...user.antigravity_tokens },
        enabled: true,
        created_at: Math.floor(Date.now() / 1e3),
        last_used_at: 0,
        status: "active",
        cooldown_until: 0,
        error_message: null
      });
    }
  }
  return user.accounts;
}
__name(getUserAccounts, "getUserAccounts");
__name2(getUserAccounts, "getUserAccounts");

// `last_used_at` only affects the LRU tie-breaker. Persisting it after every
// successful API request would write the same `user:${username}` KV key at
// request rate, while Workers KV allows only one write per second to a key.
// Keep hot-path usage locally in the isolate and only persist the user object
// when durable account state (tokens/status/cooldown/project) actually changes.
const accountUsageMemory = /* @__PURE__ */ new Map();
const quotaAggregationInFlight = /* @__PURE__ */ new Map();
function getAccountUsageKey(username, accountId) {
  return `${username}\0${accountId}`;
}
__name(getAccountUsageKey, "getAccountUsageKey");
__name2(getAccountUsageKey, "getAccountUsageKey");
function getEffectiveLastUsed(username, account) {
  return Math.max(
    account?.last_used_at || 0,
    accountUsageMemory.get(getAccountUsageKey(username, account?.id)) || 0
  );
}
__name(getEffectiveLastUsed, "getEffectiveLastUsed");
__name2(getEffectiveLastUsed, "getEffectiveLastUsed");
function recordAccountUsage(username, account, timestamp = Math.floor(Date.now() / 1e3)) {
  if (!username || !account?.id) return;
  accountUsageMemory.set(getAccountUsageKey(username, account.id), timestamp);
  // Bound isolate memory for installations with many users/accounts.
  if (accountUsageMemory.size > 2048) {
    const oldestKey = accountUsageMemory.keys().next().value;
    if (oldestKey !== void 0) accountUsageMemory.delete(oldestKey);
  }
}
__name(recordAccountUsage, "recordAccountUsage");
__name2(recordAccountUsage, "recordAccountUsage");

// A short 429 cooldown is runtime scheduling state, not durable account
// configuration. Persisting the whole user object for every failover can hit
// the KV daily write limit under concurrent traffic. Keep the cooldown in the
// isolate/Cache API instead; the legacy fields are still read so previously
// persisted cooldowns continue to work until they expire.
function getAccountCooldownCacheKey(username, accountId) {
  return `${username}\0${accountId}`;
}
__name(getAccountCooldownCacheKey, "getAccountCooldownCacheKey");
__name2(getAccountCooldownCacheKey, "getAccountCooldownCacheKey");
function rememberAccountCooldown(username, account, cooldownUntil, ctx) {
  if (!username || !account?.id || !Number.isFinite(cooldownUntil)) return;
  const ttlSeconds = Math.max(1, cooldownUntil - Math.floor(Date.now() / 1e3));
  putTransientJsonCache(
    "account-cooldown",
    getAccountCooldownCacheKey(username, account.id),
    { cooldown_until: cooldownUntil },
    ttlSeconds,
    ctx
  );
}
__name(rememberAccountCooldown, "rememberAccountCooldown");
__name2(rememberAccountCooldown, "rememberAccountCooldown");
function clearAccountCooldown(username, accountId, ctx) {
  const key = getAccountCooldownCacheKey(username, accountId);
  transientJsonCache.delete(transientCacheKey("account-cooldown", key));
  if (typeof caches === "undefined" || !caches.default) return;
  const promise = caches.default.delete(transientCacheRequest("account-cooldown", key)).catch(() => false);
  if (ctx?.waitUntil) ctx.waitUntil(promise);
}
__name(clearAccountCooldown, "clearAccountCooldown");
__name2(clearAccountCooldown, "clearAccountCooldown");
async function getAccountCooldownUntil(username, account, now = Math.floor(Date.now() / 1e3)) {
  const persistedUntil = Number(account?.cooldown_until) || 0;
  if (!username || !account?.id) return persistedUntil;
  const key = getAccountCooldownCacheKey(username, account.id);
  const memoryKey = transientCacheKey("account-cooldown", key);
  const memoryEntry = transientJsonCache.get(memoryKey);
  if (memoryEntry && memoryEntry.expiresAt <= Date.now()) {
    transientJsonCache.delete(memoryKey);
  }
  const cached = await getTransientJsonCache("account-cooldown", key, 300);
  const transientUntil = Number(cached?.cooldown_until) || 0;
  return Math.max(persistedUntil, transientUntil > now ? transientUntil : 0);
}
__name(getAccountCooldownUntil, "getAccountCooldownUntil");
__name2(getAccountCooldownUntil, "getAccountCooldownUntil");
async function getAccountCooldowns(accounts, username) {
  const cooldowns = /* @__PURE__ */ new Map();
  await Promise.all((accounts || []).map(async (account) => {
    if (!account?.id) return;
    const cooldownUntil = await getAccountCooldownUntil(username, account);
    if (cooldownUntil > 0) cooldowns.set(account.id, cooldownUntil);
  }));
  return cooldowns;
}
__name(getAccountCooldowns, "getAccountCooldowns");
__name2(getAccountCooldowns, "getAccountCooldowns");

async function saveUser(env, user, username) {
  if (!user || !username || !env?.GEMINI_KV) return;
  const accounts = Array.isArray(user.accounts) ? user.accounts : [];
  const activeAg = accounts.find((a) => a.mode === "antigravity" && a.enabled !== false && a.status !== "error");
  const fallbackAg = accounts.find((a) => a.mode === "antigravity");
  user.antigravity_tokens = activeAg?.tokens || fallbackAg?.tokens || null;

  const activeCa = accounts.find((a) => a.mode === "codeassist" && a.enabled !== false && a.status !== "error");
  const fallbackCa = accounts.find((a) => a.mode === "codeassist");
  user.google_tokens = activeCa?.tokens || fallbackCa?.tokens || null;

  await env.GEMINI_KV.put(`user:${username}`, JSON.stringify(user));
}
__name(saveUser, "saveUser");
__name2(saveUser, "saveUser");

async function refreshAccountToken(account, mode, env) {
  const tokens = account?.tokens;
  if (!tokens || !tokens.refresh_token) {
    return { ok: false, error: "Missing refresh token" };
  }
  const oauthConfig = getOauthConfig(mode, env);
  if (!hasOauthCredentials(oauthConfig)) {
    return { ok: false, error: `${mode} OAuth credentials are not configured` };
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: oauthConfig.client_id,
        client_secret: oauthConfig.client_secret
      })
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      return { ok: false, error: `HTTP ${tokenRes.status}: ${errText}` };
    }
    const td = await tokenRes.json();
    tokens.access_token = td.access_token;
    if (td.refresh_token) {
      tokens.refresh_token = td.refresh_token;
    }
    tokens.expires_at = Math.floor(Date.now() / 1e3) + (td.expires_in || 3600);
    account.tokens = tokens;
    return { ok: true, tokens };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
__name(refreshAccountToken, "refreshAccountToken");
__name2(refreshAccountToken, "refreshAccountToken");

async function ensureValidAccountToken(account, mode, env, user, username, ctx) {
  const tokens = account?.tokens;
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    return { ok: false, error: "No tokens present for account" };
  }
  const now = Math.floor(Date.now() / 1e3);
  if (!tokens.access_token || now + 60 >= (tokens.expires_at || 0)) {
    const refreshed = await refreshAccountToken(account, mode, env);
    if (!refreshed.ok) {
      account.status = "error";
      account.error_message = refreshed.error;
      return { ...refreshed, changed: true };
    }
    account.status = "active";
    account.error_message = null;
    return { ok: true, tokens: account.tokens, changed: true };
  }
  return { ok: true, tokens: account.tokens, changed: false };
}
__name(ensureValidAccountToken, "ensureValidAccountToken");
__name2(ensureValidAccountToken, "ensureValidAccountToken");

async function rankAccountsForRequest(accounts, resolvedModel, username, env) {
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  if (accounts.length === 1) return accounts.slice();
  const now = Math.floor(Date.now() / 1e3);
  const scored = [];
  const quotaByAccountId = /* @__PURE__ */ new Map();
  const cooldownByAccountId = await getAccountCooldowns(accounts, username);

  // Bulk KV reads turn N sequential quota lookups into one operation for up to
  // 100 accounts. If KV is temporarily unavailable, all quotas remain
  // "unknown" and the existing status/LRU rules still provide safe routing.
  const quotaAccounts = accounts.filter((acc) =>
    acc.mode === "antigravity" &&
    !(Math.max(Number(acc.cooldown_until) || 0, cooldownByAccountId.get(acc.id) || 0) > now) &&
    acc.status !== "error"
  );
  if (quotaAccounts.length > 0 && env?.GEMINI_KV) {
    try {
      for (let offset = 0; offset < quotaAccounts.length; offset += 100) {
        const chunk = quotaAccounts.slice(offset, offset + 100);
        const keys = chunk.map((acc) => `quota:${username}:${acc.id}`);
        const values = await env.GEMINI_KV.get(keys, "json");
        for (let i = 0; i < chunk.length; i++) {
          const value = values instanceof Map ? values.get(keys[i]) : null;
          if (value) quotaByAccountId.set(chunk[i].id, value);
        }
      }
    } catch (_) {}
  }

  for (const acc of accounts) {
    let score = 10000;
    const cooldownUntil = Math.max(Number(acc.cooldown_until) || 0, cooldownByAccountId.get(acc.id) || 0);
    const inCooldown = cooldownUntil > now;

    if (inCooldown) {
      score = -10000 - (cooldownUntil - now);
    } else if (acc.status === "error") {
      score = -20000;
    } else if (acc.mode === "antigravity") {
      const quotaData = quotaByAccountId.get(acc.id) || null;

      if (quotaData) {
        if (quotaData.is_forbidden) {
          score = -15000;
        } else {
          const pct = checkModelQuota(quotaData, resolvedModel);
          if (pct === 0) {
            score = 0;
          } else if (typeof pct === "number") {
            score = 10000 + pct * 100;
          }
        }
      }
    }

    const lastUsed = getEffectiveLastUsed(username, acc);
    scored.push({ account: acc, score, lastUsed });
  }

  // Quota/status is authoritative; exact LRU only breaks equal-score ties.
  scored.sort((a, b) => b.score - a.score || a.lastUsed - b.lastUsed);
  return scored.map((s) => s.account);
}
__name(rankAccountsForRequest, "rankAccountsForRequest");
__name2(rankAccountsForRequest, "rankAccountsForRequest");

async function handleAccountApi(request, env, ctx) {
  const username = await getSessionUser(request, env);
  if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
  let user = await env.GEMINI_KV.get(`user:${username}`, "json");
  if (!user) return jsonResponse({ error: "User not found" }, 404);
  const accounts = getUserAccounts(user);

  if (request.method === "GET") {
    const transientCooldownByAccountId = await getAccountCooldowns(accounts, username);
    return jsonResponse({
      success: true,
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        mode: a.mode,
        enabled: a.enabled !== false,
        status: (transientCooldownByAccountId.get(a.id) || 0) > Math.floor(Date.now() / 1e3) ? "cooldown" : (a.status || "active"),
        cooldown_until: Math.max(Number(a.cooldown_until) || 0, transientCooldownByAccountId.get(a.id) || 0),
        last_used_at: getEffectiveLastUsed(username, a),
        created_at: a.created_at || 0,
        error_message: a.error_message || null
      }))
    });
  }

  if (request.method === "POST") {
    let payload;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData.entries());
    }

    const { action, id } = payload;
    const targetAccount = accounts.find((a) => a.id === id);

    if (action === "delete") {
      if (!targetAccount) return jsonResponse({ error: "Account not found" }, 404);
      user.accounts = accounts.filter((a) => a.id !== id);
      ctx.waitUntil(env.GEMINI_KV.delete(`quota:${username}:${id}`));
      ctx.waitUntil(env.GEMINI_KV.delete(`quota:${username}:antigravity`));
      accountUsageMemory.delete(getAccountUsageKey(username, id));
      clearAccountCooldown(username, id, ctx);
      await saveUser(env, user, username);
      return jsonResponse({ success: true, message: "\u8D26\u53F7\u5DF2\u5220\u9664" });
    }

    if (action === "toggle") {
      if (!targetAccount) return jsonResponse({ error: "Account not found" }, 404);
      if (payload.enabled === void 0) {
        targetAccount.enabled = targetAccount.enabled === false;
      } else {
        targetAccount.enabled = payload.enabled === true || payload.enabled === "true" || payload.enabled === 1 || payload.enabled === "1";
      }
      ctx.waitUntil(env.GEMINI_KV.delete(`quota:${username}:antigravity`));
      await saveUser(env, user, username);
      return jsonResponse({ success: true, enabled: targetAccount.enabled });
    }

    if (action === "rename") {
      if (!targetAccount) return jsonResponse({ error: "Account not found" }, 404);
      const newName = (payload.name || "").trim();
      targetAccount.name = newName;
      ctx.waitUntil(env.GEMINI_KV.delete(`quota:${username}:antigravity`));
      await saveUser(env, user, username);
      return jsonResponse({ success: true, name: targetAccount.name });
    }

    if (action === "reset_cooldown") {
      if (!targetAccount) return jsonResponse({ error: "Account not found" }, 404);
      targetAccount.cooldown_until = 0;
      targetAccount.status = "active";
      targetAccount.error_message = null;
      clearAccountCooldown(username, id, ctx);
      ctx.waitUntil(env.GEMINI_KV.delete(`quota:${username}:antigravity`));
      await saveUser(env, user, username);
      return jsonResponse({ success: true, message: "\u5DF2\u91CD\u7F6E\u51B7\u5374\u72B6\u6001" });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
__name(handleAccountApi, "handleAccountApi");
__name2(handleAccountApi, "handleAccountApi");

async function startGoogleAuth(request, env) {
  const username = await getSessionUser(request, env);
  if (!username) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "codeassist";
  if (mode !== "codeassist" && mode !== "antigravity") {
    return new Response("Invalid OAuth mode", { status: 400 });
  }
  const oauthConfig = getOauthConfig(mode, env);
  if (!hasOauthCredentials(oauthConfig)) {
    return new Response(`${mode} OAuth credentials are not configured`, { status: 503 });
  }
  const state = generateRandomString(32);
  const { verifier, challenge } = await generatePKCE();
  await env.GEMINI_KV.put(`oauth:${state}`, JSON.stringify({ username, verifier, mode }), { expirationTtl: 600 });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: oauthConfig.client_id,
    redirect_uri: oauthConfig.redirect_uri,
    scope: oauthConfig.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account consent",
    state
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}
__name(startGoogleAuth, "startGoogleAuth");
__name2(startGoogleAuth, "startGoogleAuth");
async function handleGoogleCallback(request, env, ctx) {
  const username = await getSessionUser(request, env);
  if (!username) return new Response("Unauthorized", { status: 401 });
  const formData = await request.formData();
  const redirectUrl = formData.get("redirect_url");
  let code, state;
  try {
    const parsed = new URL(redirectUrl);
    code = parsed.searchParams.get("code");
    state = parsed.searchParams.get("state");
  } catch (e) {
    return new Response("\u7C98\u8D34\u7684 URL \u683C\u5F0F\u4E0D\u6B63\u786E", { status: 400 });
  }
  if (!code || !state) {
    return new Response("\u6388\u6743\u7ED3\u679C\u7F3A\u5C11 code \u6216 state \u53C2\u6570", { status: 400 });
  }
  const oauthData = await env.GEMINI_KV.get(`oauth:${state}`, "json");
  if (!oauthData || oauthData.username !== username) {
    return new Response("OAuth \u72B6\u6001\u5F02\u5E38\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u8BD5", { status: 400 });
  }
  const mode = oauthData.mode || "codeassist";
  if (mode !== "codeassist" && mode !== "antigravity") {
    await env.GEMINI_KV.delete(`oauth:${state}`);
    return new Response("Invalid OAuth mode", { status: 400 });
  }
  const oauthConfig = getOauthConfig(mode, env);
  if (!hasOauthCredentials(oauthConfig)) {
    return new Response(`${mode} OAuth credentials are not configured`, { status: 503 });
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthConfig.redirect_uri,
      client_id: oauthConfig.client_id,
      client_secret: oauthConfig.client_secret,
      code_verifier: oauthData.verifier
    })
  });
  if (!tokenRes.ok) return new Response("Token\u6362\u53D6\u5931\u8D25: " + await tokenRes.text(), { status: 500 });
  const tokenData = await tokenRes.json();
  const projectId = await ensureGeminiProject(tokenData.access_token, mode);
  let accountEmail = null;
  let accountName = null;
  try {
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { "Authorization": `Bearer ${tokenData.access_token}` }
    });
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      accountEmail = userInfo.email || null;
      accountName = userInfo.name || null;
    }
  } catch (e) {
    console.warn("[OAuth] Failed to fetch Google userinfo:", e.message || e);
  }
  let user = await env.GEMINI_KV.get(`user:${username}`, "json");
  const accounts = getUserAccounts(user);
  const tokenPayload = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || "",
    expires_at: Math.floor(Date.now() / 1e3) + (tokenData.expires_in || 3600),
    project_id: projectId || ""
  };
  let targetAccount = null;
  if (accountEmail) {
    targetAccount = accounts.find((a) => a.mode === mode && a.email && a.email.toLowerCase() === accountEmail.toLowerCase());
  }
  if (!targetAccount) {
    if (!tokenPayload.refresh_token) {
      await env.GEMINI_KV.delete(`oauth:${state}`);
      return new Response("\u672A\u83B7\u53D6\u5230 Google refresh_token\uFF0C\u65E0\u6CD5\u6301\u4E45\u4FDD\u5B58\u8D26\u53F7\u3002\u8BF7\u91CD\u65B0\u6388\u6743\u5E76\u786E\u8BA4\u5DF2\u540C\u610F\u6240\u6709\u6743\u9650\u3002", { status: 400 });
    }
    const modeCount = accounts.filter((a) => a.mode === mode).length + 1;
    const modeLabel = mode === "antigravity" ? "Antigravity" : "CodeAssist";
    targetAccount = {
      id: "acc_" + generateRandomString(8),
      email: accountEmail || `${modeLabel} \u8D26\u53F7 ${modeCount}`,
      name: accountName || "",
      mode,
      tokens: tokenPayload,
      enabled: true,
      created_at: Math.floor(Date.now() / 1e3),
      last_used_at: 0,
      status: "active",
      cooldown_until: 0,
      error_message: null
    };
    accounts.push(targetAccount);
  } else {
    if (!tokenPayload.refresh_token && targetAccount.tokens?.refresh_token) {
      tokenPayload.refresh_token = targetAccount.tokens.refresh_token;
    }
    targetAccount.tokens = tokenPayload;
    if (accountName) targetAccount.name = accountName;
    targetAccount.status = "active";
    targetAccount.cooldown_until = 0;
    targetAccount.error_message = null;
  }
  user.accounts = accounts;
  await saveUser(env, user, username);
  if (mode === "antigravity") {
    ctx?.waitUntil(env.GEMINI_KV.delete(`quota:${username}:antigravity`));
  }
  await env.GEMINI_KV.delete(`oauth:${state}`);
  return new Response(`
    <h2>Google \u6388\u6743\u6210\u529F\uFF01[${mode === "antigravity" ? "Antigravity" : "CodeAssist"}]</h2>
    <p>\u8D26\u53F7\uFF1A<b>${escapeHtml(targetAccount.email)}</b> ${targetAccount.name ? `(${escapeHtml(targetAccount.name)})` : ""}</p>
    <p>\u51ED\u8BC1\u5DF2\u56FA\u5316\u4FDD\u5B58\uFF0C\u5DF2\u52A0\u5165\u591A\u8D26\u53F7\u667A\u80FD\u8C03\u5EA6\u6C60\u3002\u9875\u9762\u5373\u5C06\u8DF3\u8F6C\u56DE\u63A7\u5236\u53F0...</p>
    <script>setTimeout(()=>window.location.href="/dashboard", 2000);<\/script>
  `, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}
__name(handleGoogleCallback, "handleGoogleCallback");
__name2(handleGoogleCallback, "handleGoogleCallback");
async function ensureGeminiProject(accessToken, mode) {
  const headers = { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" };
  if (mode === "antigravity") {
    headers["User-Agent"] = "Antigravity/4.2.1 (Macintosh; Intel Mac OS X 10_15_7) Chrome/132.0.6834.160 Electron/39.2.3";
  } else {
    headers["User-Agent"] = HEADERS_CA["User-Agent"];
    headers["X-Goog-Api-Client"] = HEADERS_CA["X-Goog-Api-Client"];
    headers["Client-Metadata"] = HEADERS_CA["Client-Metadata"];
  }
  const metadata = { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" };
  const loadRes = await fetch(`${GEMINI_ENDPOINT}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers,
    body: JSON.stringify({ metadata })
  });
  if (!loadRes.ok) return null;
  const loadData = await loadRes.json();
  if (loadData.cloudaicompanionProject) return loadData.cloudaicompanionProject;
  if (loadData.currentTier?.cloudaicompanionProject) return loadData.currentTier.cloudaicompanionProject;
  const tierId = loadData.allowedTiers?.find((t) => t.isDefault)?.id || "FREE";
  const onboardRes = await fetch(`${GEMINI_ENDPOINT}/v1internal:onboardUser`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tierId, metadata })
  });
  if (onboardRes.ok) {
    const onboardData = await onboardRes.json();
    return onboardData.response?.cloudaicompanionProject?.id || null;
  }
  return null;
}
__name(ensureGeminiProject, "ensureGeminiProject");
__name2(ensureGeminiProject, "ensureGeminiProject");
var ANTIGRAVITY_QUOTA_ENDPOINTS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal",
  "https://daily-cloudcode-pa.googleapis.com/v1internal",
  "https://cloudcode-pa.googleapis.com/v1internal"
];
var ANTIGRAVITY_QUOTA_UA = "Antigravity/4.2.1 (Macintosh; Intel Mac OS X 10_15_7) Chrome/132.0.6834.160 Electron/39.2.3";
async function antigravityQuotaFetchJson(url, accessToken, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_QUOTA_UA,
      "x-client-name": "antigravity",
      "x-client-version": "4.2.1"
    },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch (e) {
    }
    return { ok: false, status: res.status, text };
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, status: 0, text: "Invalid JSON from upstream" };
  }
  return { ok: true, status: res.status, data };
}
__name(antigravityQuotaFetchJson, "antigravityQuotaFetchJson");
__name2(antigravityQuotaFetchJson, "antigravityQuotaFetchJson");
async function fetchAntigravityProjectInfo(accessToken) {
  const result = await antigravityQuotaFetchJson(
    `${ANTIGRAVITY_QUOTA_ENDPOINTS[0]}:loadCodeAssist`,
    accessToken,
    { metadata: { ideType: "ANTIGRAVITY" } }
  );
  if (!result.ok || !result.data) return { projectId: null, subscriptionTier: null };
  const d = result.data;
  const projectId = d.cloudaicompanionProject || null;
  const isIneligible = Array.isArray(d.ineligibleTiers) && d.ineligibleTiers.length > 0;
  let tier = d.paidTier?.name || d.paidTier?.id || null;
  if (!tier) {
    if (!isIneligible) {
      tier = d.currentTier?.name || d.currentTier?.id || null;
    } else {
      const allowed = Array.isArray(d.allowedTiers) ? d.allowedTiers : [];
      const defTier = allowed.find((t) => t.isDefault === true) || allowed[0] || null;
      if (defTier) {
        tier = (defTier.name || defTier.id || "UNKNOWN") + " (Restricted)";
      }
    }
  }
  return { projectId, subscriptionTier: tier };
}
__name(fetchAntigravityProjectInfo, "fetchAntigravityProjectInfo");
__name2(fetchAntigravityProjectInfo, "fetchAntigravityProjectInfo");
async function fetchAntigravityModels(accessToken, projectId) {
  const basePayload = projectId ? { project: projectId } : {};
  let lastErr = null;
  for (let i = 0; i < ANTIGRAVITY_QUOTA_ENDPOINTS.length; i++) {
    const ep = ANTIGRAVITY_QUOTA_ENDPOINTS[i];
    const hasNext = i + 1 < ANTIGRAVITY_QUOTA_ENDPOINTS.length;
    let payload = basePayload;
    let retryWithoutProject = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await antigravityQuotaFetchJson(`${ep}:fetchAvailableModels`, accessToken, payload);
      if (res.ok && res.data) return { data: res.data };
      lastErr = res;
      if (res.status === 403) {
        if (payload.project && !retryWithoutProject) {
          payload = {};
          retryWithoutProject = true;
          continue;
        }
        return { forbidden: true, text: res.text };
      }
      if (res.status === 429 || res.status === 408 || res.status >= 500) {
        if (hasNext) break;
        return { error: `HTTP ${res.status} ${res.text}` };
      }
      return { error: `HTTP ${res.status} ${res.text}` };
    }
  }
  return { error: lastErr ? `HTTP ${lastErr.status} ${lastErr.text}` : "All endpoints failed" };
}
__name(fetchAntigravityModels, "fetchAntigravityModels");
__name2(fetchAntigravityModels, "fetchAntigravityModels");
async function fetchAntigravityQuotaSummary(accessToken, projectId) {
  const payload = projectId ? { project: projectId } : {};
  for (let i = 0; i < ANTIGRAVITY_QUOTA_ENDPOINTS.length; i++) {
    const res = await antigravityQuotaFetchJson(
      `${ANTIGRAVITY_QUOTA_ENDPOINTS[i]}:retrieveUserQuotaSummary`,
      accessToken,
      payload
    );
    if (res.ok && res.data && Array.isArray(res.data.groups)) {
      return res.data.groups.map((g) => ({
        display_name: g.displayName || "",
        description: g.description || null,
        buckets: (g.buckets || []).map((b) => ({
          bucket_id: b.bucketId || "",
          window: b.window || "",
          remaining_fraction: typeof b.remainingFraction === "number" ? b.remainingFraction : 0,
          reset_time: b.resetTime || "",
          display_name: b.displayName || null,
          description: b.description || null
        }))
      }));
    }
    if (res.status >= 400 && res.status !== 429) return null;
  }
  return null;
}
__name(fetchAntigravityQuotaSummary, "fetchAntigravityQuotaSummary");
__name2(fetchAntigravityQuotaSummary, "fetchAntigravityQuotaSummary");

function quotaWindowInfo(bucket) {
  const raw = String(bucket?.window || bucket?.bucket_id || bucket?.display_name || "").toUpperCase();
  if (raw.includes("WEEK")) return { key: "weekly", label: "\u5468\u7A97\u53E3" };
  if (raw.includes("FIVE") || raw.includes("HOUR") || raw.includes("5")) {
    return { key: "five-hour", label: "\u4E94\u5C0F\u65F6\u7A97\u53E3" };
  }
  return { key: "unknown", label: "\u7A97\u53E3\u672A\u6807\u6CE8" };
}
__name(quotaWindowInfo, "quotaWindowInfo");
__name2(quotaWindowInfo, "quotaWindowInfo");
function quotaResetTimesMatch(left, right) {
  if (!left || !right) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return Math.abs(leftMs - rightMs) <= 60 * 1e3;
  }
  return String(left) === String(right);
}
__name(quotaResetTimesMatch, "quotaResetTimesMatch");
__name2(quotaResetTimesMatch, "quotaResetTimesMatch");
function inferModelQuotaWindow(model, quotaGroups) {
  const modelResetTime = model?.reset_time;
  const modelPercentage = Number.isFinite(model?.percentage) ? model.percentage : null;
  const candidates = [];
  for (const group of quotaGroups || []) {
    for (const bucket of group?.buckets || []) {
      const info = quotaWindowInfo(bucket);
      if (info.key === "unknown") continue;
      const resetMatches = quotaResetTimesMatch(modelResetTime, bucket.reset_time);
      const percentageMatches = modelPercentage !== null &&
        Math.round((bucket.remaining_fraction || 0) * 100) === modelPercentage;
      if (resetMatches || percentageMatches) {
        candidates.push({
          info,
          score: (resetMatches ? 2 : 0) + (percentageMatches ? 1 : 0)
        });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.info || { key: "unknown", label: "\u7A97\u53E3\u672A\u6807\u6CE8" };
}
__name(inferModelQuotaWindow, "inferModelQuotaWindow");
__name2(inferModelQuotaWindow, "inferModelQuotaWindow");

async function fetchAccountAntigravityQuotaData(account, username, env, ctx, forceRefresh) {
  const tokens = account?.tokens;
  if (!tokens || !tokens.access_token) {
    return { error: "\u8D26\u53F7\u7F3A\u5C11\u6709\u6548\u51ED\u8BC1", status: 400 };
  }
  let accountChanged = false;
  const kvKey = `quota:${username}:${account.id}`;
  if (!forceRefresh) {
    const cached = await getTransientJsonCacheWithKvFallback(
      env,
      "quota-account",
      kvKey,
      kvKey,
      60
    );
    if (cached && cached.last_updated) {
      return { data: cached };
    }
  }
  let { access_token, refresh_token, expires_at } = tokens;
  if (Math.floor(Date.now() / 1e3) + 60 >= (expires_at || 0)) {
    const oauthConfig = getOauthConfig("antigravity", env);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token,
        client_id: oauthConfig.client_id,
        client_secret: oauthConfig.client_secret
      })
    });
    if (!tokenRes.ok) {
      account.status = "error";
      account.error_message = "Token refresh failed";
      return {
        error: "Antigravity Token \u5DF2\u8FC7\u671F\u4E14\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5728\u63A7\u5236\u53F0\u5B8C\u6210\u6388\u6743",
        status: 401,
        account_changed: true
      };
    }
    const td = await tokenRes.json();
    access_token = td.access_token;
    tokens.access_token = access_token;
    tokens.refresh_token = td.refresh_token || refresh_token;
    tokens.expires_at = Math.floor(Date.now() / 1e3) + (td.expires_in || 3600);
    account.tokens = tokens;
    account.status = "active";
    account.error_message = null;
    accountChanged = true;
  }
  try {
    const { projectId, subscriptionTier } = await fetchAntigravityProjectInfo(access_token);
    if (projectId && projectId !== tokens.project_id) {
      tokens.project_id = projectId;
      account.tokens = tokens;
      accountChanged = true;
    }
    const modelResult = await fetchAntigravityModels(access_token, projectId);
    if (modelResult.forbidden) {
      const forbiddenResult = {
        account_id: account.id,
        account_email: account.email,
        models: [],
        quota_groups: null,
        subscription_tier: subscriptionTier,
        project_id: projectId,
        last_updated: Math.floor(Date.now() / 1e3),
        is_forbidden: true,
        forbidden_reason: modelResult.text || "403 Forbidden"
      };
      if (account.status !== "quota_unavailable" || account.error_message !== forbiddenResult.forbidden_reason) {
        accountChanged = true;
      }
      account.status = "quota_unavailable";
      account.error_message = forbiddenResult.forbidden_reason;
      putTransientJsonCache("quota-account", kvKey, forbiddenResult, 60, ctx);
      return { data: forbiddenResult, account_changed: accountChanged };
    }
    if (modelResult.error) {
      return { error: `\u83B7\u53D6\u914D\u989D\u5931\u8D25: ${modelResult.error}`, status: 502 };
    }
    const data = modelResult.data;
    const models = [];
    const modelForwardingRules = {};
    for (const [name, info] of Object.entries(data.models || {})) {
      const quotaInfo = info.quotaInfo;
      if (!quotaInfo) continue;
      const nameLower = name.toLowerCase();
      if (!nameLower.startsWith("gemini") && !nameLower.startsWith("claude") && !nameLower.startsWith("gpt") && !nameLower.startsWith("image") && !nameLower.startsWith("imagen")) continue;
      const percentage = typeof quotaInfo.remainingFraction === "number" ? Math.round(quotaInfo.remainingFraction * 100) : 0;
      const rawBudget = typeof info.thinkingBudget === "number" ? info.thinkingBudget : null;
      models.push({
        name,
        percentage,
        reset_time: quotaInfo.resetTime || "",
        display_name: info.displayName || null,
        supports_images: typeof info.supportsImages === "boolean" ? info.supportsImages : null,
        supports_thinking: typeof info.supportsThinking === "boolean" ? info.supportsThinking : null,
        thinking_budget: rawBudget !== null && rawBudget > 0 ? rawBudget : null,
        thinking_budget_auto: rawBudget !== null && rawBudget <= 0,
        recommended: typeof info.recommended === "boolean" ? info.recommended : null,
        max_tokens: typeof info.maxTokens === "number" ? info.maxTokens : null,
        max_output_tokens: typeof info.maxOutputTokens === "number" ? info.maxOutputTokens : null
      });
    }
    if (data.deprecatedModelIds && typeof data.deprecatedModelIds === "object") {
      for (const [oldId, depInfo] of Object.entries(data.deprecatedModelIds)) {
        if (depInfo && depInfo.newModelId) modelForwardingRules[oldId] = depInfo.newModelId;
      }
    }
    const quotaGroups = await fetchAntigravityQuotaSummary(access_token, projectId);
    for (const model of models) {
      const windowInfo = inferModelQuotaWindow(model, quotaGroups);
      model.quota_window = windowInfo.key;
      model.quota_window_label = windowInfo.label;
    }
    const result = {
      account_id: account.id,
      account_email: account.email,
      models,
      quota_groups: quotaGroups,
      subscription_tier: subscriptionTier,
      project_id: projectId,
      model_forwarding_rules: modelForwardingRules,
      last_updated: Math.floor(Date.now() / 1e3),
      is_forbidden: false,
      forbidden_reason: null
    };
    if (account.status === "quota_unavailable") {
      account.status = "active";
      account.error_message = null;
      accountChanged = true;
    }
    putTransientJsonCache("quota-account", kvKey, result, 60, ctx);
    return { data: result, account_changed: accountChanged };
  } catch (e) {
    return { error: e.message || String(e), status: 502 };
  }
}
__name(fetchAccountAntigravityQuotaData, "fetchAccountAntigravityQuotaData");
__name2(fetchAccountAntigravityQuotaData, "fetchAccountAntigravityQuotaData");

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit || 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
__name(mapWithConcurrency, "mapWithConcurrency");
__name2(mapWithConcurrency, "mapWithConcurrency");

function mergeQuotaGroupsInto(groupMap, groups) {
  for (const group of groups || []) {
    const groupKey = group.display_name || group.description || "quota-group";
    let mergedGroup = groupMap.get(groupKey);
    if (!mergedGroup) {
      mergedGroup = { ...group, buckets: [] };
      groupMap.set(groupKey, mergedGroup);
    }
    const bucketMap = new Map(mergedGroup.buckets.map((bucket) => [
      bucket.bucket_id || bucket.window || bucket.display_name || "quota-bucket",
      bucket
    ]));
    for (const bucket of group.buckets || []) {
      const bucketKey = bucket.bucket_id || bucket.window || bucket.display_name || "quota-bucket";
      const existing = bucketMap.get(bucketKey);
      if (!existing) {
        const copy = { ...bucket };
        mergedGroup.buckets.push(copy);
        bucketMap.set(bucketKey, copy);
      } else if ((bucket.remaining_fraction || 0) > (existing.remaining_fraction || 0)) {
        Object.assign(existing, bucket);
      }
    }
  }
}
__name(mergeQuotaGroupsInto, "mergeQuotaGroupsInto");
__name2(mergeQuotaGroupsInto, "mergeQuotaGroupsInto");

// 获取用户 Antigravity 配额数据（多账号聚合或指定单个账号，带 60s KV 缓存）。返回 { data } 或 { error, status }。
async function fetchAntigravityQuotaData(user, username, env, ctx, forceRefresh, targetAccountId = null) {
  const accounts = getUserAccounts(user).filter((a) => a.mode === "antigravity");
  if (accounts.length === 0) {
    return { error: "Antigravity \u6A21\u5F0F\u5C1A\u672A\u7ED1\u5B9A Google \u8D26\u53F7\uFF0C\u8BF7\u5148\u5728\u63A7\u5236\u53F0\u5B8C\u6210\u6388\u6743", status: 400 };
  }
  if (targetAccountId) {
    const target = accounts.find((a) => a.id === targetAccountId);
    if (!target) return { error: "\u672A\u627E\u5230\u6307\u5B9A\u7684 Antigravity \u8D26\u53F7", status: 404 };
    const res = await fetchAccountAntigravityQuotaData(target, username, env, ctx, forceRefresh);
    if (res.account_changed) ctx?.waitUntil(saveUser(env, user, username));
    return res;
  }

  const aggregateKey = `quota:${username}:antigravity`;
  if (!forceRefresh) {
    const cached = await getTransientJsonCacheWithKvFallback(
      env,
      "quota-aggregate",
      aggregateKey,
      aggregateKey,
      60
    );
    if (cached && cached.last_updated && Array.isArray(cached.accounts)) {
      return { data: cached };
    }
  }

  // Coalesce cache misses within a Worker isolate. This prevents a burst of
  // simultaneous `/v1/models` requests from all refreshing and writing the
  // same aggregate KV key when its 60-second entry expires.
  const inFlightKey = username;
  const existingRefresh = quotaAggregationInFlight.get(inFlightKey);
  if (existingRefresh) return await existingRefresh;
  const refreshPromise = fetchAntigravityQuotaAggregateData(
    user,
    username,
    env,
    ctx,
    forceRefresh,
    accounts,
    aggregateKey
  );
  quotaAggregationInFlight.set(inFlightKey, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    if (quotaAggregationInFlight.get(inFlightKey) === refreshPromise) {
      quotaAggregationInFlight.delete(inFlightKey);
    }
  }
}
__name(fetchAntigravityQuotaData, "fetchAntigravityQuotaData");
__name2(fetchAntigravityQuotaData, "fetchAntigravityQuotaData");

async function fetchAntigravityQuotaAggregateData(user, username, env, ctx, forceRefresh, accounts, aggregateKey) {
  const activeAccounts = accounts.filter((a) => a.enabled !== false);
  const toFetch = activeAccounts.length > 0 ? activeAccounts : accounts;

  // Workers allow only a bounded number of simultaneous outgoing connections.
  // Keep quota probes below that ceiling even when users bind many accounts.
  const results = await mapWithConcurrency(
    toFetch,
    4,
    (acc) => fetchAccountAntigravityQuotaData(acc, username, env, ctx, forceRefresh)
  );

  const accountsQuota = [];
  const modelMap = new Map();
  const quotaGroupMap = new Map();
  const modelForwardingRules = {};
  let primaryTier = null;
  let primaryProjectId = null;
  let maxLastUpdated = 0;
  let allForbidden = true;
  let anySuccess = false;
  let accountChanged = false;

  for (let i = 0; i < toFetch.length; i++) {
    const acc = toFetch[i];
    const outcome = results[i];
    if (outcome.status === "fulfilled" && outcome.value?.account_changed) {
      accountChanged = true;
    }
    if (outcome.status === "fulfilled" && outcome.value?.data) {
      const qData = outcome.value.data;
      accountsQuota.push({
        id: acc.id,
        email: acc.email,
        name: acc.name,
        enabled: acc.enabled !== false,
        status: acc.status || "active",
        cooldown_until: acc.cooldown_until || 0,
        quota: qData
      });
      if (!qData.is_forbidden) {
        allForbidden = false;
        anySuccess = true;
        primaryTier = primaryTier || qData.subscription_tier;
        primaryProjectId = primaryProjectId || qData.project_id;
        maxLastUpdated = Math.max(maxLastUpdated, qData.last_updated || 0);
        mergeQuotaGroupsInto(quotaGroupMap, qData.quota_groups);
        Object.assign(modelForwardingRules, qData.model_forwarding_rules || {});

        for (const m of qData.models || []) {
          const existing = modelMap.get(m.name);
          if (!existing) {
            modelMap.set(m.name, { ...m });
          } else if (m.percentage > existing.percentage) {
            existing.percentage = m.percentage;
            existing.reset_time = m.reset_time;
          }
        }
      }
    } else {
      accountsQuota.push({
        id: acc.id,
        email: acc.email,
        name: acc.name,
        enabled: acc.enabled !== false,
        status: acc.status || "error",
        error: outcome.value?.error || outcome.reason?.message || "\u83B7\u53D6\u5931\u8D25"
      });
    }
  }

  if (accountChanged) ctx?.waitUntil(saveUser(env, user, username));

  if (!anySuccess && allForbidden && accountsQuota.some((a) => a.quota?.is_forbidden)) {
    const forbiddenReason = accountsQuota.find((a) => a.quota?.is_forbidden)?.quota?.forbidden_reason;
    const forbiddenResult = {
      accounts: accountsQuota,
      models: [],
      quota_groups: null,
      subscription_tier: null,
      project_id: null,
      last_updated: Math.floor(Date.now() / 1e3),
      is_forbidden: true,
      forbidden_reason: forbiddenReason || "403 Forbidden"
    };
    putTransientJsonCache("quota-aggregate", aggregateKey, forbiddenResult, 60, ctx);
    return { data: forbiddenResult };
  }

  const mergedResult = {
    accounts: accountsQuota,
    models: Array.from(modelMap.values()),
    quota_groups: Array.from(quotaGroupMap.values()),
    subscription_tier: primaryTier,
    project_id: primaryProjectId,
    model_forwarding_rules: modelForwardingRules,
    last_updated: maxLastUpdated || Math.floor(Date.now() / 1e3),
    is_forbidden: false,
    forbidden_reason: null
  };

  putTransientJsonCache("quota-aggregate", aggregateKey, mergedResult, 60, ctx);
  return { data: mergedResult };
}
__name(fetchAntigravityQuotaAggregateData, "fetchAntigravityQuotaAggregateData");
__name2(fetchAntigravityQuotaAggregateData, "fetchAntigravityQuotaAggregateData");
function checkModelQuota(quotaData, targetModelName) {
  if (!quotaData || !Array.isArray(quotaData.models) || !targetModelName) return null;
  const targetLower = targetModelName.trim().toLowerCase();
  let matched = quotaData.models.find((m) => m.name && m.name.toLowerCase() === targetLower);
  if (matched) return matched.percentage;
  if (quotaData.model_forwarding_rules && typeof quotaData.model_forwarding_rules === "object") {
    for (const [oldId, newId] of Object.entries(quotaData.model_forwarding_rules)) {
      if (oldId.toLowerCase() === targetLower || newId.toLowerCase() === targetLower) {
        const forwardedName = newId.toLowerCase();
        matched = quotaData.models.find((m) => m.name && m.name.toLowerCase() === forwardedName);
        if (matched) return matched.percentage;
      }
    }
  }
  matched = quotaData.models.find((m) => m.name && (m.name.toLowerCase().startsWith(targetLower) || targetLower.startsWith(m.name.toLowerCase())));
  if (matched) return matched.percentage;
  return null;
}
__name(checkModelQuota, "checkModelQuota");
__name2(checkModelQuota, "checkModelQuota");
async function handleAntigravityQuota(request, env, ctx) {
  const username = await getSessionUser(request, env);
  if (!username) return jsonResponse({ error: "Unauthorized" }, 401);
  const user = await env.GEMINI_KV.get(`user:${username}`, "json");
  if (!user) return jsonResponse({ error: "User not found" }, 404);
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const targetAccountId = url.searchParams.get("account_id");
  const result = await fetchAntigravityQuotaData(user, username, env, ctx, forceRefresh, targetAccountId);
  if (result.error) return jsonResponse({ error: result.error }, result.status || 502);
  return jsonResponse(result.data);
}
__name(handleAntigravityQuota, "handleAntigravityQuota");
__name2(handleAntigravityQuota, "handleAntigravityQuota");
// 获取用户 Antigravity 模式的可用模型列表（OpenAI /v1/models 兼容格式）。
// 模型 id 会套用用户配置的 antigravity_pattern（如 {modelname}-agy），保证可直接用于调用。
// 获取失败（未绑定/403/网络错误/为空）时返回 null，由调用方决定回退策略。
async function getAntigravityModelList(user, username, env, ctx) {
  const result = await fetchAntigravityQuotaData(user, username, env, ctx, false);
  if (result.error || !result.data || result.data.is_forbidden) return null;
  const models = result.data.models || [];
  if (models.length === 0) return null;
  const pattern = (user.api_config && user.api_config.antigravity_pattern) || "{modelname}-agy";
  const hasPlaceholder = pattern.includes("{modelname}");
  return models.map((m) => ({
    id: hasPlaceholder ? pattern.replace("{modelname}", m.name) : m.name,
    object: "model",
    created: 1715644800,
    owned_by: "antigravity",
    physical_model: m.name,
    display_name: m.display_name,
    quota_percentage: m.percentage,
    reset_time: m.reset_time,
    supports_thinking: m.supports_thinking,
    thinking_budget: m.thinking_budget,
    thinking_budget_auto: m.thinking_budget_auto === true,
    supports_images: m.supports_images,
    max_tokens: m.max_tokens,
    max_output_tokens: m.max_output_tokens,
    recommended: m.recommended
  }));
}
__name(getAntigravityModelList, "getAntigravityModelList");
__name2(getAntigravityModelList, "getAntigravityModelList");
async function handleModelsList(request, env, ctx, customPath) {
  const fallbackModels = [
    "gemini-3.5-flash-low",
    "gemini-3.5-flash",
    "gpt-4o",
    "claude-3-5-sonnet-20241022",
    "claude-opus-4"
  ];
  const apiKey = extractApiKey(request);
  let username = null;
  if (apiKey) {
    username = await env.GEMINI_KV.get(`key:${apiKey}`);
  } else if (customPath) {
    username = await env.GEMINI_KV.get(`path:${customPath}`);
  }
  if (username) {
    const user = await env.GEMINI_KV.get(`user:${username}`, "json");
    if (user) {
      try {
        const antigravityModels = await getAntigravityModelList(user, username, env, ctx);
        if (antigravityModels && antigravityModels.length > 0) {
          return jsonResponse({ object: "list", data: antigravityModels });
        }
      } catch (e) {
        console.warn(`[models] Failed to fetch antigravity model list for ${username}, falling back to static list:`, e.message || e);
      }
    }
  }
  return jsonResponse({
    object: "list",
    data: fallbackModels.map((m) => ({ id: m, object: "model", created: 1715644800, owned_by: "system" }))
  });
}
__name(handleModelsList, "handleModelsList");
__name2(handleModelsList, "handleModelsList");
async function handleApiProxy(request, env, ctx, customPath, apiType) {
  const responseProtocol = apiType === "openai-responses";
  const apiKey = extractApiKey(request);
  let username = null;
  if (apiKey) {
    username = await env.GEMINI_KV.get(`key:${apiKey}`);
    if (!username) {
      return jsonResponse({ error: "Unauthorized: Invalid API Key" }, 401);
    }
  } else if (customPath) {
    username = await env.GEMINI_KV.get(`path:${customPath}`);
    if (!username) {
      return jsonResponse({ error: "Unauthorized: Invalid Custom Path" }, 401);
    }
  } else {
    return jsonResponse({ error: "Unauthorized: Missing credentials" }, 401);
  }
  const user = await env.GEMINI_KV.get(`user:${username}`, "json");
  if (!user) {
    return jsonResponse({ error: "User not found" }, 404);
  }
  let userStateDirty = false;
  const persistUserIfDirty = async () => {
    if (!userStateDirty) return;
    userStateDirty = false;
    await saveUser(env, user, username);
  };
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }
  if (responseProtocol) {
    body = responsesRequestToChatRequest(body || {});
    apiType = "openai";
  }
  const geminiRoute = apiType === "gemini" ? getGeminiRouteInfo(request) : null;
  const inputModel = body.model || geminiRoute?.model || "gemini-3-flash-preview";
  if ((apiType === "openai" || apiType === "claude") && !Array.isArray(body.messages)) {
    return jsonResponse({ error: "`messages` must be an array" }, 400);
  }
  if (apiType === "gemini" && !Array.isArray(body.contents)) {
    return jsonResponse({ error: "`contents` must be an array" }, 400);
  }
  const sessionKey = getRequestSessionKey(body, request);
  const sessionId = deriveSessionId(`${username || "anonymous"}\u0000${inputModel}\u0000${sessionKey}`);
  const messageCount = body.messages ? body.messages.length : 1;
  const caPattern = user.api_config.codeassist_pattern || "{modelname}";
  const antigravity_pattern = user.api_config.antigravity_pattern || "{modelname}-agy";
  let mode = null;
  let physicalModel = null;
  const agMatch = matchPattern(inputModel, antigravity_pattern);
  const caMatch = matchPattern(inputModel, caPattern);
  if (agMatch) {
    mode = "antigravity";
    physicalModel = agMatch;
  } else if (caMatch) {
    mode = "codeassist";
    physicalModel = caMatch;
  } else {
    return jsonResponse({
      error: `Model '${inputModel}' does not match configured rules. (CodeAssist: ${caPattern}, Antigravity: ${antigravity_pattern})`
    }, 400);
  }
  const resolvedModel = physicalModel;
  const isClaudeModel = resolvedModel.toLowerCase().includes("claude");
  const allAccounts = getUserAccounts(user);
  const candidateAccounts = allAccounts.filter((a) =>
    a.mode === mode &&
    a.enabled !== false &&
    a.tokens &&
    (a.tokens.access_token || a.tokens.refresh_token)
  );
  if (candidateAccounts.length === 0) {
    return jsonResponse({
      error: `Google OAuth not configured for mode: ${mode}. Please add an account in the Dashboard.`
    }, 403);
  }
  const sortedAccounts = await rankAccountsForRequest(candidateAccounts, resolvedModel, username, env);
  const initialAccount = sortedAccounts[0];
  const isStream = body.stream === true || geminiRoute?.stream === true;
  let cloudCodePayload;
  let requestHeaders = {
    "Authorization": "Bearer pending-account-selection",
    "Content-Type": "application/json"
  };
  let projectId = initialAccount.tokens.project_id || "";
  let contents = [];
  let contentsHaveFunctionCalls = false;
  let systemInstructionText = "";
  let toolsPayload = void 0;
  function extractImageFromBlock(blk) {
    if (!blk || typeof blk !== "object") return null;
    const blkType = (blk.type || "").toLowerCase();
    if (blk.source && typeof blk.source === "object") {
      const data = blk.source.data;
      const mimeType = blk.source.media_type || "image/png";
      if (data) {
        return { inlineData: { mimeType, data } };
      }
    }
    if (blkType.includes("image") && blk.data && typeof blk.data === "string") {
      const mimeType = blk.mime_type || blk.media_type || blk.mimeType || "image/png";
      return { inlineData: { mimeType, data: blk.data } };
    }
    let url = typeof blk.image_url === "string" ? blk.image_url : blk.image_url?.url || (blkType.includes("image") ? blk.url : null);
    if (url && typeof url === "string") {
      if (url.startsWith("data:")) {
        const commaIdx = url.indexOf(",");
        if (commaIdx !== -1) {
          const mimeType = url.substring(5, url.indexOf(";")) || "image/png";
          const data = url.substring(commaIdx + 1);
          return { inlineData: { mimeType, data } };
        }
      } else {
        return { fileData: { fileUri: url, mimeType: blk.media_type || "image/png" } };
      }
    }
    return null;
  }
  if (apiType === "openai") {
    const systemInstructions = [];
    const systemMsg = body.messages.find((m) => m.role === "system" || m.role === "developer");
    if (systemMsg) {
      const sysText = Array.isArray(systemMsg.content) ? systemMsg.content.map((c) => c.text || "").join("\n") : systemMsg.content || "";
      systemInstructions.push(sysText);
    }
    systemInstructionText = systemInstructions.filter(Boolean).join("\n\n");
    const filteredMessages = body.messages.filter((m) => m.role !== "system" && m.role !== "developer");
    for (const fm of filteredMessages) {
      if (fm.content && typeof fm.content === "string") {
        const t = trimForStructuralParse(fm.content);
        // CPU 优化：只有真正的 content-block 数组需要此处转数组。真实 block
        // 数组一定以 [{"type" 开头（仅可能有空白差异）；纯文本恰好形如数组的
        // 场景（文件列表、JSON 代码块等）直接跳过 JSON.parse，避免对 100KB+
        // 文本做注定失败的全量解析。
        if (looksLikeBlockArray(t) && t.endsWith("]")) {
          try { const parsed = JSON.parse(t); if (Array.isArray(parsed)) fm.content = parsed; } catch (e) {}
        }
      }
    }
    const mergedMessages = mergeOpenAIMessages(filteredMessages);
    const toolIdToName = {};
    for (const msg of mergedMessages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolIdToName[tc.id] = tc.function.name === "local_shell_call" ? "shell" : tc.function.name;
          }
        }
      }
    }
    contents = mergedMessages.map((m) => {
      const parts = [];
      // 工具结果消息：必须生成 functionResponse 与前置 assistant 的 functionCall 配对，
      // 保证 Antigravity agent API 会话树结构完整，避免上游因孤立 functionCall 返回 429 RESOURCE_EXHAUSTED。
      const isToolResult = m.role === "tool" || !!m.tool_call_id;
      if (m.reasoning_content && m.reasoning_content !== "[undefined]") {
        // Skip reasoning content in history to prevent signature validation errors
      }

      if (m.content && !isToolResult) {
        if (typeof m.content === "string") {
          if (hasNonWhitespace(m.content)) {
            parts.push({ text: m.content });
          }
        } else if (Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block.type === "text") {
              if (block.text && hasNonWhitespace(block.text)) {
                parts.push({ text: block.text });
              }
            } else {
              const imgPart = extractImageFromBlock(block);
              if (imgPart) {
                parts.push(imgPart);
              }
            }
          }
        }
      }
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          contentsHaveFunctionCalls = true;
          let name = tc.function.name;
          if (name === "local_shell_call") name = "shell";
          const toolIdentity = decodeToolCallIdentity(tc.id);
          let args = {};
          try {
            args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments || {};
          } catch (e) {
          }
          const funcPart = {
            functionCall: {
              name,
              args,
              id: toolIdentity.id
            }
          };
          if (toolIdentity.thoughtSignature) {
            funcPart.thoughtSignature = toolIdentity.thoughtSignature;
            funcPart.thought_signature = toolIdentity.thoughtSignature;
          }
          parts.push(funcPart);
        }
      }
      if (isToolResult) {
        const name = m.name || toolIdToName[m.tool_call_id] || "unknown";
        const finalName = m.tool_call_id ? toolIdToName[m.tool_call_id] || name : name;
        const toolIdentity = decodeToolCallIdentity(m.tool_call_id);
        if (Array.isArray(m.content)) {
          const textParts = [];
          const mediaParts = [];
          for (const blk of m.content) {
            if ((blk.type === "text" || blk.type === "input_text") && blk.text) {
              textParts.push(typeof blk.text === "string" ? blk.text : JSON.stringify(blk.text));
            } else {
              const imgPart = extractImageFromBlock(blk);
              if (imgPart) {
                mediaParts.push(imgPart);
              }
            }
          }
          const responseBody = { result: textParts.join("\n") || "Image content attached" };
          if (mediaParts.length > 0) {
            responseBody.parts = mediaParts;
          }
          parts.push({
            functionResponse: {
              name: finalName,
              response: responseBody,
              id: toolIdentity.id || ""
            }
          });
          if (mediaParts.length > 0) {
            for (const mp of mediaParts) {
              parts.push(mp);
            }
          }
        } else {
          parts.push({
            functionResponse: {
              name: finalName,
              response: { result: m.content || "" },
              id: toolIdentity.id || ""
            }
          });
        }
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts
      };
    }).filter((c) => c.parts.length > 0);
    toolsPayload = mapTools(body, "openai", true, isClaudeModel);
  } else if (apiType === "claude") {
    const systemInstructions = [];
    if (body.system) {
      if (typeof body.system === "string") {
        systemInstructions.push(body.system);
      } else if (Array.isArray(body.system)) {
        for (const sys of body.system) {
          if (sys.text) {
            systemInstructions.push(sys.text);
          }
        }
      }
    }
    systemInstructionText = systemInstructions.filter(Boolean).join("\n\n");
    const rawClaude = (body.messages || []).map((m) => {
      if (m.content && typeof m.content === "string") {
        const t = trimForStructuralParse(m.content);
        // CPU 优化：与 openai 分支一致，仅对 [{"type"... 形式的真实 block 数组做解析。
        if (looksLikeBlockArray(t) && t.endsWith("]")) {
          try { const parsed = JSON.parse(t); if (Array.isArray(parsed)) m.content = parsed; } catch (e) {}
        }
      }
      return m;
    });
    const mergedMessages = mergeClaudeMessages(rawClaude);
    const toolIdToName = {};
    for (const msg of mergedMessages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.name) {
            toolIdToName[block.id] = block.name === "local_shell_call" ? "shell" : block.name;
          }
        }
      }
    }
    const finalContents = [];
    for (const m of mergedMessages) {
      let blocks = [];
      if (typeof m.content === "string") {
        blocks = [{ type: "text", text: m.content }];
      } else if (Array.isArray(m.content)) {
        blocks = sortClaudeBlocks(m.content);
      }
      const toolResultBlocks = [];
      const otherBlocks = [];
      for (const block of blocks) {
        if (block.type === "tool_result") {
          toolResultBlocks.push(block);
        } else {
          otherBlocks.push(block);
        }
      }
      const convertBlocksToParts = (blocksToConvert) => {
        const parts = [];
        for (const block of blocksToConvert) {
          if (block.type === "thinking") {
            // Skip thinking blocks in history to bypass invalid thinking signature errors
          } else if (block.type === "redacted_thinking") {
            // Skip redacted thinking blocks in history to bypass invalid thinking signature errors
          } else if (block.type === "text") {
            if (block.text && hasNonWhitespace(block.text)) {
              parts.push({ text: block.text });
            }
          } else if (block.type === "image" && block.source) {
            parts.push({
              inlineData: {
                mimeType: block.source.media_type || "image/jpeg",
                data: block.source.data || ""
              }
            });
          } else if (block.type === "tool_use") {
            contentsHaveFunctionCalls = true;
            let name = block.name;
            if (name === "local_shell_call") name = "shell";
            const funcPart = {
              functionCall: {
                name,
                args: block.input || {},
                id: block.id
              }
            };
            parts.push(funcPart);
          } else if (block.type === "tool_result") {
            const name = toolIdToName[block.tool_use_id] || "unknown";
            let resultText = "";
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              for (const rb of block.content) {
                if ((rb.type === "text" || rb.type === "input_text" || rb.type === "output_text") && rb.text) {
                  resultText += (resultText ? "\n" : "") + (typeof rb.text === "string" ? rb.text : JSON.stringify(rb.text));
                } else if (rb.type === "image" && rb.source) {
                  parts.push({ inlineData: { mimeType: rb.source.media_type || "image/jpeg", data: rb.source.data || "" } });
                } else if (rb.type === "image_url" || rb.type === "input_image") {
                  const imgUrl = typeof rb.image_url === "string" ? rb.image_url : rb.image_url?.url;
                  if (imgUrl) {
                    if (imgUrl.startsWith("data:")) {
                      const commaIdx = imgUrl.indexOf(",");
                      if (commaIdx !== -1) {
                        parts.push({ inlineData: { mimeType: imgUrl.substring(5, imgUrl.indexOf(";")) || "image/jpeg", data: imgUrl.substring(commaIdx + 1) } });
                      }
                    } else {
                      parts.push({ fileData: { fileUri: imgUrl, mimeType: rb.media_type || "image/jpeg" } });
                    }
                  }
                }
              }
            }
            parts.push({
              functionResponse: {
                name,
                response: { result: resultText },
                id: block.tool_use_id || ""
              }
            });
          }
        }
        return parts;
      };
      if (toolResultBlocks.length > 0) {
        const toolParts = convertBlocksToParts(toolResultBlocks);
        if (toolParts.length > 0) {
          finalContents.push({
            role: "user",
            parts: toolParts
          });
        }
      }
      if (otherBlocks.length > 0) {
        const otherParts = convertBlocksToParts(otherBlocks);
        if (otherParts.length > 0) {
          finalContents.push({
            role: m.role === "assistant" ? "model" : "user",
            parts: otherParts
          });
        }
      }
    }
    contents = finalContents;
    const isClaude = resolvedModel.toLowerCase().includes("claude");
    toolsPayload = mapTools(body, "claude", !isClaude, isClaude);
  } else {
    if (mode === "codeassist") {
      // CodeAssist forwards the original Gemini request object unchanged below.
      // Avoid cloning large contents and schemas that would be discarded.
      contents = body.contents || [];
      toolsPayload = body.tools;
    } else {
      contents = [];
      if (body.contents && Array.isArray(body.contents)) {
        // Short-circuit at the first call. Tool histories are handled by the
        // single-pass preparer below; ordinary histories retain the original
        // array without any cloning.
        contentsHaveFunctionCalls = body.contents.some((m) => Array.isArray(m?.parts) && m.parts.some((part) => part?.functionCall));
        // Antigravity 下面会统一完成 thought-signature 注入和工具 ID
        // 规范化。这里直接复用 request.json() 生成的临时数组，避免对
        // 原生 Gemini 长历史做一次随后会被覆盖的重复 map + KV 读取。
        contents = body.contents;
      }
      if (body.systemInstruction?.parts?.[0]?.text) {
        systemInstructionText = body.systemInstruction.parts[0].text;
      }
      if (body.tools && Array.isArray(body.tools)) {
        // body 是 request.json() 反序列化的临时对象，原地清理 schema 无需
        // structuredClone，大工具列表免去整棵深拷贝。
        for (const t of body.tools) {
          if (t.functionDeclarations && Array.isArray(t.functionDeclarations)) {
            for (const fd of t.functionDeclarations) {
              if (fd.parameters) {
                optimizeAndCleanSchema(fd.parameters, true);
              }
            }
          }
        }
        toolsPayload = body.tools;
      } else {
        toolsPayload = body.tools;
      }
    }
  }
  if (mode === "antigravity") {
    if (!user.machine_id) {
      user.machine_id = crypto.randomUUID();
      userStateDirty = true;
    }
    requestHeaders["User-Agent"] = "Antigravity/4.2.1 (Macintosh; Intel Mac OS X 10_15_7) Chrome/132.0.6834.160 Electron/39.2.3";
    requestHeaders["x-client-name"] = "antigravity";
    requestHeaders["x-client-version"] = "4.2.1";
    requestHeaders["x-machine-id"] = user.machine_id;
    if (resolvedModel.toLowerCase().includes("claude")) {
      requestHeaders["anthropic-beta"] = "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";
    }
    let genConfig = apiType === "gemini" ? body.generationConfig || {} : {};
    if (apiType === "openai") {
      if (body.temperature !== void 0) genConfig.temperature = body.temperature;
      if (body.top_p !== void 0) genConfig.top_p = body.top_p;
      if (body.max_tokens !== void 0) genConfig.maxOutputTokens = body.max_tokens;
      if (body.response_format) {
        if (body.response_format.type === "json_object" || body.response_format.type === "json_schema") {
          genConfig.responseMimeType = "application/json";
        }
        if (body.response_format.type === "json_schema" && body.response_format.json_schema?.schema) {
          genConfig.responseSchema = body.response_format.json_schema.schema;
          optimizeAndCleanSchema(genConfig.responseSchema, false);
        }
      }
    }
    const innerRequest = {
      model: resolvedModel,
      contents: [],
      systemInstruction: systemInstructionText ? {
        role: "user",
        parts: [{ text: systemInstructionText }]
      } : void 0,
      generationConfig: genConfig,
      toolConfig: apiType === "gemini" ? body.toolConfig || { functionCallingConfig: { mode: "AUTO" } } : getOpenAIToolConfig(body),
      tools: toolsPayload,
      sessionId
    };
    if (contents && Array.isArray(contents)) {
      if (!contentsHaveFunctionCalls) {
        innerRequest.contents = contents;
      } else {
        const cachedSig = await getSessionSignature(env, sessionId);
        const actualIncludeThinking = shouldEnableThinking(body, resolvedModel, apiType);
        innerRequest.contents = prepareAntigravityContents(contents, cachedSig, actualIncludeThinking);
      }
    }
    const thinkingConfig = getUpstreamThinkingConfig(body, resolvedModel, apiType);
    if (thinkingConfig) {
      if (!innerRequest.generationConfig) innerRequest.generationConfig = {};
      innerRequest.generationConfig.thinkingConfig = {
        ...innerRequest.generationConfig.thinkingConfig,
        ...thinkingConfig
      };
      if (shouldEnableThinking(body, resolvedModel, apiType)) {
        const budget = thinkingConfig.thinkingBudget;
        const maxTokens = typeof budget === "number" && budget > 0 ? Math.min(65536, budget + 8192) : 65536;
        innerRequest.generationConfig.maxOutputTokens = maxTokens;
      }
    }
    const timestampMs = Date.now();
    const randomHex = crypto.randomUUID().replace(/-/g, "").substring(0, 8);
    const officialRequestId = `agent/${timestampMs}/${randomHex}`;
    cloudCodePayload = {
      project: "",
      requestId: officialRequestId,
      request: innerRequest,
      model: resolvedModel,
      userAgent: "antigravity",
      requestType: "agent",
      enabledCreditTypes: ["GOOGLE_ONE_AI"]
    };
  } else {
    requestHeaders["User-Agent"] = HEADERS_CA["User-Agent"];
    requestHeaders["X-Goog-Api-Client"] = HEADERS_CA["X-Goog-Api-Client"];
    requestHeaders["Client-Metadata"] = HEADERS_CA["Client-Metadata"];
    let genConfig = {};
    if (apiType === "openai") {
      if (body.temperature !== void 0) genConfig.temperature = body.temperature;
      if (body.top_p !== void 0) genConfig.top_p = body.top_p;
      if (body.max_tokens !== void 0) genConfig.maxOutputTokens = body.max_tokens;
      if (body.response_format) {
        if (body.response_format.type === "json_object" || body.response_format.type === "json_schema") {
          genConfig.responseMimeType = "application/json";
        }
        if (body.response_format.type === "json_schema" && body.response_format.json_schema?.schema) {
          genConfig.responseSchema = body.response_format.json_schema.schema;
          optimizeAndCleanSchema(genConfig.responseSchema, false);
        }
      }
    }
    const innerRequest = apiType === "gemini" ? body : {
      contents,
      systemInstruction: systemInstructionText ? {
        role: "user",
        parts: [{ text: systemInstructionText }]
      } : void 0,
      tools: toolsPayload,
      toolConfig: toolsPayload ? (responseProtocol ? getOpenAIToolConfig(body) : { functionCallingConfig: { mode: "VALIDATED" } }) : void 0,
      generationConfig: genConfig
    };
    const thinkingConfig = getUpstreamThinkingConfig(body, resolvedModel, apiType);
    if (thinkingConfig) {
      if (!innerRequest.generationConfig) innerRequest.generationConfig = {};
      innerRequest.generationConfig.thinkingConfig = {
        ...innerRequest.generationConfig.thinkingConfig,
        ...thinkingConfig
      };
      if (shouldEnableThinking(body, resolvedModel, apiType)) {
        const budget = thinkingConfig.thinkingBudget;
        const maxTokens = typeof budget === "number" && budget > 0 ? Math.min(65536, budget + 8192) : 65536;
        innerRequest.generationConfig.maxOutputTokens = maxTokens;
      }
    }
    cloudCodePayload = {
      project: projectId,
      model: resolvedModel,
      request: innerRequest
    };
  }
  // Antigravity + Claude 模型不支持 SSE 流式接口，必须用非流式再模拟
  // Antigravity + Gemini 模型支持 streamGenerateContent，用真流式以节省内存
  const useStreamUpstream = isStream && (mode === "codeassist" || !isClaudeModel);
  const method = useStreamUpstream ? "streamGenerateContent" : "generateContent";
  let googleRes = null;
  let responseData = null;
  let sseLines = null;
  const MAX_RETRIES = 3;
  // 重试不得改动 contents：上下文必须逐字完整地重发。Antigravity 的
  // requestId 是一次逻辑请求的去重/路由标识；每个新的重试需要新 requestId，
  // 否则上游可能把同一个 429/空响应结果当成重复请求再次返回。
  // 只修改最外层 requestId，不修改模型、消息、工具或任何生成参数。
  let basePayloadSerialized = void 0;
  const buildAttemptPayload = (basePayload, attempt, isAntigravity) => {
    if (!isAntigravity || attempt <= 1 || !basePayload?.requestId) return basePayload;
    const timestampMs = Date.now();
    const randomHex = crypto.randomUUID().replace(/-/g, "").substring(0, 8);
    return { ...basePayload, requestId: `agent/${timestampMs}/${randomHex}` };
  };
  let retrySerializedPrefix = null;
  let retrySerializedSuffix = null;
  const serializeAttemptPayload = (attemptPayload) => {
    if (attemptPayload === cloudCodePayload) {
      if (basePayloadSerialized === void 0) basePayloadSerialized = JSON.stringify(attemptPayload);
      return basePayloadSerialized;
    }
    // Antigravity 重试只改变顶层 requestId。缓存首个序列化结果的前后缀，
    // 避免每次重试重新遍历数十万字节的 contents/tools 对象。
    if (mode === "antigravity" && attemptPayload?.requestId && cloudCodePayload?.requestId) {
      if (retrySerializedPrefix === null) {
        if (basePayloadSerialized === void 0) basePayloadSerialized = JSON.stringify(cloudCodePayload);
        const marker = `"requestId":${JSON.stringify(cloudCodePayload.requestId)}`;
        const markerIndex = basePayloadSerialized.indexOf(marker);
        if (markerIndex !== -1) {
          retrySerializedPrefix = basePayloadSerialized.slice(0, markerIndex) + `"requestId":`;
          retrySerializedSuffix = basePayloadSerialized.slice(markerIndex + marker.length);
        }
      }
      if (retrySerializedPrefix !== null) {
        return retrySerializedPrefix + JSON.stringify(attemptPayload.requestId) + retrySerializedSuffix;
      }
    }
    return JSON.stringify(attemptPayload);
  };
  let successfulAccount = null;
  let finalGoogleRes = null;
  let lastAccountError = null;
  for (let accIdx = 0; accIdx < sortedAccounts.length; accIdx++) {
    const currentAccount = sortedAccounts[accIdx];
    const hasNextAccount = accIdx + 1 < sortedAccounts.length;
    const tokenRes = await ensureValidAccountToken(currentAccount, mode, env, user, username, ctx);
    if (tokenRes.changed) userStateDirty = true;
    if (!tokenRes.ok) {
      console.warn(`[Multi-Account] Account ${currentAccount.email || currentAccount.id} token invalid: ${tokenRes.error}`);
      currentAccount.status = "error";
      currentAccount.error_message = tokenRes.error;
      if (hasNextAccount) {
        continue;
      }
      await persistUserIfDirty();
      return jsonResponse({ error: `Token refresh failed for mode ${mode}. Please re-auth in Dashboard.` }, 401);
    }
    const curToken = currentAccount.tokens.access_token;
    requestHeaders["Authorization"] = `Bearer ${curToken}`;
    let curProjectId = currentAccount.tokens.project_id || "";
    if (!curProjectId && mode === "codeassist") {
      try {
        const ensured = await ensureGeminiProject(curToken, mode);
        if (ensured) {
          curProjectId = ensured;
          currentAccount.tokens.project_id = curProjectId;
          userStateDirty = true;
        }
      } catch (e) {
        console.warn("[codeassist] Auto ensureGeminiProject failed:", e.message || e);
      }
    }
    if (mode === "codeassist") {
      cloudCodePayload.project = curProjectId;
    } else {
      if (!currentAccount.machine_id) {
        currentAccount.machine_id = user.machine_id || crypto.randomUUID();
        userStateDirty = true;
      }
      requestHeaders["x-machine-id"] = currentAccount.machine_id;
    }
    // A previous account may have populated the lazy serialized payload or
    // response buffers. Reset all account-specific state before failover so a
    // CodeAssist project ID or stale response can never leak across accounts.
    basePayloadSerialized = void 0;
    retrySerializedPrefix = null;
    retrySerializedSuffix = null;
    googleRes = null;
    responseData = null;
    sseLines = null;
    let accountSucceeded = false;
    let shouldFailoverToNext = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const attemptPayload = buildAttemptPayload(cloudCodePayload, attempt, mode === "antigravity");
    try {
      const serializedAttemptPayload = serializeAttemptPayload(attemptPayload);
      googleRes = await callUpstream(method, requestHeaders, attemptPayload, useStreamUpstream, serializedAttemptPayload);
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        lastAccountError = { error: err.message || String(err), status: 500 };
        if (hasNextAccount) {
          shouldFailoverToNext = true;
          break;
        }
        await persistUserIfDirty();
        return jsonResponse({ error: err.message || String(err) }, 500);
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
      continue;
    }
    if (!googleRes.ok) {
      const status = googleRes.status;
      if (status === 429 && mode === "antigravity") {
        if (hasNextAccount) {
          const retryAfterSec = parseInt(googleRes.headers?.get("Retry-After") || "60", 10) || 60;
          const cooldownUntil = Math.floor(Date.now() / 1e3) + Math.min(300, Math.max(30, retryAfterSec));
          rememberAccountCooldown(username, currentAccount, cooldownUntil, ctx);
          console.warn(`[Multi-Account Failover] Antigravity account '${currentAccount.email || currentAccount.id}' returned 429. Failing over to next account '${sortedAccounts[accIdx + 1].email || sortedAccounts[accIdx + 1].id}'...`);
          try { await googleRes.body?.cancel(); } catch (_) {}
          shouldFailoverToNext = true;
          break;
        }
        console.warn(`[429] entering recovery model=${resolvedModel} attempt=${attempt}/${MAX_RETRIES} requestId=${cloudCodePayload?.requestId || "none"} bytes=${basePayloadSerialized?.length || 0}`);
        let quotaData = null;
        try {
          const quotaResult = await fetchAccountAntigravityQuotaData(currentAccount, username, env, ctx, true);
          if (!quotaResult.error && quotaResult.data) {
            quotaData = quotaResult.data;
          }
        } catch (e) {
          console.warn("[429] Failed to check antigravity quota:", e.message || e);
        }
        const quotaPercentage = checkModelQuota(quotaData, resolvedModel);
        // 配额接口可能暂时失败或不返回该模型。429 本身仍可能是短时节流，
        // 因此“未知配额”也允许有限重试；只有明确报告 0% 时才直接返回。
        if (quotaPercentage === null || quotaPercentage > 0) {
          const quotaText = quotaPercentage === null ? "unknown" : `${quotaPercentage}%`;
          console.warn(`[429] Antigravity model '${resolvedModel}' returned 429 with ${quotaText} quota remaining. Starting backoff retry (up to 3 times)...`);
          const baseDelays = [2000, 5000, 10000];
          const initialRetryAfter = googleRes?.headers?.get("Retry-After");
          for (let retry = 1; retry <= 3; retry++) {
            let backoffMs = baseDelays[retry - 1] + Math.floor(Math.random() * 1000);
            const retryAfterHeader = googleRes?.headers?.get("Retry-After") || initialRetryAfter;
            if (retryAfterHeader) {
              const parsedSec = parseInt(retryAfterHeader, 10);
              if (!isNaN(parsedSec) && parsedSec > 0 && parsedSec <= 30) {
                backoffMs = parsedSec * 1000 + Math.floor(Math.random() * 500);
              }
            }
            await sleep(backoffMs);
            const retryPayload = buildAttemptPayload(cloudCodePayload, attempt + retry, true);
            try {
              const prevRes = googleRes;
              // 与外层 attempt 使用同一个惰性序列化器。这里的 retryPayload
              // 只改了顶层 requestId，不能再次 JSON.stringify 整个长上下文；
              // 否则一次 429 会额外遍历数百 KB 的 contents/tools，正好把
              // Cloudflare 的 CPU 预算消耗在无意义的重复序列化上。
              const serializedRetryPayload = serializeAttemptPayload(retryPayload);
              const nextRes = await callUpstream(method, requestHeaders, retryPayload, useStreamUpstream, serializedRetryPayload);
              try { await prevRes?.body?.cancel(); } catch (e) {}
              googleRes = nextRes;
              if (googleRes.ok) {
                break;
              }
              if (googleRes.status !== 429 && googleRes.status < 500 && googleRes.status !== 400) {
                break;
              }
            } catch (retryErr) {
              console.warn(`[429] Backoff retry ${retry}/3 failed:`, retryErr.message || retryErr);
            }
          }
        }
      }
      if (status === 429 && mode === "codeassist" && hasNextAccount) {
        const retryAfterSec = parseInt(googleRes.headers?.get("Retry-After") || "60", 10) || 60;
        const cooldownUntil = Math.floor(Date.now() / 1e3) + Math.min(300, Math.max(30, retryAfterSec));
        rememberAccountCooldown(username, currentAccount, cooldownUntil, ctx);
        console.warn(`[Multi-Account Failover] CodeAssist account '${currentAccount.email || currentAccount.id}' returned 429. Failing over to next account...`);
        try { await googleRes.body?.cancel(); } catch (_) {}
        shouldFailoverToNext = true;
        break;
      }
      if ((status === 401 || status === 403) && hasNextAccount) {
        currentAccount.status = "error";
        currentAccount.error_message = `${status} ${status === 401 ? "Unauthorized" : "Forbidden"}`;
        userStateDirty = true;
        console.warn(`[Multi-Account Failover] Account '${currentAccount.email || currentAccount.id}' returned ${status}. Failing over to next account...`);
        try { await googleRes.body?.cancel(); } catch (_) {}
        shouldFailoverToNext = true;
        break;
      }
      if (!googleRes.ok) {
        const currentStatus = googleRes.status;
        const retryableStatus = currentStatus === 400 || (currentStatus === 429 && mode !== "antigravity") || currentStatus === 408 || currentStatus >= 500;
        if (retryableStatus && attempt < MAX_RETRIES) {
          try {
            await googleRes.body?.cancel();
          } catch (e) {
          }
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        if (hasNextAccount && (currentStatus === 401 || currentStatus === 403 || currentStatus === 408 || currentStatus === 429 || currentStatus >= 500)) {
          try { await googleRes.body?.cancel(); } catch (_) {}
          shouldFailoverToNext = true;
          break;
        }
        let errorText = "";
        try {
          if (googleRes && !googleRes.bodyUsed) {
            errorText = await googleRes.text();
          }
        } catch (e) {
          console.warn("[errorText] Failed to read response text:", e.message || e);
        }
        if (!errorText) {
          errorText = JSON.stringify({
            error: {
              message: `Upstream returned HTTP ${currentStatus}`,
              code: currentStatus
            }
          });
        }
        lastAccountError = {
          response: new Response(errorText, {
            status: currentStatus,
            headers: {
              "Content-Type": googleRes.headers.get("Content-Type") || "application/json;charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "*",
              "Access-Control-Allow-Methods": "*"
            }
          })
        };
        if (hasNextAccount) {
          shouldFailoverToNext = true;
          break;
        }
        await persistUserIfDirty();
        return lastAccountError.response;
      }
    }
    if (useStreamUpstream) {
      const sseResult = await readSseLines(googleRes.body);
      sseLines = sseResult.lines;
      if (!sseResult.hasAnyContent) {
        console.warn(`Upstream returned empty SSE stream (attempt ${attempt}/${MAX_RETRIES})`);
        if (attempt === MAX_RETRIES) {
          if (hasNextAccount) {
            shouldFailoverToNext = true;
            break;
          }
          await persistUserIfDirty();
          return jsonResponse({
            error: {
              message: "Model returned an empty response after 3 attempts",
              type: "api_error"
            }
          }, 500);
        }
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      accountSucceeded = true;
      break;
    } else {
      try {
        responseData = await googleRes.json();
      } catch (e) {
        if (attempt === MAX_RETRIES) {
          if (hasNextAccount) {
            shouldFailoverToNext = true;
            break;
          }
          await persistUserIfDirty();
          return jsonResponse({ error: "Failed to parse upstream JSON response" }, 500);
        }
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      if (isResponseEmpty(responseData)) {
        if (!googleRes.ok || (useStreamUpstream ? (sseLines === null || sseLines.length === 0) : isResponseEmpty(responseData))) {
          console.warn(`Upstream returned empty response (attempt ${attempt}/${MAX_RETRIES})`);
        }
        if (attempt === MAX_RETRIES) {
          if (hasNextAccount) {
            shouldFailoverToNext = true;
            break;
          }
          await persistUserIfDirty();
          return jsonResponse({
            error: {
              message: "Model returned an empty response after 3 attempts",
              type: "api_error"
            }
          }, 500);
        }
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      accountSucceeded = true;
      break;
    }
    }
    if (shouldFailoverToNext) {
      continue;
    }
    if (accountSucceeded) {
      successfulAccount = currentAccount;
      finalGoogleRes = googleRes;
      // A cooldown is transient and must not turn a successful request into a
      // full user KV write. Other status/error recovery remains durable.
      if (
        (currentAccount.status !== "active" && currentAccount.status !== "cooldown") ||
        currentAccount.error_message != null
      ) {
        userStateDirty = true;
      }
      currentAccount.status = "active";
      currentAccount.error_message = null;
      currentAccount.last_used_at = Math.floor(Date.now() / 1e3);
      currentAccount.cooldown_until = 0;
      clearAccountCooldown(username, currentAccount.id, ctx);
      recordAccountUsage(username, currentAccount, currentAccount.last_used_at);
      if (userStateDirty) {
        ctx.waitUntil(persistUserIfDirty());
      }
      break;
    }
  }
  if (!successfulAccount) {
    await persistUserIfDirty();
    if (lastAccountError?.response) return lastAccountError.response;
    return jsonResponse({
      error: lastAccountError?.error || "All candidate Google accounts failed to fulfill the request"
    }, lastAccountError?.status || 502);
  }
  googleRes = finalGoogleRes;
  if (isStream) {
    const { readable, writable } = new TransformStream();
    if (responseProtocol) {
      ctx.waitUntil((async () => {
        try {
          if (!useStreamUpstream) {
            await streamResponsesSimulatedResponse(responseData, writable, inputModel, mode, env, sessionId, messageCount, ctx);
          } else {
            await processResponsesStreamLines(sseLines, writable, inputModel, mode, env, sessionId, messageCount, ctx);
          }
        } catch (e) {
          try {
            const w = writable.getWriter();
            await w.close();
          } catch (_) {}
        }
      })());
    } else if (!useStreamUpstream) {
      // Antigravity + Claude：上游非流式，本地模拟流式
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      ctx.waitUntil((async () => {
        try {
          await streamSimulatedResponse(responseData, apiType, inputModel, writer, encoder, env, sessionId, messageCount, ctx);
        } catch (e) {
          try {
            await writer.close();
          } catch (_) {
          }
        }
      })());
    } else {
      // codeassist 或 antigravity+Gemini：真 SSE 流式
      ctx.waitUntil((async () => {
        try {
          await processStreamLines(sseLines, writable, apiType, inputModel, env, sessionId, messageCount, ctx);
        } catch (e) {
          try {
            const w = writable.getWriter();
            await w.close();
          } catch (_) {
          }
        }
      })());
    }
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
      }
    });
  } else {
    const data = responseData;
    if (sessionId) {
      let responseSig = null;
      const raw = data.response || data;
      if (raw.candidates && Array.isArray(raw.candidates)) {
        for (const candidate of raw.candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              const sig = part["thoughtSignature"] || part["thought_signature"];
              if (sig && sig.length >= 50) {
                responseSig = sig;
                break;
              }
            }
          }
        }
      }
      if (responseSig) {
        ctx.waitUntil(cacheSessionSignature(env, sessionId, responseSig, messageCount, ctx));
      }
    }
    if (responseProtocol) {
      return jsonResponse(googleResponseToResponses(data, inputModel, mode));
    }
    if (apiType === "openai") {
      const raw = data.response || data;
      const choices = [];
      if (raw.candidates && Array.isArray(raw.candidates)) {
        for (let idx = 0; idx < raw.candidates.length; idx++) {
          const candidate = raw.candidates[idx];
          let contentOut = "";
          let thoughtOut = "";
          const toolCalls = [];
          if (candidate.content && Array.isArray(candidate.content.parts)) {
            const responseParts = candidate.content.parts;
            const hasExplicitThought = responseParts.some((p) => p["thought"] === true);
            for (let partIdx = 0; partIdx < responseParts.length; partIdx++) {
              const part = responseParts[partIdx];
              if (part["thought"] === true) {
                thoughtOut += part.text || "";
              } else if (part.text) {
                if (!hasExplicitThought && mode === "antigravity" && partIdx === 0 && responseParts.length >= 2) {
                  thoughtOut += part.text || "";
                } else {
                  contentOut += part.text || "";
                }
              }
              if (part.functionCall) {
                const fc = part.functionCall;
                const name = fc.name || "unknown";
                const rawId = fc.id || `call_${name}_${generateRandomString(8)}`;
                const id = encodeToolCallIdentity(rawId, part["thoughtSignature"] || part["thought_signature"]);
                toolCalls.push({
                  id,
                  type: "function",
                  function: {
                    name,
                    arguments: typeof fc.args === "object" ? JSON.stringify(fc.args) : fc.args || "{}"
                  }
                });
              }
            }
          }
          choices.push({
            index: idx,
            message: {
              role: "assistant",
              content: contentOut || null,
              reasoning_content: thoughtOut || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : null
            },
            finish_reason: "stop"
          });
        }
      }
      const oaiResponse = {
        id: "chatcmpl-" + generateRandomString(12),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1e3),
        model: inputModel,
        choices,
        usage: raw.usageMetadata ? {
          prompt_tokens: raw.usageMetadata.promptTokenCount || 0,
          completion_tokens: (raw.usageMetadata.candidatesTokenCount || 0) + (raw.usageMetadata.thoughtsTokenCount || 0),
          total_tokens: raw.usageMetadata.totalTokenCount || 0,
          cache_read_input_tokens: raw.usageMetadata.cachedContentTokenCount || 0,
          prompt_tokens_details: raw.usageMetadata.cachedContentTokenCount ? {
            cached_tokens: raw.usageMetadata.cachedContentTokenCount
          } : void 0
        } : void 0
      };
      return jsonResponse(oaiResponse);
    } else if (apiType === "claude") {
      const raw = data.response || data;
      const candidate = raw.candidates?.[0];
      let contentOut = "";
      let thoughtOut = "";
      const contentBlocks = [];
      let thoughtSignatureForResponse = null;
      if (candidate?.content && Array.isArray(candidate.content.parts)) {
      const responseParts = candidate.content.parts;
      const hasExplicitThought = responseParts.some((p) => p["thought"] === true);
      for (let partIdx = 0; partIdx < responseParts.length; partIdx++) {
        const part = responseParts[partIdx];
          const sig = part["thoughtSignature"] || part["thought_signature"];
          if (sig && sig.length >= 50) {
            thoughtSignatureForResponse = sig;
          }
          if (part["thought"] === true) {
            thoughtOut += part.text || "";
          } else if (part.text) {
            if (!hasExplicitThought && mode === "antigravity" && partIdx === 0 && responseParts.length >= 2) {
              thoughtOut += part.text || "";
            } else {
              contentOut += part.text || "";
            }
          }
          if (part.functionCall) {
            const fc = part.functionCall;
            const name = fc.name || "unknown";
            const id = fc.id || `toolu_${generateRandomString(12)}`;
            contentBlocks.push({
              type: "tool_use",
              id,
              name,
              input: typeof fc.args === "object" ? fc.args : JSON.parse(fc.args || "{}")
            });
          }
        }
      }
      if (thoughtOut) {
        contentBlocks.push({
          type: "thinking",
          thinking: thoughtOut,
          signature: thoughtSignatureForResponse || "skip_thought_signature_validator"
        });
      }
      const hasOutputBlock = contentBlocks.some((b) => b.type === "text" || b.type === "tool_use");
      if (contentOut || !hasOutputBlock) {
        contentBlocks.push({
          type: "text",
          text: contentOut || ""
        });
      }
      const claudeResponse = {
        id: "msg_" + generateRandomString(24),
        type: "message",
        role: "assistant",
        model: inputModel,
        content: contentBlocks,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: raw.usageMetadata ? {
          input_tokens: Math.max(0, (raw.usageMetadata.promptTokenCount || 0) - (raw.usageMetadata.cachedContentTokenCount || 0)),
          output_tokens: (raw.usageMetadata.candidatesTokenCount || 0) + (raw.usageMetadata.thoughtsTokenCount || 0),
          cache_read_input_tokens: raw.usageMetadata.cachedContentTokenCount || 0
        } : void 0
      };
      return jsonResponse(claudeResponse);
    } else {
      return jsonResponse(data);
    }
  }
}
__name(handleApiProxy, "handleApiProxy");
__name2(handleApiProxy, "handleApiProxy");
async function getSessionUser(request, env) {
  const sessionId = getCookie(request, "session_id");
  if (!sessionId) return null;
  return await env.GEMINI_KV.get(`session:${sessionId}`);
}
__name(getSessionUser, "getSessionUser");
__name2(getSessionUser, "getSessionUser");
var worker_default = {
  async fetch(request, env, ctx) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Max-Age": "86400"
          }
        });
      }
      const url = new URL(request.url);
      if (url.pathname === "/") {
        return Response.redirect(`${url.origin}/login`, 302);
      }
      // Await routed handlers inside this try block. Returning their promises
      // directly bypasses the catch below when a handler rejects asynchronously,
      // which makes Cloudflare emit an opaque 1101 page instead of JSON.
      if (url.pathname === "/login") return await handleLogin(request, env);
      if (url.pathname === "/dashboard") return await handleDashboard(request, env);
      if (url.pathname === "/api/auth/google/start") return await startGoogleAuth(request, env);
      if (url.pathname === "/api/auth/google/callback") return await handleGoogleCallback(request, env, ctx);
      if (url.pathname === "/api/user/update") return await handleUserUpdate(request, env);
      if (url.pathname === "/api/user/account") return await handleAccountApi(request, env, ctx);
      if (url.pathname === "/api/antigravity/quota") return await handleAntigravityQuota(request, env, ctx);
      const parts = url.pathname.split("/").filter(Boolean);
      let customPath = null;
      let remainingPath = "";
      if (parts.length >= 2) {
        if (parts[0] !== "v1" && parts[0] !== "v1beta" && parts[0] !== "models") {
          customPath = parts[0];
          remainingPath = "/" + parts.slice(1).join("/");
        } else {
          remainingPath = "/" + parts.join("/");
        }
      } else if (parts.length === 1) {
        remainingPath = "/" + parts[0];
      }
      if (remainingPath.endsWith("/chat/completions/chat/completions")) {
        remainingPath = remainingPath.substring(0, remainingPath.length - "/chat/completions".length);
      }
      if (remainingPath === "/v1/models" || remainingPath === "/v1beta/models" || remainingPath === "/models") {
        return await handleModelsList(request, env, ctx, customPath);
      }
      let apiType = null;
      if (remainingPath === "/v1/chat/completions" || remainingPath === "/chat/completions") {
        apiType = "openai";
      } else if (remainingPath === "/v1/responses" || remainingPath === "/responses") {
        // OpenAI Responses uses the plural `/v1/responses` spelling.
        apiType = "openai-responses";
      } else if (remainingPath === "/v1/messages" || remainingPath === "/messages") {
        apiType = "claude";
      } else if (remainingPath.startsWith("/v1beta/models/") || remainingPath.startsWith("/v1/models/") || remainingPath.startsWith("/models/")) {
        apiType = "gemini";
      }
      if (apiType) {
        return await handleApiProxy(request, env, ctx, customPath, apiType);
      }
      return new Response("Not Found", { status: 404 });
    } catch (unhandledErr) {
      console.error("[Fatal Worker Exception]:", unhandledErr);
      return jsonResponse({
        error: {
          message: unhandledErr?.message || String(unhandledErr),
          type: "internal_worker_error"
        }
      }, 500);
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
