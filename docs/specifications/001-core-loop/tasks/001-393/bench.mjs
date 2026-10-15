// Cost of lowerWhile's look (001-393). Replace SRC/ with this worktree's src/ and OLD/ with a copy of the
// commit before's src/, then: npx esbuild bench.mjs --bundle --platform=node --format=esm --outfile=/tmp/bench.mjs && node /tmp/bench.mjs
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { EscapedChildren } from "SRC/core/daemon/escaped.js";
import { EscapedChildren as Old } from "OLD/core/daemon/escaped.js";
import { childrenOf, statOf } from "SRC/core/daemon/terminate.js";
async function time(name, f, n) {
  const cpu0 = process.cpuUsage(); const t0 = performance.now();
  let found = 0;
  for (let i = 0; i < n; i++) found = (await f()).length;
  const wall = (performance.now() - t0) / n; const cpu = process.cpuUsage(cpu0);
  console.log(`${name}: ${wall.toFixed(3)} ms wall, ${((cpu.user + cpu.system) / 1000 / n).toFixed(3)} ms CPU per look, ${found} found`);
}
async function withKids(marked, f) {
  const kids = [];
  for (let i = 0; i < 10; i++)
    kids.push(spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { env: i < 8 ? { ...process.env, ...marked } : process.env, stdio: "ignore" }));
  await new Promise((d) => setTimeout(d, 1500));
  await f();
  for (const k of kids) k.kill("SIGKILL");
  await new Promise((d) => setTimeout(d, 300));
}
const now = new EscapedChildren(); const old = new Old();
await withKids(now.envFor("fast"), async () => {
  const since = now.mark();
  await time("subtree look (001-393)", () => now.carriers("fast", since - 1000), 500);
  await time("  of which children + stat", async () => childrenOf(process.pid).map(statOf), 500);
  await time("  environ, async x10", () => Promise.all(childrenOf(process.pid).map((p) => readFile(`/proc/${p}/environ`, "latin1"))), 500);
  await time("  environ, sync x10", async () => childrenOf(process.pid).map((p) => readFileSync(`/proc/${p}/environ`, "latin1")), 500);
});
await withKids(old.envFor("fast"), async () => {
  await time("full scan look (before)", () => old.carriers("fast", old.mark() - 1000), 50);
});
