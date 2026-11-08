import { extractUsageFromText, normalizeTokenUsage } from "../api/audit-log-store.js";
import assert from "node:assert/strict";

// 1. OpenAI Responses SSE style
const sseResponses = "data: " + JSON.stringify({
  type: "response.completed",
  response: {
    usage: {
      input_tokens: 205646,
      output_tokens: 99,
      total_tokens: 205745,
      input_tokens_details: { cached_tokens: 202729 },
      output_tokens_details: { reasoning_tokens: 15 }
    }
  }
}) + "\n\ndata: [DONE]\n\n";

const resResponses = extractUsageFromText(sseResponses);
console.log("OpenAI Responses SSE:", resResponses);
assert.equal(resResponses.prompt_tokens, 205646);
assert.equal(resResponses.output_tokens, 99);
assert.equal(resResponses.cached_tokens, 202729);
assert.equal(resResponses.reasoning_tokens, 15);
assert.equal(resResponses.total_tokens, 205745);

// 2. OpenAI Chat Completions SSE style
const sseChat = "data: {\"choices\":[]}\n\ndata: " + JSON.stringify({
  id: "chatcmpl-123",
  choices: [],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    prompt_tokens_details: { cached_tokens: 30 }
  }
}) + "\n\ndata: [DONE]\n\n";

const resChat = extractUsageFromText(sseChat);
console.log("OpenAI Chat SSE:", resChat);
assert.equal(resChat.prompt_tokens, 100);
assert.equal(resChat.output_tokens, 50);
assert.equal(resChat.cached_tokens, 30);

// 3. Gemini SSE style
const sseGemini = "data: " + JSON.stringify({
  candidates: [{ content: { parts: [{ text: "hi" }] } }],
  usageMetadata: {
    promptTokenCount: 1000,
    candidatesTokenCount: 200,
    thoughtsTokenCount: 50,
    cachedContentTokenCount: 800,
    totalTokenCount: 1250
  }
}) + "\n\n";

const resGemini = extractUsageFromText(sseGemini);
console.log("Gemini SSE:", resGemini);
assert.equal(resGemini.prompt_tokens, 1000);
assert.equal(resGemini.output_tokens, 200);
assert.equal(resGemini.reasoning_tokens, 50);
assert.equal(resGemini.cached_tokens, 800);

console.log("ALL SSE USAGE EXTRACTION TESTS PASSED!");
