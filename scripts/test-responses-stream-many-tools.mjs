import assert from "node:assert/strict";
import worker from "../src/worker.js";
import {
  peekResponsesSseUntilMeaningful,
  processResponsesSseStream
} from "../src/responses-stream.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function googleSse(parts, finishReason) {
  return {
    response: {
      candidates: [{
        content: { role: "model", parts },
        ...(finishReason ? { finishReason } : {})
      }],
      ...(finishReason ? {
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
          thoughtsTokenCount: 50,
          totalTokenCount: 1550
        }
      } : {})
    }
  };
}

function sseLine(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function chunkedReadable(bytes, chunkSize = 37) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, offset + chunkSize);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    }
  });
}

function parseSseEvents(body) {
  const events = [];
  for (const block of body.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine || dataLine === "data: [DONE]") continue;
    events.push(JSON.parse(dataLine.slice(6)));
  }
  return events;
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class MockKV {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
  }

  async get(key, type) {
    const value = this.store.get(key);
    if (value == null) return null;
    if (type === "json") return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }
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

{
  let upstreamController;
  const source = new ReadableStream({
    start(controller) {
      upstreamController = controller;
      controller.enqueue(encoder.encode(
        `: keep-alive\n\ndata: {"response":{"candidates":[]}}\n\n` +
        sseLine(googleSse([{ functionCall: { id: "call_peek", name: "lookup", args: "{\"query\":\"first\"}" } }])) +
        `data: {"response":{"candidates":[{"content":{"parts":[{"text":"partial`
      ));
    }
  });
  const peeked = await withTimeout(peekResponsesSseUntilMeaningful(source), 1000, "early peek");
  assert.equal(peeked.hasAnyContent, true);
  assert.ok(peeked.stream, "meaningful prefix must be preserved in the continuation stream");
  upstreamController.enqueue(encoder.encode(` chunk\"}]}}]}}\n\n`));
  upstreamController.close();
  const preserved = await new Response(peeked.stream).text();
  assert.match(preserved, /call_peek/);
  assert.match(preserved, /partial chunk/);
  console.log("PASS: Responses stream commits after first meaningful event without buffering completion");
}

{
  const empty = chunkedReadable(encoder.encode(`: empty\ndata: [DONE]\n\n`));
  const peeked = await withTimeout(peekResponsesSseUntilMeaningful(empty), 1000, "empty peek");
  assert.deepEqual(peeked, { stream: null, hasAnyContent: false });
  console.log("PASS: empty Responses stream remains detectable for retry/failover");
}

