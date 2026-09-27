import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent } from "undici";

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("Missing VERCEL_TOKEN environment variable. Please export VERCEL_TOKEN=... before running.");
  process.exit(1);
}
const teamId = "team_Sd8XtjJVBrf2JMpj4t90y3zj";
const projectId = "prj_7Anp7TGxBKLKmW5ek4ThW7bmNMuD";
const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "http://127.0.0.1:7897";
const agent = new ProxyAgent(proxyUrl);

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const fileList = [
  "api/handler.js",
  "api/vercel-runtime.js",
  "api/vercel-kv.js",
  "src/worker.js",
  "src/responses-stream.js",
  "package.json",
  "vercel.json"
];

if (fs.existsSync(path.join(projectRoot, ".dev.vars"))) {
  fileList.push(".dev.vars");
}

const files = fileList.map((relPath) => {
  const fullPath = path.join(projectRoot, relPath);
  const data = fs.readFileSync(fullPath, "utf8");
  return { file: relPath.replace(/\\/g, "/"), data };
});

// Sync env vars to Vercel project if available
try {
  const devVarsPath = path.join(projectRoot, ".dev.vars");
  if (fs.existsSync(devVarsPath)) {
    const envLines = fs.readFileSync(devVarsPath, "utf8").split("\n");
    const existingEnvRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}`, {
      headers: { Authorization: `Bearer ${token}` },
      dispatcher: agent
    });
    const existingEnvData = await existingEnvRes.json();
    const existingKeys = new Set((existingEnvData.envs || []).map((e) => e.key));

    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!existingKeys.has(key)) {
        console.log(`Setting Vercel environment variable: ${key}`);
        await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            key,
            value,
            type: "plain",
            target: ["production", "preview", "development"]
          }),
          dispatcher: agent
        });
      }
    }
  }
} catch (envErr) {
  console.warn("Notice: Failed to sync env vars to Vercel project:", envErr.message || envErr);
}

console.log(`Deploying ${files.length} files to Vercel project ${projectId}...`);

const createRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${teamId}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "gemplan",
    project: projectId,
    target: "production",
    files
  }),
  dispatcher: agent
});

const deployment = await createRes.json();
if (!createRes.ok || !deployment.id) {
  console.error("Deployment creation failed:", deployment);
  process.exit(1);
}

console.log(`Deployment created: ${deployment.id} (${deployment.url})`);
console.log(`Waiting for deployment to be ready...`);

const startTime = Date.now();
let current = deployment;
while (current.readyState !== "READY" && current.readyState !== "ERROR") {
  if (Date.now() - startTime > 180000) {
    console.error("Timed out waiting for deployment to become ready");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
  const pollRes = await fetch(`https://api.vercel.com/v13/deployments/${deployment.id}?teamId=${teamId}`, {
    headers: { Authorization: `Bearer ${token}` },
    dispatcher: agent
  });
  current = await pollRes.json();
  process.stdout.write(`Current status: ${current.readyState}\n`);
}

if (current.readyState !== "READY") {
  console.error("Deployment failed with status:", current.readyState, current);
  process.exit(1);
}

console.log(`Deployment ${deployment.id} is READY!`);

for (const domain of ["vercel.newrst.qzz.io", "gemplan.vercel.app"]) {
  const aliasRes = await fetch(`https://api.vercel.com/v2/deployments/${deployment.id}/aliases?teamId=${teamId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ alias: domain }),
    dispatcher: agent
  });
  const aliasData = await aliasRes.json();
  console.log(`Assigned alias ${domain}:`, aliasRes.status, aliasData.alias || aliasData);
}

console.log("Deployment and domain mapping successfully completed!");
