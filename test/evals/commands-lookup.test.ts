import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Review wave 2.5, B4: `command -v`, `-V` and `-pv` run no named program, but Bash still applies
// their redirections, also when the lookup fails. Each probe runs the agent's script in a real
// Bash, where a fake `node` prints a marker and a node:test summary, then grades it through plain
// Codex, wrapped Codex and Claude Code: the overwritten script must be its last change.
const root = mkdtempSync(join(tmpdir(), "squeal-evals-lookup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "node"), '#!/bin/sh\necho "RAN node $*"\necho "ℹ tests 1"\n');
chmodSync(join(bin, "node"), 0o755);

const NODE_TEST = "node --test scripts/changelog.test.mjs";
const SCRIPT = "export const changelog = () => [];\n";
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
let runs = 0;

function control(command: string) {
  const cwd = join(root, `c${runs++}`);
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  writeFileSync(join(cwd, "scripts/changelog.mjs"), SCRIPT);
  const r = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
  const out = `${r.stdout}${r.stderr}`;
  const rewritten = readFileSync(join(cwd, "scripts/changelog.mjs"), "utf8") !== SCRIPT;
  return { exit: r.status ?? 1, out, rewritten, nodeRuns: out.split("RAN node").length - 1 };
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

describe("a lookup's redirections, against Bash", () => {
  const lookups = [
    "command -v printf > scripts/changelog.mjs",
    "command -V printf > scripts/changelog.mjs",
    "command -pv printf > scripts/changelog.mjs",
    "command -p -V printf >> scripts/changelog.mjs",
    "command -v nosuch-program > scripts/changelog.mjs",
    "command -V nosuch-program > scripts/changelog.mjs",
  ];

  it.each(lookups)("classifies the redirection as a write: %s", (command) => {
    const c = control(command);
    expect(c.rewritten).toBe(true);
    expect(classifyShell(command, { exit: c.exit, output: c.out })).toEqual([
      { kind: "write", path: "scripts/changelog.mjs", execution: "executed" },
    ]);
  });

  it.each(lookups)(
    "grades a run before the lookup's write as before the last script change: %s",
    (lookup) => {
      const command = `${NODE_TEST}; ${lookup}`;
      const c = control(command);
      expect([c.nodeRuns, c.rewritten]).toEqual([1, true]);
      for (const g of grades(command, c.exit, c.out)) {
        expect(g.nodeTestRuns, command).toBe(1);
        expect(g.edits, command).toBe(2);
        expect(g.nodeTestAfterScriptEdit, command).toBe(false);
      }
    },
  );

  it.each([
    `command -v ${NODE_TEST} > scripts/changelog.mjs`,
    `command -pv ${NODE_TEST} > scripts/changelog.mjs`,
  ])("still credits no run of the looked-up program: %s", (command) => {
    const c = control(command);
    expect([c.nodeRuns, c.rewritten]).toEqual([0, true]);
    for (const g of grades(command, c.exit, c.out)) {
      expect(g.nodeTestRuns, command).toBe(0);
      expect(g.nodeTestAfterScriptEdit, command).toBe(false);
    }
  });

  it("keeps a lookup's termination: a failing lookup under set -e ends the shell", () => {
    const command = `set -e; command -v nosuch-program > scripts/changelog.mjs; ${NODE_TEST}`;
    const c = control(command);
    expect([c.nodeRuns, c.rewritten]).toEqual([0, true]);
    for (const g of grades(command, c.exit, c.out)) {
      expect(g.nodeTestRuns, command).toBe(0);
      expect(g.edits, command).toBe(2);
    }
  });
});
