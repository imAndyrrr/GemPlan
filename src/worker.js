var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var CODEASSIST_OAUTH = {
  client_id: "YOUR_CODEASSIST_CLIENT_ID",
  client_secret: "YOUR_CODEASSIST_CLIENT_SECRET",
  redirect_uri: "http://localhost:8085/oauth2callback",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ].join(" ")
};
var ANTIGRAVITY_OAUTH = {
  client_id: "YOUR_ANTIGRAVITY_CLIENT_ID",
  client_secret: "YOUR_ANTIGRAVITY_CLIENT_SECRET",
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
      client_id: env?.ANTIGRAVITY_CLIENT_ID || ANTIGRAVITY_OAUTH.client_id,
      client_secret: env?.ANTIGRAVITY_CLIENT_SECRET || ANTIGRAVITY_OAUTH.client_secret,
      redirect_uri: env?.ANTIGRAVITY_REDIRECT_URI || ANTIGRAVITY_OAUTH.redirect_uri,
      scopes: ANTIGRAVITY_OAUTH.scopes
    };
  } else {
    return {
      client_id: env?.CODEASSIST_CLIENT_ID || CODEASSIST_OAUTH.client_id,
      client_secret: env?.CODEASSIST_CLIENT_SECRET || CODEASSIST_OAUTH.client_secret,
      redirect_uri: env?.CODEASSIST_REDIRECT_URI || CODEASSIST_OAUTH.redirect_uri,
      scopes: CODEASSIST_OAUTH.scopes
    };
  }
}
__name(getOauthConfig, "getOauthConfig");
__name2(getOauthConfig, "getOauthConfig");
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
var sleep = /* @__PURE__ */ __name2((ms) => new Promise((resolve) => setTimeout(resolve, ms)), "sleep");
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
  const googleForbiddenKeys = [
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
  for (const key of googleForbiddenKeys) {
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
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      const prev = merged[merged.length - 1];
      if (msg.content) {
        if (typeof prev.content === "string" && typeof msg.content === "string") {
          prev.content = (prev.content + "\n" + msg.content).trim();
        } else {
          let prevBlocks = Array.isArray(prev.content) ? prev.content : prev.content ? [{ type: "text", text: prev.content }] : [];
          let currBlocks = Array.isArray(msg.content) ? msg.content : msg.content ? [{ type: "text", text: msg.content }] : [];
          prev.content = prevBlocks.concat(currBlocks);
        }
      }
      if (msg.tool_calls) {
        prev.tool_calls = (prev.tool_calls || []).concat(msg.tool_calls);
      }
      if (msg.reasoning_content) {
        prev.reasoning_content = ((prev.reasoning_content || "") + "\n" + msg.reasoning_content).trim();
      }
    } else {
      merged.push({ ...msg, role });
    }
  }
  return merged;
}
__name(mergeOpenAIMessages, "mergeOpenAIMessages");
__name2(mergeOpenAIMessages, "mergeOpenAIMessages");
function mergeClaudeMessages(messages) {
  if (!messages || messages.length <= 1) return messages || [];
  const merged = [];
  for (const msg of messages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      const prev = merged[merged.length - 1];
      let prevBlocks = Array.isArray(prev.content) ? prev.content : [{ type: "text", text: prev.content || "" }];
      let currBlocks = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content || "" }];
      prev.content = prevBlocks.concat(currBlocks);
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
async function getSessionSignature(env, sessionId) {
  if (!sessionId) return null;
  const data = await env.GEMINI_KV.get(`sig:session:${sessionId}`, "json");
  return data ? data.signature : null;
}
__name(getSessionSignature, "getSessionSignature");
__name2(getSessionSignature, "getSessionSignature");
async function cacheSessionSignature(env, sessionId, signature, messageCount) {
  if (!sessionId || !signature || signature.length < 50) return;
  const key = `sig:session:${sessionId}`;
  const existing = await env.GEMINI_KV.get(key, "json");
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
    await env.GEMINI_KV.put(key, JSON.stringify({
      signature,
      message_count: messageCount
    }), { expirationTtl: 7200 });
  }
}

