import http from "node:http";
import cluster from "node:cluster";
import os from "node:os";
import worker from "../src/worker.js";
import { createRuntimeEnvironment, handleNodeRequest } from "./vercel-runtime.js";

// Ensure standalone Node server defaults to purely local file-backed store (zero Cloudflare KV calls)
process.env.KV_MODE = process.env.KV_MODE || "local";

const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";

const rawWorkersConfig = String(process.env.NODE_CLUSTER_WORKERS || "").trim().toLowerCase();
const cpuCount = typeof os.availableParallelism === "function" ? os.availableParallelism() : (os.cpus()?.length || 1);

const isClusterDisabled = rawWorkersConfig === "off" || rawWorkersConfig === "0" || rawWorkersConfig === "1" || (rawWorkersConfig === "" && cpuCount <= 1);
const workerCount = isClusterDisabled ? 1 : (Number.parseInt(rawWorkersConfig, 10) || Math.min(cpuCount, 4));

if (!isClusterDisabled && cluster.isPrimary) {
  console.log(`[gemplan] Primary cluster manager started (PID ${process.pid}), spawning ${workerCount} workers across ${cpuCount} CPUs...`);

  for (let i = 0; i < workerCount; i++) {
    cluster.fork();
  }

  cluster.on("exit", (deadWorker, code, signal) => {
    console.warn(`[gemplan] Worker ${deadWorker.process.pid} exited (code: ${code}, signal: ${signal}). Spawning replacement...`);
    cluster.fork();
  });

  process.on("SIGTERM", () => {
    console.log("[gemplan] Primary received SIGTERM, shutting down cluster workers...");
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill("SIGTERM");
    }
    process.exit(0);
  });
} else {
  const env = createRuntimeEnvironment();

  if (typeof globalThis.gc === "function") {
    setInterval(() => {
      try { globalThis.gc(); } catch (_) {}
    }, 60000).unref();
  }

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
    const role = isClusterDisabled ? "Standalone" : `Cluster Worker (PID ${process.pid})`;
    console.log(`[gemplan] ${role} listening on http://${host}:${port} (KV mode: ${process.env.KV_MODE})`);
  });

  process.on("SIGTERM", () => {
    console.log(`[gemplan] Worker (PID ${process.pid}) shutting down gracefully...`);
    server.close(() => process.exit(0));
  });
}
