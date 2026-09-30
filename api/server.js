import http from "node:http";
import worker from "../src/worker.js";
import { createRuntimeEnvironment, handleNodeRequest } from "./vercel-runtime.js";

const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";

const env = createRuntimeEnvironment();

const server = http.createServer(async (req, res) => {
  try {
    await handleNodeRequest(worker, req, res, env);
  } catch (err) {
    console.error("[server] Unhandled request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error", message: err.message || String(err) }));
    }
  }
});

// Keep-alive timeout tuned for upstream proxies (Render / Cloudflare / Nginx) to prevent ECONNRESET
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(port, host, () => {
  console.log(`[gemplan] Server listening on http://${host}:${port}`);
});

process.on("SIGTERM", () => {
  console.log("[gemplan] Received SIGTERM, shutting down gracefully...");
  server.close(() => process.exit(0));
});