function extractThinkingParams(body) {
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
  return { thinkingBudget, thinkingLevel, reasoningEffort, thinkingObj, rawThinkingConfig, outputConfig };
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
        const fd = {
          name: t.function.name === "local_shell_call" ? "shell" : t.function.name,
          description: t.function.description || "",
          parameters: t.function.parameters ? structuredClone(t.function.parameters) : {}
        };
        optimizeAndCleanSchema(fd.parameters, needsUppercase);
        functionDeclarations.push(fd);
      }
    }
  } else if (apiType === "claude") {
    for (const t of body.tools) {
      if (t.name === "google_search" || t.name === "builtin_web_search") continue;
      if (t.name) {
        const fd = {
          name: t.name === "local_shell_call" ? "shell" : t.name,
          description: t.description || "",
          parameters: t.input_schema ? structuredClone(t.input_schema) : {}
        };
        optimizeAndCleanSchema(fd.parameters, needsUppercase);
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
async function callUpstream(method, requestHeaders, payload, isStream) {

  const baseUrls = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal",
    "https://daily-cloudcode-pa.googleapis.com/v1internal",
    "https://cloudcode-pa.googleapis.com/v1internal"
  ];
  let hasTriggeredDowngrade = false;
  let headersCopy = { ...requestHeaders };
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
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          return response;
        }
        const status = response.status;
        if (status === 403 && !hasTriggeredDowngrade && headersCopy["x-goog-user-project"]) {
          shouldRetryWithoutHeader = true;
          break;
        }
        const isRetryable = status === 429 || status === 408 || status === 404 || status >= 500;
        if (hasNext && isRetryable) {
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
      if (payload && payload.project) {
        payload.project = "";
      }
      hasTriggeredDowngrade = true;
      continue;
    }
    throw new Error(lastError || "All upstream endpoints failed");
  }
}
__name(callUpstream, "callUpstream");
__name2(callUpstream, "callUpstream");
async function processStream(readableStream, writableStream, apiType, modelName, env, sessionId, messageCount, ctx) {
  const reader = readableStream.getReader();
  const writer = writableStream.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let claudeStarted = false;
  let claudeTextIndex = 0;
  let currentBlockType = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop();
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
              if (sig && sig.length >= 50) {
                ctx.waitUntil(cacheSessionSignature(env, sessionId, sig, messageCount));
              }
            }
          }
          if (apiType === "gemini") {
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}

`));
          } else if (apiType === "openai") {
            if (Array.isArray(parts)) {
              for (const part of parts) {
                const isThought = part["thought"] === true;
                if (part.text) {
                  const oaiChunk = {
                    id: "chatcmpl-" + generateRandomString(12),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1e3),
                    model: modelName,
                    choices: [{
                      index: 0,
                      delta: isThought ? { reasoning_content: part.text } : { content: part.text }
                    }]
                  };
                  await writer.write(encoder.encode(`data: ${JSON.stringify(oaiChunk)}

`));
                }
                if (part.functionCall) {
                  const fc = part.functionCall;
                  const name = fc.name || "unknown";
                  const id = fc.id || `call_${name}_${generateRandomString(8)}`;
                  const oaiChunk = {
                    id: "chatcmpl-" + generateRandomString(12),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1e3),
                    model: modelName,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          id,
                          type: "function",
                          function: {
                            name,
                            arguments: typeof fc.args === "object" ? JSON.stringify(fc.args) : fc.args || "{}"
                          }
                        }]
                      }
                    }]
                  };
                  await writer.write(encoder.encode(`data: ${JSON.stringify(oaiChunk)}

`));
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
              } else if (upperReason === "OTHER" || upperReason === "FINISH_REASON_UNSPECIFIED") {
                oaiFinishReason = "other";
              } else if (upperReason === "STOP") {
                oaiFinishReason = "stop";
              }
              const oaiChunk = {
                id: "chatcmpl-" + generateRandomString(12),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1e3),
                model: modelName,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: oaiFinishReason
                }]
              };
              await writer.write(encoder.encode(`data: ${JSON.stringify(oaiChunk)}

`));
            }
          } else if (apiType === "claude") {
            if (!claudeStarted) {
              await writer.write(encoder.encode(`data: ${JSON.stringify({
                type: "message_start",
                message: {
                  id: "msg_" + generateRandomString(24),
                  type: "message",
                  role: "assistant",
                  model: modelName,
                  content: [],
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 }
                }
              })}

`));
              claudeStarted = true;
            }
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part.text) {
                  const isThought = part["thought"] === true;
                  if (isThought) {
                    if (currentBlockType !== "thinking") {
                      if (currentBlockType !== null) {
                        await writer.write(encoder.encode(`data: ${JSON.stringify({
                          type: "content_block_stop",
                          index: claudeTextIndex
                        })}

`));
                        claudeTextIndex++;
                      }
                      const sig = part["thoughtSignature"] || part["thought_signature"] || (sessionId ? await getSessionSignature(env, sessionId) : null) || "skip_thought_signature_validator";
                      await writer.write(encoder.encode(`data: ${JSON.stringify({
                        type: "content_block_start",
                        index: claudeTextIndex,
                        content_block: { type: "thinking", thinking: "", signature: sig }
                      })}

