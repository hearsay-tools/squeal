import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// 006-12 item 3 (review wave 1.7's scope note): `command` takes options. `command -p set -e`
// runs `set -e`, so errexit is on after it; `command -p exit` ends the shell; `command -v` and
// `command -V` only look a name up and run nothing. Each command is graded through plain Codex,
// wrapped Codex and Claude Code against what a real Bash did with it: a fake `node` prints a
// marker and a node:test summary only when it runs.
const root = mkdtempSync(join(tmpdir(), "squeal-evals-command-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "node"), '#!/bin/sh\necho "RAN node $*"\necho "ℹ tests 1"\n');
chmodSync(join(bin, "node"), 0o755);

const NODE_TEST = "node --test scripts/changelog.test.mjs";
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
let runs = 0;

function control(command: string) {
  const cwd = join(root, `c${runs++}`);
  mkdirSync(cwd);
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
  const out = `${r.stdout}${r.stderr}`;
  return { exit: r.status ?? 1, out, nodeRan: out.includes("RAN node") };
}

function grades(command: string, exit: number, out: string) {
  const edit: Event = {
    t: 500,
    type: "item.completed",
    item: {
      id: "f1",
      type: "file_change",
      changes: [{ path: "/c/work/scripts/changelog.mjs", kind: "update" }],
      status: "completed",
    },
  };
  const codex = (text: string) =>
    gradeCell({
      timeline: codexTimeline([
        edit,
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
  const use = (id: string, name: string, input: unknown) => ({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
  const result = (id: string, content: string, error = false) => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: error }] },
  });
  const claude = gradeCell({
    timeline: claudeTimeline([
      { t: 400, ...use("e1", "Edit", { file_path: "/c/work/scripts/changelog.mjs" }) },
      { t: 450, ...result("e1", "ok") },
      { t: 1000, ...use("b1", "Bash", { command }) },
      { t: 1500, ...result("b1", exit ? `Exit code ${exit}\n${out}` : out, exit !== 0) },
    ]),
  });
  return [codex(command), codex(`/bin/bash -lc ${quote(command)}`), claude];
}

describe("`command` with options, against Bash", () => {
  const notRun = [
    `command -p set -e; true > absent/file; ${NODE_TEST}`,
    `command -p set -o errexit; true > absent/file; ${NODE_TEST}`,
    `command -p -- set -e; true > absent/file; ${NODE_TEST}`,
    `command -p exit 3; ${NODE_TEST}`,
    `command -p exec true; ${NODE_TEST}`,
    `command -v ${NODE_TEST}`,
    `command -V ${NODE_TEST}`,
    `command -pv ${NODE_TEST}`,
    `command -p -V ${NODE_TEST}`,
    `set -e; command -v nosuch-program; ${NODE_TEST}`,
  ];
  it.each(notRun)("credits no node:test run that never ran: %s", (command) => {
    const c = control(command);
    expect(c.nodeRan).toBe(false);
    for (const g of grades(command, c.exit, c.out)) {
      expect(g.nodeTestRuns, command).toBe(0);
      expect(coveredRun(g.retained, SCRIPTS), command).toBe(false);
    }
  });

  const ran = [
    `command -p set +e; true > absent/file; ${NODE_TEST}`,
    `command -v node; ${NODE_TEST}`,
    `command -V node && ${NODE_TEST}`,
    `command ${NODE_TEST}`,
  ];
  it.each(ran)("still credits a run that did run: %s", (command) => {
    const c = control(command);
    expect(c.nodeRan).toBe(true);
    for (const g of grades(command, c.exit, c.out))
      expect(coveredRun(g.retained, SCRIPTS), command).toBe(true);
  });
});
