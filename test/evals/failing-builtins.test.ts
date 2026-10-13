import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  claudeTimeline,
  codexTimeline,
  coveredRun,
  type Event,
  gradeCell,
} from "../../evals/lib/index.mjs";

/** A completed node:test run after the last script change: D4's completed-run-covers. */
const SCRIPTS = { runner: "node:test", files: ["scripts/changelog.test.mjs"], after: "^scripts/" };

// Review 006-09 B2: under `set -e` only a bare `true` or `:` is sure to succeed. A redirection can
// fail before any command starts, and `set`, `export` and `unset` fail on a bad argument, so what
// follows them is never credited unless its own runner output shows it ran. Each command is
// graded through transcripts and the grader CLI, against what a real Bash did with it: a fake
// `node` prints a marker and a node:test summary only when it runs.
const root = mkdtempSync(join(tmpdir(), "squeal-evals-builtins-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "node"), '#!/bin/sh\necho "RAN node $*"\necho "ℹ tests 1"\n');
chmodSync(join(bin, "node"), 0o755);

const NODE_TEST = "node --test scripts/changelog.test.mjs";
const WRITE = "echo x > test/contract/invoice-json.test.ts";
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
let runs = 0;

/** What Bash does with `command`: its exit, its output, and whether the node or write ran. */
function control(command: string) {
  const cwd = join(root, `c${runs++}`);
  mkdirSync(join(cwd, "test/contract"), { recursive: true });
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
  const out = `${r.stdout}${r.stderr}`;
  return {
    exit: r.status ?? 1,
    out,
    nodeRan: out.includes("RAN node"),
    wrote: existsSync(join(cwd, "test/contract/invoice-json.test.ts")),
  };
}

const scriptEdit: Event = {
  t: 500,
  type: "item.completed",
  item: {
    id: "f1",
    type: "file_change",
    changes: [{ path: "/c/work/scripts/changelog.mjs", kind: "update" }],
    status: "completed",
  },
};

/** Claude Code's events for an edit of the script, then one Bash call of `command`. */
function claudeEvents(command: string, exit: number, out: string): Event[] {
  const use = (id: string, name: string, input: unknown) => ({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
  const result = (id: string, content: string, error = false) => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: error }] },
  });
  return [
    { t: 400, ...use("e1", "Edit", { file_path: "/c/work/scripts/changelog.mjs" }) },
    { t: 450, ...result("e1", "ok") },
    { t: 1000, ...use("b1", "Bash", { command }) },
    { t: 1500, ...result("b1", exit ? `Exit code ${exit}\n${out}` : out, exit !== 0) },
  ];
}

/** The grade of one call of `command` in plain Codex, wrapped Codex and Claude Code. */
function grades(command: string, exit: number, out: string) {
  const codex = (text: string) =>
    gradeCell({
      timeline: codexTimeline([
        scriptEdit,
        {
          t: 1000,
          type: "item.completed",
          item: {
            id: "c1",
            type: "command_execution",
            command: text,
            aggregated_output: out,
            status: "completed",
            exit_code: exit,
          },
        },
      ]),
    });
  const claude = gradeCell({ timeline: claudeTimeline(claudeEvents(command, exit, out)) });
  return [codex(command), codex(`/bin/bash -lc ${quote(command)}`), claude];
}

