#!/usr/bin/env node
// Throwaway probe helper for 019-36. Not product code. Runs as squeal-e2e for one trial of
// p3probe.mjs and stands in for the harness process: every hook of the trial is its child, so the
// registration records this process (the hooks' walk skips only shells), and it lives until the
// trial ends, as Claude Code does. Without it each hook's parent is a `sudo` that exits at once,
// the daemon's heartbeat drops the consumer (lessons defect 24), and a Stop registers it again.
//   node harness.mjs <dist>
// stdin, one JSON line per request: {"id", "hooks": [{"bundle", "input", "delayMs"}]}. It starts
// each hook `delayMs` after the request and answers {"id", "results": [{"bundle", "ms",
// "stdout"}]} once every one ended; `ms` is from the request.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [dist] = process.argv.slice(2);
const run = (bundle, input, t0) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", `${dist}/${bundle}.mjs`],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.on("exit", () => resolve({ bundle, ms: Math.round(performance.now() - t0), stdout: out }));
    child.stdin.end(input);
  });
const after = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

for await (const line of createInterface({ input: process.stdin })) {
  const { id, hooks } = JSON.parse(line);
  const t0 = performance.now();
  const results = await Promise.all(
    hooks.map((h) => after(h.delayMs ?? 0).then(() => run(h.bundle, h.input, t0))),
  );
  process.stdout.write(`${JSON.stringify({ id, results })}\n`);
}
