function generateRandomString(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (const byte of bytes) result += alphabet[byte % alphabet.length];
  return result;
}

function encodeToolCallIdentity(id, thoughtSignature) {
  if (typeof id !== "string" || !id || typeof thoughtSignature !== "string" || thoughtSignature.length < 50) {
    return id;
  }
  return `${id}|${thoughtSignature}`;
}

function isResponseEmpty(data) {
  if (!data) return true;
  const raw = data.response || data;
  if (!raw || typeof raw !== "object") return true;
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) return true;
  for (const candidate of raw.candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const parts = candidate.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      if (typeof part.text === "string" && /\S/u.test(part.text)) return false;
      if (part.functionCall && typeof part.functionCall === "object") return false;
      if (part.inlineData || part.fileData) return false;
      if (part.thought === true && typeof part.text === "string" && /\S/u.test(part.text)) return false;
    }
  }
  return true;
}

function isSseDataLineMeaningful(line) {
  if (!line.startsWith("data: ")) return false;
  const dataStr = line.slice(6).trim();
  if (dataStr === "[DONE]") return false;
  try {
    return !isResponseEmpty(JSON.parse(dataStr));
  } catch (_) {
    return false;
  }
}

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

function responseUsageFromGoogle(usageMetadata) {
  if (!usageMetadata) return void 0;
  const reasoningTokens = usageMetadata.thoughtsTokenCount || 0;
  return {
    input_tokens: usageMetadata.promptTokenCount || 0,
    output_tokens: (usageMetadata.candidatesTokenCount || 0) + reasoningTokens,
    total_tokens: usageMetadata.totalTokenCount || 0,
    input_tokens_details: { cached_tokens: usageMetadata.cachedContentTokenCount || 0 },
    output_tokens_details: { reasoning_tokens: reasoningTokens }
  };
}

