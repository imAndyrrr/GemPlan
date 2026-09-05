import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = new URL("./", import.meta.url);
const currentFile = "run-tests.mjs";
const files = (await readdir(scriptsDir))
  .filter((name) => name.startsWith("test-") && name.endsWith(".mjs") && name !== currentFile)
  .sort();

for (const file of files) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(file, scriptsDir))], {
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${file} failed with ${signal || `exit code ${code}`}`));
      }
    });
  });
}

console.log(`\nPASS: ${files.length} regression test files completed`);
