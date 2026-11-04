#!/usr/bin/env node
// Throwaway probe for 019-36 (P10). Not product code. 019-33's `bin/p3probe.mjs` with three
// changes: every hook runs as a child of one long-lived stand-in harness process per trial
// (`harness.mjs`), so the daemon does not drop the session's consumer between hooks, which in
// 019-33's probe made some first Stops register again and lose the waiting entry's record; the
// hook bundles come from `P3_DIST` (default: the pinned 0.1.400 ones); `P3_TELL=1` tells the
// test's pass at a boundary before Stop, so the first Stop has no news. Runs as agent; every hook,
// CLI call and file write runs as squeal-e2e in the fixture clone of /home/squeal-e2e/runs/d1933.
//   [P3_DIST=<dist>] [P3_TELL=1] node p3probe.mjs <trials> <lead ms> [out.jsonl]
// Times are from the stand-in's start of the Stop pair, without the `sudo` start of 019-33's.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
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
const DIST = process.env.P3_DIST ?? `${R}/pin/plugins/claude-code/dist`;
const TELL = process.env.P3_TELL === "1";
// The e2e user cannot read this checkout: the stand-in is copied where it can.
const helperDir = mkdtempSync("/tmp/p3probe-019-36-");
chmodSync(helperDir, 0o755);
const helper = join(helperDir, "harness.mjs");
copyFileSync(join(here, "harness.mjs"), helper);
chmodSync(helper, 0o644);
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

/** One trial's stand-in harness: `ask` starts hooks as its children and resolves with their results. */
function standIn() {
  const child = spawn("node", [asE2e, R, CWD, "node", helper, DIST], {
    cwd: "/",
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const { id, results } = JSON.parse(line);
    waiting.get(id)?.(results);
    waiting.delete(id);
  });
  const ask = (hooks) =>
    new Promise((resolve) => {
      const id = randomUUID();
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ id, hooks })}\n`);
    });
  const end = () =>
    new Promise((resolve) => {
      child.on("exit", resolve);
      child.stdin.end();
    });
  return { ask, end };
}

const summary = ({ bundle, ms, stdout }) => {
  const kind = /"decision"\s*:\s*"block"/.test(stdout) ? "block" : /additionalContext/.test(stdout) ? "news" : "nothing";
  let first = "";
  let text = "";
  try {
    const json = JSON.parse(stdout);
    first = (json.reason ?? "").split("\n")[0].slice(0, 160);
    text = json.reason ?? json.hookSpecificOutput?.additionalContext ?? "";
  } catch {}
  return { bundle, ms, kind, first, text };
};

for (let trial = 1; trial <= Number(trials0); trial++) {
  tryAs(["git", "checkout", "-q", "-f", base.branch]);
  tryAs(["git", "reset", "-q", "--hard", base.commit]);
  tryAs(["git", "clean", "-fdq"]);
  tryAs(["squeal", "stop"]);
  tryAs(["rm", "-rf", ".git/squeal"]);
  tryAs(["squeal", "start"]);
  tryAs(["squeal", "run", "--all", "--wait", "300000"]);
  const { ask, end } = standIn();
  const hook = async (bundle, input) => (await ask([{ bundle, input }]))[0].stdout;
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
  const session = randomUUID();
  await hook("session-start", hookInput(session, "SessionStart", { source: "startup", model: "claude-sonnet-5-5" }));
  // The UserPromptSubmit entry, as `claude -p` runs it (its other entry is the async waiter).
  await hook("user-prompt-submit", hookInput(session, "UserPromptSubmit", { prompt: "Change shout." }));
  await pre(session, "src/strings.ts");
  write("src/strings.ts", "export const shout = (s: string) => `${s.toUpperCase()}!!`;\n");
  await batch(session, "src/strings.ts");
  tryAs(["squeal", "status", "--wait", "60000", "test/strings.test.ts"]);
  const failTold = await batch(session, "src/strings.ts");
  await pre(session, "test/strings.test.ts");
  write("test/strings.test.ts", 'import { expect, it } from "vitest";\nimport { shout } from "../src/strings.js";\n\nit("shouts", () => {\n  expect(shout("hi")).toBe("HI!!");\n});\n');
  await batch(session, "test/strings.test.ts");
  tryAs(["squeal", "status", "--wait", "60000", "test/strings.test.ts"]);
  if (TELL) await batch(session, "test/strings.test.ts");
  const load1 = Number(execFileSync("cut", ["-d", " ", "-f1", "/proc/loadavg"], { encoding: "utf8" }));
  const stop = hookInput(session, "Stop", { stop_hook_active: false, last_assistant_message: "Done." });
  const [quick, waiting] = (
    await ask([
      { bundle: "stop", input: stop, delayMs: -lead },
      { bundle: "stop-slow", input: stop, delayMs: lead },
    ])
  ).map(summary);
  await end();
  const row = { trial, lead, tell: TELL, load1, failTold: /FAIL/.test(failTold), quick, waiting };
  console.log(JSON.stringify({ ...row, quick: { ...quick, text: undefined }, waiting: { ...waiting, text: undefined } }));
  if (outFile) appendFileSync(outFile, `${JSON.stringify(row)}\n`);
}
tryAs(["squeal", "stop"]);
