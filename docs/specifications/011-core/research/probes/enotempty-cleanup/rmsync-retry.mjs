// Throwaway probe (row 011-333). Does `rmSync(dir, { recursive, maxRetries, retryDelay })` survive
// a writer that adds one file to `dir` shortly after the delete begins and then stops?
// Usage: node rmsync-retry.mjs <scratch-dir>. Writes only below <scratch-dir>.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
if (!base) throw new Error("usage: node rmsync-retry.mjs <scratch-dir>");
const dir = join(base, `rm-${process.version}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
// Many files, so the sweep of the children takes long enough for the writer to land inside it.
for (let i = 0; i < 20000; i++) writeFileSync(join(dir, `f-${i}`), "x");
// The writer: a separate process (rmSync blocks this one), which appends a file by path every
// 1 ms for 300 ms and then stops for good, as a starting process's recorder would.
const writer = spawn(process.execPath, [
  "-e",
  `const fs=require("fs");const end=Date.now()+300;let n=0;
   const t=setInterval(()=>{try{fs.appendFileSync(${JSON.stringify(dir)}+"/late-"+(n++),"x")}catch{}; if(Date.now()>end){clearInterval(t)}},1);`,
], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 20));
const started = performance.now();
let outcome;
try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  outcome = "removed";
} catch (error) {
  outcome = `${error.code} after retries; left: ${existsSync(dir) ? readdirSync(dir).join(",") : "(gone)"}`;
}
const ms = Math.round(performance.now() - started);
await new Promise((r) => writer.on("exit", r));
console.log(`${process.version}: ${outcome} in ${ms} ms`);
rmSync(dir, { recursive: true, force: true });