{
  const callCount = 512;
  const signature = "S".repeat(64);
  const expected = [];
  const sourceLines = [];
  for (let index = 0; index < callCount; index++) {
    const args = JSON.stringify({
      index,
      command: `execute-${index}`,
      padding: "x".repeat(192)
    });
    const splitAt = Math.floor(args.length / 2);
    const id = `call_${index}`;
    expected.push({ id, args, name: `tool_${index % 8}` });
    sourceLines.push(sseLine(googleSse([{
      functionCall: { id, name: `tool_${index % 8}`, args: args.slice(0, splitAt) }
    }])));
    sourceLines.push(sseLine(googleSse([{
      functionCall: { id, name: `tool_${index % 8}`, args: args.slice(splitAt) },
      thoughtSignature: signature
    }], index === callCount - 1 ? "STOP" : void 0)));
  }
  sourceLines.push("data: [DONE]\n\n");
  const sourceBytes = encoder.encode(sourceLines.join(""));
  const { readable, writable } = new TransformStream();
  const startedAt = Date.now();
  const processing = processResponsesSseStream(
    chunkedReadable(sourceBytes, 257),
    writable,
    "gemini-3.8-flash-high-agy",
    "antigravity"
  );
  const bodyPromise = new Response(readable).text();
  const completedOk = await withTimeout(processing, 5000, "many-tool stream processing");
  const body = await withTimeout(bodyPromise, 5000, "many-tool response consumption");
  const elapsedMs = Date.now() - startedAt;
  assert.equal(completedOk, true);
  assert.ok(elapsedMs < 5000, `many-tool conversion took ${elapsedMs}ms`);
  assert.equal(body.match(/^data: \[DONE\]$/gm)?.length, 1, "exactly one terminal marker is required");

  const events = parseSseEvents(body);
  const sequenceNumbers = events.map((event) => event.sequence_number);
  assert.ok(sequenceNumbers.every((value, index) =>
    Number.isInteger(value) && (index === 0 || value === sequenceNumbers[index - 1] + 1)
  ));
  assert.equal(events.filter((event) => event.type === "response.created").length, 1);
  assert.equal(events.filter((event) => event.type === "response.in_progress").length, 1);
  assert.equal(events.filter((event) => event.type === "response.completed").length, 1);

  const addedCalls = events.filter((event) =>
    event.type === "response.output_item.added" && event.item?.type === "function_call"
  );
  const doneCalls = events.filter((event) =>
    event.type === "response.output_item.done" && event.item?.type === "function_call"
  );
  const argumentDones = events.filter((event) => event.type === "response.function_call_arguments.done");
  assert.equal(addedCalls.length, callCount);
  assert.equal(doneCalls.length, callCount);
  assert.equal(argumentDones.length, callCount);

  const itemIdToIndex = new Map();
  for (let index = 0; index < addedCalls.length; index++) {
    const event = addedCalls[index];
    assert.equal(event.output_index, index);
    itemIdToIndex.set(event.item.id, index);
  }

  const assembledArgs = Array(callCount).fill("");
  for (const event of events) {
    if (event.type !== "response.function_call_arguments.delta") continue;
    const index = itemIdToIndex.get(event.item_id);
    assert.ok(Number.isInteger(index), "argument delta referenced an unknown tool call");
    assembledArgs[index] += event.delta;
  }
  for (let index = 0; index < callCount; index++) {
    assert.equal(assembledArgs[index], expected[index].args, `arguments crossed at tool ${index}`);
  }

  for (const event of argumentDones) {
    const index = itemIdToIndex.get(event.item_id);
    assert.equal(event.output_index, index);
    assert.equal(event.arguments, expected[index].args);
    assert.equal(doneCalls[index].item.call_id, `${expected[index].id}|${signature}`);
    assert.equal(doneCalls[index].item.name, expected[index].name);
    assert.equal(doneCalls[index].item.arguments, expected[index].args);
  }

  const completed = events.find((event) => event.type === "response.completed");
  assert.equal(completed.response.output.length, callCount);
  for (let index = 0; index < callCount; index++) {
    const item = completed.response.output[index];
    assert.equal(item.type, "function_call");
    assert.equal(item.call_id, `${expected[index].id}|${signature}`);
    assert.equal(item.arguments, expected[index].args);
  }
  assert.equal(completed.response.usage.total_tokens, 1550);
  console.log(`PASS: ${callCount} fragmented tool calls stay isolated in ${elapsedMs}ms`);
}

{
  const account = {
    id: "acc_responses_early",
    mode: "antigravity",
    enabled: true,
    status: "active",
    tokens: {
      access_token: "token-responses-early",
      refresh_token: "refresh-responses-early",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      project_id: "project-responses-early"
    }
  };
  const user = {
    password_hash: "unused",
    accounts: [account],
    machine_id: "machine-user",
    google_tokens: null,
    antigravity_tokens: account.tokens,
    api_config: {
      custom_path: "runtime-test",
      api_key: "sk-runtime-test",
      codeassist_pattern: "{modelname}",
      antigravity_pattern: "{modelname}-agy"
    }
  };
  const kv = new MockKV({
    "key:sk-runtime-test": "runtime-user",
    "user:runtime-user": JSON.stringify(user)
  });
  let upstreamController;
  let upstreamClosed = false;
  const upstreamBody = new ReadableStream({
    start(controller) {
      upstreamController = controller;
      controller.enqueue(encoder.encode(sseLine(googleSse([{
        functionCall: { id: "call_live", name: "lookup", args: "{\"query\":\"live\"}" }
      }]))));
    }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(upstreamBody, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
  try {
    const ctx = makeCtx();
    const response = await withTimeout(worker.fetch(new Request("https://example.test/runtime-test/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-runtime-test"
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash-high-agy",
        input: "call the tool",
        stream: true
      })
    }), { GEMINI_KV: kv }, ctx), 1000, "Worker response start");
    assert.equal(response.status, 200);
    assert.equal(upstreamClosed, false, "HTTP response must start before the upstream model stream completes");
    upstreamController.enqueue(encoder.encode(sseLine(googleSse([], "STOP"))));
    upstreamController.enqueue(encoder.encode("data: [DONE]\n\n"));
    upstreamController.close();
    upstreamClosed = true;
    const body = await withTimeout(response.text(), 2000, "Worker streamed response");
    assert.match(body, /event: response\.completed/);
    assert.match(body, /^data: \[DONE\]$/m);
    await ctx.drain();
    console.log("PASS: Worker returns HTTP 200 before a long model output finishes");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