/** The grade `evals/bin/grade.mjs` writes for a Claude Code cell of that one call. */
function cliGrade(command: string, exit: number, out: string) {
  const dir = join(root, `cell-${runs++}`, "out");
  mkdirSync(dir, { recursive: true });
  const meta = { id: "t1.p0.claude.r1", harness: "claude", variant: "p0" };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  const events = claudeEvents(command, exit, out).map((e) => JSON.stringify(e));
  writeFileSync(join(dir, "events.jsonl"), `${events.join("\n")}\n`);
  const run = spawnSync(process.execPath, ["evals/bin/grade.mjs", dir], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(readFileSync(join(dir, "grade.json"), "utf8"));
}

/** Grades `command` every way against its Bash control: nothing is credited unless it ran. */
function check(command: string) {
  const c = control(command);
  const all = [...grades(command, c.exit, c.out), cliGrade(command, c.exit, c.out)];
  for (const g of all) {
    if (!c.nodeRan) {
      expect(g.nodeTestRuns, command).toBe(0);
      expect(coveredRun(g.retained, SCRIPTS), command).toBe(false);
    }
    if (!c.wrote) expect(g.forbiddenEdit, command).toBe(false);
  }
  return { ...c, grades: all };
}

describe("the review's four commands, against Bash (B2)", () => {
  it("credits no node:test run after a failed redirection of true", () => {
    const r = check(`set -e; true > absent/file; ${NODE_TEST}`);
    expect([r.exit, r.nodeRan]).toEqual([1, false]);
  });

  it("warns of no forbidden edit after a failed redirection of :", () => {
    const r = check(`set -e; : > absent/file; ${WRITE}`);
    expect([r.exit, r.wrote]).toEqual([1, false]);
  });

  it("credits no node:test run after export of an invalid name", () => {
    const r = check(`set -e; export 1BAD=value; ${NODE_TEST}`);
    expect([r.exit, r.nodeRan]).toEqual([1, false]);
  });

  it("credits no node:test run after set with an invalid option", () => {
    const r = check(`set -e; set -Q; ${NODE_TEST}`);
    expect([r.exit, r.nodeRan]).toEqual([2, false]);
  });
});

describe("failing redirections and builtins, against Bash (B2)", () => {
  const notRun = [
    `set -o errexit; true > absent/file; ${NODE_TEST}`,
    `set -o errexit; : > absent/file; ${WRITE}`,
    `bash -e -c ${quote(`true > absent/file; ${NODE_TEST}`)}`,
    `bash -e -c ${quote(`: > absent/file; ${WRITE}`)}`,
    `set -e; true < absent/file; ${NODE_TEST}`,
    `set -e; true >&7; ${NODE_TEST}`,
    `set -e; > absent/file; ${WRITE}`,
    `set -e; exec > absent/file; ${NODE_TEST}`,
    `set -e; : \${UNSET_VAR:?unset}; ${WRITE}`,
    `set -e; true $(false) > absent/file; ${WRITE}`,
    `set -e; export 1BAD=value; ${WRITE}`,
    `set -e; unset -Q; ${WRITE}`,
    `set -e; set -o nosuch; ${WRITE}`,
    `set -e; set +e -Q; ${WRITE}`,
    `set -e; set -Q; ${WRITE}`,
  ];
  it.each(notRun)("credits nothing that never ran: %s", (command) => {
    const r = check(command);
    expect([r.nodeRan, r.wrote]).toEqual([false, false]);
  });

  const ran = [
    `set -e; true; ${NODE_TEST}`,
    `set -e; :; ${NODE_TEST}`,
    `(exit 0); ${NODE_TEST}`,
    `set -e; (exit 1) || true; ${NODE_TEST}`,
    `set -e; false || true; ${NODE_TEST}`,
    `set -e; export GOOD=value; ${NODE_TEST}`,
    `set -e; set -x; ${NODE_TEST}`,
    `true > absent/file; ${NODE_TEST}`,
    `bash <<'EOF'\n${NODE_TEST}\nEOF`,
  ];
  it.each(ran)("still credits a run that did run: %s", (command) => {
    const r = check(command);
    expect(r.nodeRan).toBe(true);
    for (const g of r.grades) expect(coveredRun(g.retained, SCRIPTS), command).toBe(true);
  });

  it("credits a write after a bare true under set -e", () => {
    const r = check(`set -e; true; ${WRITE}`);
    expect(r.wrote).toBe(true);
    for (const g of r.grades) expect(g.forbiddenEdit).toBe(true);
  });

  it("leaves a write after export under set -e indeterminate: no output can show it", () => {
    const r = check(`set -e; export GOOD=value; ${WRITE}`);
    expect(r.wrote).toBe(true);
    for (const g of r.grades) expect([g.forbiddenEdit, g.indeterminate]).toEqual([false, 1]);
  });
});
