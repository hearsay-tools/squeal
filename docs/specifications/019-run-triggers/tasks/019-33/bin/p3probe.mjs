#!/usr/bin/env node
// Throwaway probe for 019-33 (P3 with news). Not product code. Runs as agent; every hook, CLI
// call and file write runs as squeal-e2e in the fixture clone of /home/squeal-e2e/runs/d1933.
//   node p3probe.mjs <trials> <lead ms> [out.jsonl]
// No model. Each trial, on fix-h2 (maxHolds 2) with a new store: a daemon settled by `squeal run
// --all --wait`; the Claude Code SessionStart hook (the pinned 0.1.400 bundles) registers a
// session, and its UserPromptSubmit runs; a PreToolUse before each edit; src/strings.ts is edited so the unit test fails, a PostToolBatch tells that; the test
// is fixed and its pass waited for, and is still owed when the Stop entries start, as at s3b's
// first Stop. `stop.mjs` (the 2 s entry) and `stop-slow.mjs` (the waiting entry) get the same
// input; `lead` > 0 starts the 2 s entry that many ms first (019-30's test: 150), < 0 the waiting
// entry, 0 both at once. Prints, per trial, each entry's time from the first start and decision
// (block, news or nothing) and the first line of a block. (A variant with the news told first
// was dropped: with no harness between the probe's hooks the e2e file runs at a pause before Stop,
// so it does not stand for s3b2 to s3b4.)
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [trials0, lead0, outFile] = process.argv.slice(2);
const lead = Number(lead0);
if (!/^\d+$/.test(trials0 ?? "") || !Number.isInteger(lead)) {
  console.error("usage: p3probe.mjs <trials> <lead ms> [out.jsonl]");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const asE2e = join(here, "..", "..", "019-17", "bin", "as-e2e.mjs");
const R = "/home/squeal-e2e/runs/d1933";
const CWD = `${R}/fixture`;
const DIST = `${R}/pin/plugins/claude-code/dist`;
const base = JSON.parse(execFileSync("cat", ["/tmp/dogfood-019-33/bases.json"], { encoding: "utf8" }))["fix-h2"];
const as = (args, input) =>
  execFileSync("node", [asE2e, R, CWD, ...args], {
    encoding: "utf8",
    input: input ?? "",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1 << 26,
  });
const tryAs = (args, input) => {
  try {
    return as(args, input);
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}(exit ${e.status})`;
  }
};
const write = (path, text) => as(["node", "-e", "require('fs').writeFileSync(process.argv[1], process.argv[2])", path, text]);
const hookInput = (session, event, extra = {}) =>
  JSON.stringify({
    session_id: session,
    transcript_path: `${R}/claude/projects/p3probe/${session}.jsonl`,
    cwd: CWD,
    hook_event_name: event,
    permission_mode: "bypassPermissions",
    ...extra,
  });
const hook = (bundle, input) => tryAs(["node", "--disable-warning=ExperimentalWarning", `${DIST}/${bundle}.mjs`], input);
const batch = (session, file) =>
  hook(
    "post-tool-batch",
    hookInput(session, "PostToolBatch", {
      tool_calls: [{ tool_name: "Edit", tool_input: { file_path: `${CWD}/${file}` }, tool_use_id: "toolu_p3" }],
    }),
  );
// PreToolUse puts the consumer in a turn (`resumeTurn`), as each tool call of a real session does.
const pre = (session, file) =>
  hook(
    "pre-tool-use",
    hookInput(session, "PreToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: `${CWD}/${file}`, old_string: "x", new_string: "y" },
      tool_use_id: "toolu_p3",
    }),
  );
const timed = (bundle, input, t0) =>
  new Promise((resolve) => {
    const child = spawn("node", [asE2e, R, CWD, "node", "--disable-warning=ExperimentalWarning", `${DIST}/${bundle}.mjs`], {
      cwd: "/",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.on("exit", () => {
      const ms = Math.round(performance.now() - t0);
      const kind = /"decision"\s*:\s*"block"/.test(out) ? "block" : /additionalContext/.test(out) ? "news" : "nothing";
      let first = "";
      let text = "";
      try {
        const json = JSON.parse(out);
        first = (json.reason ?? "").split("\n")[0].slice(0, 160);
        text = json.reason ?? json.hookSpecificOutput?.additionalContext ?? "";
      } catch {}
      resolve({ bundle, ms, kind, first, text });
    });
    child.stdin.end(input);
  });

for (let trial = 1; trial <= Number(trials0); trial++) {
  tryAs(["git", "checkout", "-q", "-f", base.branch]);
  tryAs(["git", "reset", "-q", "--hard", base.commit]);
  tryAs(["git", "clean", "-fdq"]);
  tryAs(["squeal", "stop"]);
  tryAs(["rm", "-rf", ".git/squeal"]);
  tryAs(["squeal", "start"]);
  tryAs(["squeal", "run", "--all", "--wait", "300000"]);
  const session = randomUUID();
  hook("session-start", hookInput(session, "SessionStart", { source: "startup", model: "claude-sonnet-5-5" }));
  // The UserPromptSubmit entry, as `claude -p` runs it (its other entry is the async waiter).
  const prompt = hookInput(session, "UserPromptSubmit", { prompt: "Change shout." });
  hook("user-prompt-submit", prompt);
  pre(session, "src/strings.ts");
  write("src/strings.ts", "export const shout = (s: string) => `${s.toUpperCase()}!!`;\n");
  batch(session, "src/strings.ts");
  tryAs(["squeal", "status", "--wait", "60000", "test/strings.test.ts"]);
  const failTold = batch(session, "src/strings.ts");
  pre(session, "test/strings.test.ts");
  write("test/strings.test.ts", 'import { expect, it } from "vitest";\nimport { shout } from "../src/strings.js";\n\nit("shouts", () => {\n  expect(shout("hi")).toBe("HI!!");\n});\n');
  batch(session, "test/strings.test.ts");
  tryAs(["squeal", "status", "--wait", "60000", "test/strings.test.ts"]);
  const load1 = Number(execFileSync("cut", ["-d", " ", "-f1", "/proc/loadavg"], { encoding: "utf8" }));
  const stop = hookInput(session, "Stop", { stop_hook_active: false, last_assistant_message: "Done." });
  const t0 = performance.now();
  const later = (ms, f) => new Promise((r) => setTimeout(() => r(f()), Math.max(0, ms)));
  const [quick, waiting] = await Promise.all([
    later(-lead, () => timed("stop", stop, t0)),
    later(lead, () => timed("stop-slow", stop, t0)),
  ]);
  const row = {
    trial,
    lead,
    load1,
    failTold: /FAIL/.test(failTold),
    quick,
    waiting,
  };
  console.log(JSON.stringify({ ...row, quick: { ...quick, text: undefined }, waiting: { ...waiting, text: undefined } }));
  if (outFile) appendFileSync(outFile, `${JSON.stringify(row)}\n`);
}
tryAs(["squeal", "stop"]);