`));
                      currentBlockType = "thinking";
                    }
                    await writer.write(encoder.encode(`data: ${JSON.stringify({
                      type: "content_block_delta",
                      index: claudeTextIndex,
                      delta: { type: "thinking_delta", thinking: part.text }
                    })}

`));
                  } else {
                    if (currentBlockType !== "text") {
                      if (currentBlockType !== null) {
                        await writer.write(encoder.encode(`data: ${JSON.stringify({
                          type: "content_block_stop",
                          index: claudeTextIndex
                        })}

`));
                        claudeTextIndex++;
                      }
                      await writer.write(encoder.encode(`data: ${JSON.stringify({
                        type: "content_block_start",
                        index: claudeTextIndex,
                        content_block: { type: "text", text: "" }
                      })}

`));
                      currentBlockType = "text";
                    }
                    await writer.write(encoder.encode(`data: ${JSON.stringify({
                      type: "content_block_delta",
                      index: claudeTextIndex,
                      delta: { type: "text_delta", text: part.text }
                    })}

`));
                  }
                }
                if (part.functionCall) {
                  if (currentBlockType !== null) {
                    await writer.write(encoder.encode(`data: ${JSON.stringify({
                      type: "content_block_stop",
                      index: claudeTextIndex
                    })}

`));
                    claudeTextIndex++;
                    currentBlockType = null;
                  }
                  const fc = part.functionCall;
                  const name = fc.name || "unknown";
                  const id = fc.id || `toolu_${generateRandomString(12)}`;
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    type: "content_block_start",
                    index: claudeTextIndex,
                    content_block: {
                      type: "tool_use",
                      id,
                      name,
                      input: typeof fc.args === "object" ? fc.args : JSON.parse(fc.args || "{}")
                    }
                  })}

`));
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    type: "content_block_stop",
                    index: claudeTextIndex
                  })}

`));
                  claudeTextIndex++;
                }
              }
            }
          }
        } catch (e) {
        }
      }
    }
    if (apiType === "openai") {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } else if (apiType === "claude") {
      if (currentBlockType !== null) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: "content_block_stop",
          index: claudeTextIndex
        })}

`));
      }
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 }
      })}

`));
      await writer.write(encoder.encode(`data: ${JSON.stringify({
        type: "message_stop"
      })}

