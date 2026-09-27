import worker from "../src/worker.js";
import { createRuntimeContext, createRuntimeEnvironment, handleNodeRequest } from "./vercel-runtime.js";

export const config = {
  supportsResponseStreaming: true,
  regions: ["bom1"]
};

export const regions = ["bom1"];
export const maxDuration = 300;

export default async function handler(req, res) {
  const ctx = createRuntimeContext();
  try {
    const env = createRuntimeEnvironment(process.env);
    await handleNodeRequest(worker, req, res, env, ctx);
  } catch (error) {
    console.error("[Fatal Vercel Exception]:", error);
    await ctx.drain();
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json;charset=utf-8");
      res.end(JSON.stringify({
        error: {
          message: error?.message || String(error),
          type: "internal_vercel_error"
        }
      }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
