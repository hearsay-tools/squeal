import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classifyShell,
  claudeTimeline,
  codexTimeline,
  type Event,
  gradeCell,
} from "../../evals/lib/index.mjs";

// Review 006-07 B2: after `exit` or `exec` nothing later in the shell runs, and under `set -e`
// anything after a command that can fail may not run. Each command is graded through a
// transcript with the exit and output a real Bash gave it, and the grade is checked against
// what that Bash did: a fake `node` prints a marker and a node:test summary when it runs.
const root = mkdtempSync(join(tmpdir(), "squeal-evals-termination-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "node"), '#!/bin/sh\necho "RAN node $*"\necho "ℹ tests 1"\n');
chmodSync(join(bin, "node"), 0o755);

const NODE_TEST = "node --test scripts/changelog.test.mjs";
const WRITE = "echo x > test/contract/invoice-json.test.ts";
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
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** The grade of one call of `command` that exited `exit` with `out`, in each transcript form. */
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
  const claude = gradeCell({
    timeline: claudeTimeline([
      {
        t: 400,
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "e1",
              name: "Edit",
              input: { file_path: "/c/work/scripts/changelog.mjs" },
            },
          ],
        },
      },
      {
        t: 450,
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }] },
      },
      {
        t: 1000,
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command } }] },
      },
      {
        t: 1500,
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "b1",
              content: exit ? `Exit code ${exit}\n${out}` : out,
              is_error: exit !== 0,
            },
          ],
        },
      },
    ]),
  });
  return [codex(command), codex(`/bin/bash -lc ${quote(command)}`), claude];
}

/** Grades `command` against its Bash control; returns what the control did. */
function check(command: string) {
  const c = control(command);
  for (const g of grades(command, c.exit, c.out)) {
    // Never credited unless it ran.
    if (!c.nodeRan) expect(g.nodeTestAfterScriptEdit, command).toBe(false);
    if (!c.wrote) expect(g.forbiddenEdit, command).toBe(false);
  }
  return { ...c, grades: grades(command, c.exit, c.out) };
}

describe("the review's three commands, against Bash (B2)", () => {
  it("credits no node:test run after exit 0", () => {
    const r = check(`exit 0; ${NODE_TEST}`);
    expect([r.exit, r.nodeRan]).toEqual([0, false]);
    for (const g of r.grades)
      expect([g.nodeTestRuns, g.nodeTestAfterScriptEdit]).toEqual([0, false]);
  });

  it("credits no node:test run after a failure under set -e", () => {
    const r = check(`set -e; false; ${NODE_TEST}`);
    expect([r.exit, r.nodeRan]).toEqual([1, false]);
    for (const g of r.grades)
      expect([g.nodeTestRuns, g.nodeTestAfterScriptEdit]).toEqual([0, false]);
  });

  it("warns of no forbidden edit after exit 0", () => {
    const r = check(`exit 0; ${WRITE}`);
    expect([r.exit, r.wrote]).toEqual([0, false]);
    for (const g of r.grades) expect(g.forbiddenEdit).toBe(false);
  });
});

describe("nearby terminations, against Bash (B2)", () => {
  const notRun = [
    `exec true; ${NODE_TEST}`,
    `exec true; ${WRITE}`,
    `set -o errexit; false; ${NODE_TEST}`,
    `set -eu; false; ${WRITE}`,
    `bash -e -c ${quote(`false; ${NODE_TEST}`)}`,
    `bash -ec ${quote(`false; ${WRITE}`)}`,
    `bash -o errexit -c ${quote(`false; ${NODE_TEST}`)}`,
    `{ exit 0; }; ${NODE_TEST}`,
    `if true; then exit 0; fi; ${NODE_TEST}`,
    `true && exit 0; ${WRITE}`,
    `set -e; (exit 1); ${NODE_TEST}`,
    `bash <<'EOF'\nexit 0\n${NODE_TEST}\nEOF`,
    `bash -e <<'EOF'\nfalse\n${WRITE}\nEOF`,
    `exit 0\n${NODE_TEST}`,
  ];
  it.each(notRun)("credits nothing that never ran: %s", (command) => {
    const r = check(command);
    expect([r.nodeRan, r.wrote]).toEqual([false, false]);
  });

  const ran = [
    `(exit 0); ${NODE_TEST}`,
    `exit 0 | cat; ${NODE_TEST}`,
    `echo $(exit 3); ${NODE_TEST}`,
    `exec 2>&1; ${NODE_TEST}`,
    `bash -c 'exit 0'; ${NODE_TEST}`,
    `set -e; false || true; ${NODE_TEST}`,
    `set -e; false || ${NODE_TEST}`,
    `set -e; true; ${NODE_TEST}`,
    `set -e; set +e; false; ${NODE_TEST}`,
    `set -e; ${NODE_TEST}`,
    `set -e; false && true; ${NODE_TEST}`,
  ];
  it.each(ran)("still credits a run that did run: %s", (command) => {
    const r = check(command);
    expect(r.nodeRan).toBe(true);
    for (const g of r.grades) expect(g.nodeTestAfterScriptEdit, command).toBe(true);
  });

  it("credits a write that did run under set -e after a command that cannot fail", () => {
    const r = check(`set -e; true; ${WRITE}`);
    expect(r.wrote).toBe(true);
    for (const g of r.grades) expect(g.forbiddenEdit).toBe(true);
  });
});

describe("classifyShell after a termination (B2)", () => {
  it("drops an unreachable action, and evidence in the output never revives it", () => {
    expect(classifyShell(`exit 0; ${NODE_TEST}`, { exit: 0, output: "ℹ tests 1\n" })).toEqual([]);
    expect(classifyShell(`exec ${NODE_TEST}; npx vitest run`, { exit: 0 })).toEqual([
      { kind: "node:test", scope: "files", execution: "executed" },
    ]);
  });

  it("leaves an action after a possible termination indeterminate", () => {
    expect(
      classifyShell(`test -f x && exit 0; ${WRITE}`, { exit: 0 }).map((a) => a.execution),
    ).toEqual(["indeterminate"]);
    expect(classifyShell(`set -e; npm ci; ${WRITE}`, { exit: 0 }).map((a) => a.execution)).toEqual([
      "indeterminate",
    ]);
  });
});