async function writeResponsesEvent(writer, encoder, type, payload, sequenceNumber) {
  const event = { type, ...payload };
  if (sequenceNumber !== void 0) event.sequence_number = sequenceNumber;
  await writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`));
}

export function createResponsesStreamProcessor(writableStream, inputModel, mode) {
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
  let started = false;
  let hasAnyContent = false;
  let finished = false;
  let closed = false;
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
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await writer.close();
    } catch (_) {
    }
  };
  const ensureStarted = async () => {
    if (started) return;
    started = true;
    await emit("response.created", { response: responseSkeleton });
    await emit("response.in_progress", { response: responseSkeleton });
  };
  const processData = async (chunk) => {
    const responseBlock = chunk.response || chunk;
    if (responseBlock?.usageMetadata) finalUsage = responseBlock.usageMetadata;
    const candidate = responseBlock?.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (!hasAnyContent) {
      if (isResponseEmpty(chunk)) return;
      hasAnyContent = true;
    }
    await ensureStarted();
    if (!candidate) return;
    const parts = candidate.content?.parts;
    if (!Array.isArray(parts)) return;
    const hasExplicitThought = parts.some((part) => part?.thought === true);
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      const isThought = part?.thought === true || (!hasExplicitThought && mode === "antigravity" && partIndex === 0 && parts.length >= 2);
      if (part?.text) {
        if (isThought) {
          if (!reasoningState) {
            const item = {
              type: "reasoning",
              id: `rs_${generateRandomString(16)}`,
              status: "in_progress",
              summary: [{ type: "summary_text", text: "" }]
            };
            reasoningState = { outputIndex: output.length, item };
            output.push(item);
            await emit("response.output_item.added", { output_index: reasoningState.outputIndex, item });
            await emit("response.reasoning_summary_part.added", {
              item_id: item.id,
              output_index: reasoningState.outputIndex,
              summary_index: 0,
              part: { type: "summary_text", text: "" }
            });
          }
          reasoningState.item.summary[0].text += part.text;
          await emit("response.reasoning_summary_text.delta", {
            item_id: reasoningState.item.id,
            output_index: reasoningState.outputIndex,
            summary_index: 0,
            delta: part.text
          });
        } else {
          if (!messageState) {
            const item = {
              type: "message",
              id: `msg_${generateRandomString(24)}`,
              status: "in_progress",
              role: "assistant",
              content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }]
            };
            messageState = { outputIndex: output.length, item };
            output.push(item);
            await emit("response.output_item.added", { output_index: messageState.outputIndex, item });
            await emit("response.content_part.added", {
              item_id: item.id,
              output_index: messageState.outputIndex,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [], logprobs: [] }
            });
          }
          messageState.item.content[0].text += part.text;
          responseText += part.text;
          await emit("response.output_text.delta", {
            item_id: messageState.item.id,
            output_index: messageState.outputIndex,
            content_index: 0,
            delta: part.text,
            logprobs: []
          });
        }
      }
      if (part?.functionCall) {
        const fc = part.functionCall;
        const rawId = fc.id || `call_${fc.name || "function"}_${generateRandomString(8)}`;
        const thoughtSignature = part.thoughtSignature || part.thought_signature;
        let state = functionCallStates.get(rawId);
        if (!state) {
          const item = {
            type: "function_call",
            id: `fc_${generateRandomString(16)}`,
            call_id: encodeToolCallIdentity(rawId, thoughtSignature),
            name: fc.name || "unknown",
            arguments: "",
            status: "in_progress"
          };
          state = { rawId, outputIndex: output.length, item };
          functionCallStates.set(rawId, state);
          output.push(item);
          await emit("response.output_item.added", { output_index: state.outputIndex, item });
        } else if (thoughtSignature) {
          state.item.call_id = encodeToolCallIdentity(rawId, thoughtSignature);
        }
        const args = typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args || {});
        state.item.arguments += args;
        await emit("response.function_call_arguments.delta", {
          item_id: state.item.id,
          output_index: state.outputIndex,
          delta: args
        });
      }
    }
  };
  const processLine = async (line) => {
    if (!line.startsWith("data: ")) return;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === "[DONE]") return;
    let chunk;
    try {
      chunk = JSON.parse(dataStr);
    } catch (_) {
      return;
    }
    await processData(chunk);
  };
  const finish = async () => {
    if (finished) return hasAnyContent;
    finished = true;
    if (!hasAnyContent) {
      await close();
      return false;
    }
    if (reasoningState) {
      const { item, outputIndex } = reasoningState;
      item.status = "completed";
      await emit("response.reasoning_summary_text.done", {
        item_id: item.id,
        output_index: outputIndex,
        summary_index: 0,
        text: item.summary[0].text
      });
      await emit("response.reasoning_summary_part.done", {
        item_id: item.id,
        output_index: outputIndex,
        summary_index: 0,
        part: item.summary[0]
      });
      await emit("response.output_item.done", { output_index: outputIndex, item });
    }
    if (messageState) {
      const { item, outputIndex } = messageState;
      const statusInfo = responsesStatusFromFinishReason(finishReason);
      item.status = statusInfo.status;
      await emit("response.output_text.done", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        text: item.content[0].text,
        logprobs: []
      });
      await emit("response.content_part.done", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        part: item.content[0]
      });
      await emit("response.output_item.done", { output_index: outputIndex, item });
    }
    for (const state of functionCallStates.values()) {
      const { item, outputIndex } = state;
      item.status = "completed";
      await emit("response.function_call_arguments.done", {
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments
      });
      await emit("response.output_item.done", { output_index: outputIndex, item });
    }
    const statusInfo = responsesStatusFromFinishReason(finishReason);
    const finalResponse = {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: statusInfo.status,
      incomplete_details: statusInfo.incomplete_details,
      model: inputModel,
      output,
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
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await close();
    return true;
  };
  return { processData, processLine, finish, close };
}

export async function processResponsesSseStream(readableStream, writableStream, inputModel, mode) {
  const processor = createResponsesStreamProcessor(writableStream, inputModel, mode);
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineStart = 0;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n", lineStart)) >= 0) {
        const line = buffer.slice(lineStart, newlineIndex).replace(/\r$/, "");
        lineStart = newlineIndex + 1;
        await processor.processLine(line);
      }
      if (lineStart > 0) buffer = buffer.slice(lineStart);
    }
    buffer += decoder.decode();
    if (buffer.length > 0) await processor.processLine(buffer.replace(/\r$/, ""));
    return await processor.finish();
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {
    }
    await processor.close();
  }
}

function streamFromSseReader(prefix, reader) {
  const encoder = new TextEncoder();
  let prefixPending = prefix.length > 0;
  return new ReadableStream({
    async pull(controller) {
      if (prefixPending) {
        prefixPending = false;
        controller.enqueue(encoder.encode(prefix));
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

export async function peekResponsesSseUntilMeaningful(readableStream) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let continuationCreated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineStart = 0;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n", lineStart)) >= 0) {
        const line = buffer.slice(lineStart, newlineIndex).replace(/\r$/, "");
        lineStart = newlineIndex + 1;
        if (isSseDataLineMeaningful(line)) {
          const remaining = buffer.slice(lineStart) + decoder.decode();
          continuationCreated = true;
          return {
            stream: streamFromSseReader(`${line}\n${remaining}`, reader),
            hasAnyContent: true
          };
        }
      }
      if (lineStart > 0) buffer = buffer.slice(lineStart);
    }
    buffer += decoder.decode();
    const tail = buffer.replace(/\r$/, "");
    const hasAnyContent = isSseDataLineMeaningful(tail);
    const stream = hasAnyContent ? streamFromSseReader(`${tail}\n`, reader) : null;
    continuationCreated = stream !== null;
    return { stream, hasAnyContent };
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch (_) {
    }
    throw error;
  } finally {
    if (!continuationCreated) {
      try {
        reader.releaseLock();
      } catch (_) {
      }
    }
  }
}
