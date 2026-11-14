// Throwaway probe (row 011-333). Replays the start of run.test.ts "reports nothing of a run
// stopped after the checkout holding its store went": a node:test run of pass.test.ts then
// busy-loop.test.ts, concurrency 1. As soon as `stdout-1.log` exists (where the test starts its
// delete), it empties the log folder, then for 3 s polls it every 1 ms, deletes each entry that
// appears and prints its name and the time since the sweep. Then it stops the run.
// Usage, from the repository root: TMPDIR=<private> node --import tsx <this file>
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runNodeTest } from "../../../../../../src/runners/node-test/run/run.js";

const ROOT = realpathSync(resolve(import.meta.dirname, "../../../../../../test/fixtures/node-test"));
const edge = { name: "edge", cwd: "edge", argv: ["--import", "tsx"], env: {}, include: ["**/*.test.ts"] };
const logs = mkdtempSync(join(tmpdir(), "enotempty-probe-"));
const checkout = join(logs, randomUUID());
mkdirSync(join(checkout, ".git", "squeal"), { recursive: true });
const logDir = join(checkout, ".git", "squeal", "runs", randomUUID(), "node-test", "edge");
const stop = new AbortController();
const files = ["test/pass.test.ts", "test/busy-loop.test.ts"].map((p) => ({ project: "edge", path: `edge/${p}` }));
const running = runNodeTest({
  root: ROOT, project: edge as never, files: files as never, concurrency: 1, logDir,
  timeoutMs: 30_000, signal: stop.signal,
});
while (!existsSync(join(logDir, "stdout-1.log"))) await new Promise((r) => setTimeout(r, 5));
const swept = performance.now();
const atSweep = readdirSync(logDir);
for (const name of atSweep) rmSync(join(logDir, name), { recursive: true, force: true });
const seen: string[] = [];
while (performance.now() - swept < 3_000) {
  for (const name of readdirSync(logDir)) {
    seen.push(`${Math.round(performance.now() - swept)} ms ${name.replace(/-\d+\.ndjson$/, "-<pid>.ndjson")}`);
    rmSync(join(logDir, name), { recursive: true, force: true });
  }
  await new Promise((r) => setTimeout(r, 1));
}
stop.abort();
await running;
console.log(`at the sweep: ${atSweep.join(", ")}`);
console.log(`made again after the sweep (${seen.length}):\n${seen.join("\n")}`);
rmSync(logs, { recursive: true, force: true });
