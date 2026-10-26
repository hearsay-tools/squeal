// Probe (row 011-230): the real race through runNodeTest. Pause the parent node --test, cut the
// run (the runner sends SIGTERM to the group), resume the parent after 200 ms. run.json's
// `completed` is the stream's completeness, which the rule before the fix counted.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
const [worktree, fx, n = "10"] = process.argv.slice(2);
const { runNodeTest } = await import(join(worktree, "src/runners/node-test/run/run.ts"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = realpathSync(fx);
const counts: Record<string, number> = {};
for (let i = 0; i < Number(n); i++) {
  const logDir = join(root, "..", "logs", `runner-${i}`);
  rmSync(logDir, { recursive: true, force: true });
  const marker = join(root, "holds.started");
  rmSync(marker, { force: true });
  const stop = new AbortController();
  const running = runNodeTest({
    root, logDir, timeoutMs: 60_000, signal: stop.signal,
    project: { name: "kit", node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] },
    files: [{ project: "kit", path: "test/cut.test.mjs" }],
  });
  while (!existsSync(marker)) await sleep(20);
  const parent = Number(execFileSync("pgrep", ["-f", "--", `--test-reporter-destination=${join(logDir, "events-0.ndjson")}`], { encoding: "utf8" }).trim().split("\n")[0]);
  process.kill(parent, "SIGSTOP");
  stop.abort("stop");
  await sleep(200);
  process.kill(parent, "SIGCONT");
  const { report } = await running;
  const log = JSON.parse(readFileSync(join(logDir, "run.json"), "utf8"));
  const key = `stream-whole=${log.files[0].completed} signalled=${log.files[0].signalled} completedFiles=${report.completedFiles.length} fileErrors=${report.fileErrors.length} end=${report.end}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log(JSON.stringify(counts, null, 1));