`));
    }
  } finally {
    await writer.close();
  }
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
async function streamSimulatedResponse(data, apiType, inputModel, writer, encoder, env, sessionId, messageCount, ctx) {
  try {
    const raw = data.response || data;
    const candidate = raw.candidates?.[0];
    let contentOut = "";
    let thoughtOut = "";
    let thoughtSignature = null;
    const toolCalls = [];
    if (candidate?.content && Array.isArray(candidate.content.parts)) {
      const hasExplicitThought = candidate.content.parts.some((p) => p["thought"] === true);
      for (const part of candidate.content.parts) {
        const sig = part["thoughtSignature"] || part["thought_signature"];
        if (sig && sig.length >= 50) {
          thoughtSignature = sig;
          if (sessionId && env && ctx) {
            ctx.waitUntil(cacheSessionSignature(env, sessionId, sig, messageCount));
          }
        }
        if (part["thought"] === true) {
          thoughtOut += part.text || "";
        } else if (part.text) {
          if (!hasExplicitThought && candidate.content.parts.indexOf(part) === 0 && candidate.content.parts.length >= 2) {
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
      if (thoughtOut) {
        await streamTextChunks(
          thoughtOut,
          writer,
          encoder,
          (slice) => ({
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1e3),
            model: inputModel,
            choices: [{ index: 0, delta: { reasoning_content: slice } }]
          }),
          24,
          10
        );
      }
      if (contentOut) {
        await streamTextChunks(
          contentOut,
          writer,
          encoder,
          (slice) => ({
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1e3),
            model: inputModel,
            choices: [{ index: 0, delta: { content: slice } }]
          }),
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
          usage: { input_tokens: 0, output_tokens: 0 }
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
          await streamTextChunks(
            contentOut,
            writer,
            encoder,
            (slice) => ({
              type: "content_block_delta",
              index: blockIndex,
              delta: { type: "text_delta", text: slice }
            }),
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
        usage: { output_tokens: 0 }
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
      console.log(`[DEBUG] Created user '${username}' with API Key: '${user.api_config.api_key}' and Custom Path: '/${user.api_config.custom_path}'`);
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
  const codeassist_pattern = user.api_config.codeassist_pattern || "{modelname}";
  const antigravity_pattern = user.api_config.antigravity_pattern || "{modelname}-agy";
  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>\u63A7\u5236\u53F0</title>
    <style>body{font-family:sans-serif;max-width:600px;margin:20px auto;line-height:1.6;} .card{border:1px solid #ddd;padding:20px;border-radius:8px;margin-bottom:20px;} input,button{padding:8px;margin-top:5px;width:100%;box-sizing:border-box;} button{background:#007bff;color:#fff;border:none;cursor:pointer;font-weight:bold;} .status{color:green;font-weight:bold;} .sub-mode{border-left:4px solid #007bff;padding-left:15px;margin-bottom:15px;}</style>
    </head><body>
    <h1>\u6B22\u8FCE, ${username}</h1>
    <h3>GemPlan\u5C06\u4F7F\u7528GoogleOAuth\u7684GeminiCodeAssist\u53CAAntigravity\u8C03\u7528\u5C01\u88C5\u4E3AAPI.</h3>
    <p>\u5236\u4F5C\u4EBA\uFF1Azjq<br>
	\u53C2\u8003\u9879\u76EE\uFF1Aglowingjade/obsidian-smart-composer\uFF1Blbjlaq/Antigravity-Manager</p>
    
    <div class="card">
      <h3>\u7B2C\u4E00\u90E8\u5206\uFF1A\u4FEE\u6539\u5BC6\u7801</h3>
      <form action="/api/user/update" method="POST">
        <input type="hidden" name="action" value="password">
        <input type="password" name="new_password" placeholder="\u65B0\u5BC6\u7801" required>
        <button type="submit">\u4FEE\u6539\u5BC6\u7801</button>
      </form>
    </div>

    <div class="card">
      <h3>\u7B2C\u4E8C\u90E8\u5206\uFF1AGoogle OAuth \u51ED\u8BC1\u7ED1\u5B9A</h3>
      <p style="font-size:12px;color:#666;">\u7531\u4E8EGoogle\u6388\u6743\u9650\u5236\uFF0C\u70B9\u51FB\u6309\u94AE\u6388\u6743\u540E\uFF0C\u9875\u9762\u4F1A\u8DF3\u8F6C\u5230\u4E00\u4E2A\u6253\u4E0D\u5F00\u7684 localhost \u94FE\u63A5\u3002\u8BF7<b>\u590D\u5236\u6574\u4E2A\u6253\u4E0D\u5F00\u9875\u9762\u7684\u7F51\u5740</b>\uFF0C\u7C98\u8D34\u5230\u4E0B\u65B9\u5373\u53EF\u3002</p>
      
      <div class="sub-mode">
        <h4>1. CodeAssist \u6A21\u5F0F</h4>
        <p>\u5F53\u524D\u72B6\u6001\uFF1A${user.google_tokens ? '<span class="status">\u2705 \u5DF2\u7ED1\u5B9A Google \u8D26\u53F7</span>' : '<span style="color:red">\u274C \u672A\u7ED1\u5B9A</span>'}</p>
        <button onclick="window.open('/api/auth/google/start?mode=codeassist', '_blank')">\u524D\u5F80\u6388\u6743 CodeAssist \u6A21\u5F0F</button>
      </div>

      <div class="sub-mode" style="border-left-color: #28a745;">
        <h4>2. Antigravity \u6A21\u5F0F (\u652F\u6301 Claude & \u6DF1\u5EA6\u601D\u8003\u9884\u7B97)</h4>
        <p>\u5F53\u524D\u72B6\u6001\uFF1A${user.antigravity_tokens ? '<span class="status">\u2705 \u5DF2\u7ED1\u5B9A Google \u8D26\u53F7</span>' : '<span style="color:red">\u274C \u672A\u7ED1\u5B9A</span>'}</p>
        <button onclick="window.open('/api/auth/google/start?mode=antigravity', '_blank')" style="background:#28a745;">\u524D\u5F80\u6388\u6743 Antigravity \u6A21\u5F0F</button>
      </div>

      <form action="/api/auth/google/callback" method="POST" style="margin-top:15px; border-top:1px solid #ddd; padding-top:15px;">
        <label><b>\u63D0\u4EA4\u6388\u6743\u7ED3\u679C\uFF1A</b></label>
        <input type="text" name="redirect_url" placeholder="\u5C06\u6253\u4E0D\u5F00\u7684 localhost \u7F51\u5740\u7C98\u8D34\u5230\u8FD9\u91CC (\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u8BC6\u522B\u5339\u914D\u6A21\u5F0F)" required>
        <button type="submit" style="background:#17a2b8; margin-top:10px;">\u63D0\u4EA4\u51ED\u8BC1\u5E76\u4FDD\u5B58</button>
      </form>
    </div>

    <div class="card">
      <h3>\u7B2C\u4E09\u90E8\u5206\uFF1AAPI \u7AEF\u70B9\u4E0E\u6A21\u5F0F\u8BBE\u7F6E</h3>
      <form action="/api/user/update" method="POST">
        <input type="hidden" name="action" value="api_config">
        
        <label>\u60A8\u7684\u4E13\u5C5E\u7AEF\u70B9\u8DEF\u5F84 (\u81EA\u5B9A\u4E49):</label>
        <input type="text" name="custom_path" value="${user.api_config.custom_path}" required>
        
        <label>API \u5BC6\u94A5 (API Key):</label>
        <input type="text" name="api_key" value="${user.api_config.api_key}" required>
        
        <label>CodeAssist \u6A21\u5F0F\u5339\u914D\u6A21\u578B\u540D:</label>
        <input type="text" name="codeassist_pattern" value="${codeassist_pattern}" placeholder="{modelname}" required>
        
        <label>Antigravity \u6A21\u5F0F\u5339\u914D\u6A21\u578B\u540D:</label>
        <input type="text" name="antigravity_pattern" value="${antigravity_pattern}" placeholder="{modelname}-agy" required>
        
        <button type="submit" style="margin-top:15px;">\u4FDD\u5B58\u914D\u7F6E</button>
      </form>
      <div style="background:#f4f4f4;padding:10px;margin-top:10px;font-size:13px;word-break:break-all;">
        <b>\u8C03\u7528\u8BF4\u660E:</b><br>
        OpenAI \u683C\u5F0F: <code>https://${new URL(request.url).host}/${user.api_config.custom_path}/v1/chat/completions</code><br>
        Claude \u683C\u5F0F: <code>https://${new URL(request.url).host}/${user.api_config.custom_path}/v1/messages</code><br>
        Gemini \u683C\u5F0F: <code>https://${new URL(request.url).host}/${user.api_config.custom_path}/v1beta/models/{modelname}:generateContent</code><br>
        Auth Header: <code>Authorization: Bearer ${user.api_config.api_key}</code>
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
async function startGoogleAuth(request, env) {
  const username = await getSessionUser(request, env);
  if (!username) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "codeassist";
  const oauthConfig = getOauthConfig(mode, env);
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
    prompt: "consent",
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
  const oauthData = await env.GEMINI_KV.get(`oauth:${state}`, "json");
  if (!oauthData || oauthData.username !== username) {
    return new Response("OAuth \u72B6\u6001\u5F02\u5E38\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u8BD5", { status: 400 });
  }
  const mode = oauthData.mode || "codeassist";
  const oauthConfig = getOauthConfig(mode, env);
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
  let user = await env.GEMINI_KV.get(`user:${username}`, "json");
  const tokenPayload = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Math.floor(Date.now() / 1e3) + tokenData.expires_in,
    project_id: projectId || ""
  };
  if (mode === "antigravity") {
    user.antigravity_tokens = tokenPayload;
  } else {
    user.google_tokens = tokenPayload;
  }
  await env.GEMINI_KV.put(`user:${username}`, JSON.stringify(user));
  await env.GEMINI_KV.delete(`oauth:${state}`);
  return new Response(`
    <h2>Google \u6388\u6743\u6210\u529F\uFF01[${mode === "antigravity" ? "Antigravity" : "CodeAssist"}]</h2>
    <p>\u51ED\u8BC1\u5DF2\u56FA\u5316\u4FDD\u5B58\u3002\u8BF7\u5173\u95ED\u6B64\u9875\u9762\u5E76\u5237\u65B0\u63A7\u5236\u53F0\u3002</p>
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
async function handleModelsList(request) {
  const models = [
    "gemini-3.5-flash-low",
    "gemini-3.5-flash",
    "gpt-4o",
    "claude-3-5-sonnet-20241022",
    "claude-opus-4"
  ];
  return jsonResponse({
    object: "list",
    data: models.map((m) => ({ id: m, object: "model", created: 1715644800, owned_by: "system" }))
  });
}
__name(handleModelsList, "handleModelsList");
__name2(handleModelsList, "handleModelsList");
async function handleApiProxy(request, env, ctx, customPath, apiType) {
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
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }
  const inputModel = body.model || "gemini-3-flash-preview";
  const sessionId = body.user ? deriveSessionId(body.user) : username ? deriveSessionId(username) : "default_session";
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
  const tokens = mode === "antigravity" ? user.antigravity_tokens : user.google_tokens;
  if (!tokens) {
    return jsonResponse({ error: `Google OAuth not configured for mode: ${mode}` }, 403);
  }
  let { access_token, refresh_token, expires_at, project_id } = tokens;
  if (Math.floor(Date.now() / 1e3) + 60 >= expires_at) {
    const oauthConfig = getOauthConfig(mode, env);
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
    if (tokenRes.ok) {
      const td = await tokenRes.json();
      access_token = td.access_token;
      tokens.access_token = access_token;
      tokens.refresh_token = td.refresh_token || refresh_token;
      tokens.expires_at = Math.floor(Date.now() / 1e3) + td.expires_in;
      if (mode === "antigravity") {
        user.antigravity_tokens = tokens;
      } else {
        user.google_tokens = tokens;
      }
      ctx.waitUntil(env.GEMINI_KV.put(`user:${username}`, JSON.stringify(user)));
    } else {
      return jsonResponse({ error: `Token refresh failed for mode ${mode}. Please re-auth in Dashboard.` }, 401);
    }
  }
  const isStream = body.stream === true;
  let cloudCodePayload;
  let requestHeaders = {
    "Authorization": `Bearer ${access_token}`,
    "Content-Type": "application/json"
  };
  const projectId = tokens.project_id || "";
  let resolvedModel = physicalModel;
  let contents = [];
  let systemInstructionText = "";
  let toolsPayload = void 0;
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
        const t = fm.content.trim();
        if (t.startsWith("[") && t.endsWith("]")) {
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
    const actualIncludeThinking = shouldEnableThinking(body, resolvedModel, apiType);
    const cachedSig = await getSessionSignature(env, sessionId);
    contents = mergedMessages.map((m) => {
      const parts = [];
      if (m.reasoning_content && m.reasoning_content !== "[undefined]") {
        // Skip reasoning content in history to prevent signature validation errors
      } else if (actualIncludeThinking && m.role === "assistant") {
        // Skip thinking placeholder in history to prevent signature validation errors
      }
      if (m.content) {
        if (typeof m.content === "string") {
          if (m.content.trim() !== "") {
            parts.push({ text: m.content });
          }
        } else if (Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block.type === "text") {
              if (block.text && block.text.trim() !== "") {
                parts.push({ text: block.text });
              }
            } else if (block.type === "image_url" || block.type === "input_image") {
              const imgUrl = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
              if (imgUrl) {
                if (imgUrl.startsWith("data:")) {
                  const commaIdx = imgUrl.indexOf(",");
                  if (commaIdx !== -1) {
                    const mimeType = imgUrl.substring(5, imgUrl.indexOf(";")) || "image/jpeg";
                    const data = imgUrl.substring(commaIdx + 1);
                    parts.push({ inlineData: { mimeType, data } });
                  }
                } else {
                  parts.push({ fileData: { fileUri: imgUrl, mimeType: "image/jpeg" } });
                }
              }
            }
          }
        }
      }
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          let name = tc.function.name;
          if (name === "local_shell_call") name = "shell";
          let args = {};
          try {
            args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments || {};
          } catch (e) {
          }
          const funcPart = {
            functionCall: {
              name,
              args,
              id: tc.id
            }
          };
          if (actualIncludeThinking) {
            // Skip attaching fake thought signatures to function calls to bypass Vertex Claude signature validation errors
          }
          parts.push(funcPart);
        }
      }
      if (m.role === "tool") {
        const name = m.name || toolIdToName[m.tool_call_id] || "unknown";
        const finalName = m.tool_call_id ? toolIdToName[m.tool_call_id] || name : name;
        if (Array.isArray(m.content)) {
          const textParts = [];
          for (const blk of m.content) {
            if (blk.type === "text" && blk.text) {
              textParts.push(blk.text);
            } else if (blk.type === "image_url" || blk.type === "input_image") {
              const imgUrl = typeof blk.image_url === "string" ? blk.image_url : blk.image_url?.url;
              if (imgUrl) {
                if (imgUrl.startsWith("data:")) {
                  const commaIdx = imgUrl.indexOf(",");
                  if (commaIdx !== -1) {
                    const mimeType = imgUrl.substring(5, imgUrl.indexOf(";")) || "image/jpeg";
                    const data = imgUrl.substring(commaIdx + 1);
                    parts.push({ inlineData: { mimeType, data } });
                  }
                } else {
                  parts.push({ fileData: { fileUri: imgUrl, mimeType: blk.media_type || "image/jpeg" } });
                }
              }
            }
          }
          if (textParts.length > 0) {
            parts.push({
              functionResponse: {
                name: finalName,
                response: { result: textParts.join("\n") },
                id: m.tool_call_id || ""
              }
            });
          }
        } else {
          parts.push({
            functionResponse: {
              name: finalName,
              response: { result: m.content || "" },
              id: m.tool_call_id || ""
            }
          });
        }
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts
      };
    }).filter((c) => c.parts.length > 0);
    const isClaudeModel = resolvedModel.toLowerCase().includes("claude");
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
        const t = m.content.trim();
        if (t.startsWith("[") && t.endsWith("]")) {
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
    const actualIncludeThinking = shouldEnableThinking(body, resolvedModel, apiType);
    const cachedSig = await getSessionSignature(env, sessionId);
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
            if (block.text && block.text.trim() !== "") {
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
                if (rb.type === "text" && rb.text) {
                  resultText += (resultText ? "\n" : "") + rb.text;
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
    contents = [];
    if (body.contents && Array.isArray(body.contents)) {
      const cachedSig = await getSessionSignature(env, sessionId);
      const actualIncludeThinking = shouldEnableThinking(body, resolvedModel, apiType);
      contents = body.contents.map((m) => {
        if (!m.parts || !Array.isArray(m.parts)) return m;
        const parts = m.parts.map((part) => {
          if (part.functionCall) {
            const funcPart = { ...part };
            if (actualIncludeThinking) {
              funcPart.thoughtSignature = part.thoughtSignature || part.thought_signature || cachedSig || "skip_thought_signature_validator";
              funcPart.thought_signature = part.thoughtSignature || part.thought_signature || cachedSig || "skip_thought_signature_validator";
            }
            return funcPart;
          }
          return part;
        });
        return { ...m, parts };
      });
    }
    if (body.systemInstruction?.parts?.[0]?.text) {
      systemInstructionText = body.systemInstruction.parts[0].text;
    }
    if (body.tools && Array.isArray(body.tools)) {
      const clonedTools = structuredClone(body.tools);
      for (const t of clonedTools) {
        if (t.functionDeclarations && Array.isArray(t.functionDeclarations)) {
          for (const fd of t.functionDeclarations) {
            if (fd.parameters) {
              const defs = collectAllDefs(fd.parameters);
              if (Object.keys(defs).length > 0) {
                resolveRefs(fd.parameters, defs);
                recursiveDeleteRefsAndDefs(fd.parameters);
              }
              convertConstToEnum(fd.parameters);
              cleanJsonSchema(fd.parameters, false);
              uppercaseSchemaTypes(fd.parameters);
            }
          }
        }
      }
      toolsPayload = clonedTools;
    } else {
      toolsPayload = body.tools;
    }
  }
  if (mode === "antigravity") {
    if (!user.machine_id) {
      user.machine_id = crypto.randomUUID();
      ctx.waitUntil(env.GEMINI_KV.put(`user:${username}`, JSON.stringify(user)));
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
          let schemaClone = structuredClone(body.response_format.json_schema.schema);
          if (resolvedModel && resolvedModel.toLowerCase().includes("claude")) {
            const defs = collectAllDefs(schemaClone);
            if (Object.keys(defs).length > 0) {
              resolveRefs(schemaClone, defs);
              recursiveDeleteRefsAndDefs(schemaClone);
            }
            cleanJsonSchema(schemaClone, true);
          } else {
            cleanJsonSchema(schemaClone);
          }
          genConfig.responseSchema = schemaClone;
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
      toolConfig: apiType === "gemini" ? body.toolConfig || { functionCallingConfig: { mode: "AUTO" } } : { functionCallingConfig: { mode: "AUTO" } },
      tools: toolsPayload,
      sessionId
    };
    if (contents && Array.isArray(contents)) {
      const cachedSig = await getSessionSignature(env, sessionId);
      const actualIncludeThinking = shouldEnableThinking(body, resolvedModel, apiType);
      innerRequest.contents = contents.map((m) => {
        if (!m.parts || !Array.isArray(m.parts)) return m;
        const parts = m.parts.map((part) => {
          if (part.functionCall) {
            const funcPart = { ...part };
            if (actualIncludeThinking) {
              funcPart.thoughtSignature = part.thoughtSignature || part.thought_signature || cachedSig || "skip_thought_signature_validator";
              funcPart.thought_signature = part.thoughtSignature || part.thought_signature || cachedSig || "skip_thought_signature_validator";
            }
            return funcPart;
          }
          return part;
        });
        return { ...m, parts };
      });
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
          let schemaClone = structuredClone(body.response_format.json_schema.schema);
          if (resolvedModel && resolvedModel.toLowerCase().includes("claude")) {
            const defs = collectAllDefs(schemaClone);
            if (Object.keys(defs).length > 0) {
              resolveRefs(schemaClone, defs);
              recursiveDeleteRefsAndDefs(schemaClone);
            }
            cleanJsonSchema(schemaClone, true);
          } else {
            cleanJsonSchema(schemaClone);
          }
          genConfig.responseSchema = schemaClone;
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
      toolConfig: toolsPayload ? { functionCallingConfig: { mode: "VALIDATED" } } : void 0,
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
  const isClaudeModel = resolvedModel.toLowerCase().includes("claude");
  // Antigravity + Claude 模型不支持 SSE 流式接口，必须用非流式再模拟
  // Antigravity + Gemini 模型支持 streamGenerateContent，用真流式以节省内存
  const useStreamUpstream = isStream && (mode === "codeassist" || !isClaudeModel);
  const method = useStreamUpstream ? "streamGenerateContent" : "generateContent";
  let googleRes;
  try {
    googleRes = await callUpstream(method, requestHeaders, cloudCodePayload, useStreamUpstream);
  } catch (err) {
    return jsonResponse({ error: err.message || err }, 500);
  }
  if (!googleRes.ok) {
    const errorText = await googleRes.text();
    return new Response(errorText, {
      status: googleRes.status,
      headers: {
        "Content-Type": googleRes.headers.get("Content-Type") || "text/plain;charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*"
      }
    });
  }
  if (isStream) {
    const { readable, writable } = new TransformStream();
    if (!useStreamUpstream) {
      // Antigravity + Claude：上游非流式，本地模拟流式
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      ctx.waitUntil((async () => {
        try {
          const data = await googleRes.json();
          await streamSimulatedResponse(data, apiType, inputModel, writer, encoder, env, sessionId, messageCount, ctx);
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
          await processStream(googleRes.body, writable, apiType, inputModel, env, sessionId, messageCount, ctx);
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
    const data = await googleRes.json();
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
        ctx.waitUntil(cacheSessionSignature(env, sessionId, responseSig, messageCount));
      }
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
            const hasExplicitThought = candidate.content.parts.some((p) => p["thought"] === true);
            for (const part of candidate.content.parts) {
              if (part["thought"] === true) {
                thoughtOut += part.text || "";
              } else if (part.text) {
                if (!hasExplicitThought && mode === "antigravity" && candidate.content.parts.indexOf(part) === 0 && candidate.content.parts.length >= 2) {
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
          completion_tokens: raw.usageMetadata.candidatesTokenCount || 0,
          total_tokens: raw.usageMetadata.totalTokenCount || 0
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
        const hasExplicitThought = candidate.content.parts.some((p) => p["thought"] === true);
        for (const part of candidate.content.parts) {
          const sig = part["thoughtSignature"] || part["thought_signature"];
          if (sig && sig.length >= 50) {
            thoughtSignatureForResponse = sig;
          }
          if (part["thought"] === true) {
            thoughtOut += part.text || "";
          } else if (part.text) {
            if (!hasExplicitThought && mode === "antigravity" && candidate.content.parts.indexOf(part) === 0 && candidate.content.parts.length >= 2) {
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
          input_tokens: raw.usageMetadata.promptTokenCount || 0,
          output_tokens: raw.usageMetadata.candidatesTokenCount || 0
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
    if (url.pathname === "/login") return handleLogin(request, env);
    if (url.pathname === "/dashboard") return handleDashboard(request, env);
    if (url.pathname === "/api/auth/google/start") return startGoogleAuth(request, env);
    if (url.pathname === "/api/auth/google/callback") return handleGoogleCallback(request, env, ctx);
    if (url.pathname === "/api/user/update") return handleUserUpdate(request, env);
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
      return handleModelsList(request);
    }
    let apiType = null;
    if (remainingPath === "/v1/chat/completions" || remainingPath === "/chat/completions") {
      apiType = "openai";
    } else if (remainingPath === "/v1/messages" || remainingPath === "/messages") {
      apiType = "claude";
    } else if (remainingPath.startsWith("/v1beta/models/") || remainingPath.startsWith("/v1/models/") || remainingPath.startsWith("/models/")) {
      apiType = "gemini";
    }
    if (apiType) {
      return handleApiProxy(request, env, ctx, customPath, apiType);
    }
    return new Response("Not Found", { status: 404 });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
