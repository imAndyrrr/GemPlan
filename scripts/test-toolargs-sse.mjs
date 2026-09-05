// Verify the hand-built SSE tool_calls chunk has string arguments (OpenAI protocol).
const fc = { args: { query: "cities skylines 2 metro" } };
const toolArgsStr =
  typeof fc.args === "object"
    ? JSON.stringify(JSON.stringify(fc.args))
    : JSON.stringify(fc.args || "{}");
const line =
  '{"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"web_search","arguments":' +
  toolArgsStr +
  "}}]}}";
const parsed = JSON.parse(line);
const a = parsed.delta.tool_calls[0].function.arguments;
console.log("type:", typeof a);
console.log("value:", a);
if (typeof a !== "string") throw new Error("arguments must be a string");
JSON.parse(a); // must itself be valid JSON
console.log("OK: arguments is a string containing valid JSON");

// Multiple calls in one assistant turn must not share index 0. CCR uses this
// index to associate argument deltas with a specific function call.
const multiCall = [
  { index: 0, id: "call_a", type: "function", function: { name: "get_goal", arguments: "{}" } },
  { index: 1, id: "call_b", type: "function", function: { name: "exec_command", arguments: '{"cmd":"git status"}' } }
];
const indices = new Set(multiCall.map((call) => call.index));
if (indices.size !== multiCall.length) {
  throw new Error("multiple tool calls must have distinct indices");
}
console.log("OK: multiple tool calls have distinct indices");
