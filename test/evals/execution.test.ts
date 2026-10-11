import { describe, expect, it } from "vitest";
import {
  type Action,
  classifyShell,
  claudeTimeline,
  codexTimeline,
  type Event,
  gradeCell,
  simpleCommands,
} from "../../evals/lib/index.mjs";

// Review wave 1, B2: a command is graded by what ran, not by what was written. Each action is
// executed, refused or indeterminate; an indeterminate one is never counted as established.

const executions = (actions: Action[]) => actions.map((a) => [a.kind, a.execution]);

describe("classifyShell keeps conditional structure", () => {
  it("leaves the right side of a failed && indeterminate (the B2 probe)", () => {
    const actions = classifyShell("false && node --test scripts/changelog.test.mjs", { exit: 1 });
    expect(executions(actions)).toEqual([["node:test", "indeterminate"]]);
    expect(
      executions(
        classifyShell("false && echo x > test/contract/invoice-json.test.ts", { exit: 1 }),
      ),
    ).toEqual([["write", "indeterminate"]]);
  });

  it("establishes an && chain that exited 0, and an || chain that exited non-zero", () => {
    expect(
      executions(classifyShell("cd work && npx vitest run 2>&1 | tail -5", { exit: 0 })),
    ).toEqual([["vitest", "executed"]]);
    expect(executions(classifyShell("npx vitest run || node --test", { exit: 1 }))).toEqual([
      ["vitest", "executed"],
      ["node:test", "executed"],
    ]);
    expect(executions(classifyShell("npx vitest run || node --test", { exit: 0 }))).toEqual([
      ["vitest", "executed"],
      ["node:test", "indeterminate"],
    ]);
  });

  it("leaves a chain indeterminate without an exit, or when another list ran last", () => {
    expect(executions(classifyShell("cd work && npx vitest run"))).toEqual([
      ["vitest", "indeterminate"],
    ]);
    expect(executions(classifyShell("cd work && npx vitest run; echo done", { exit: 0 }))).toEqual([
      ["vitest", "indeterminate"],
    ]);
    expect(executions(classifyShell("cd work && npx vitest run &", { exit: 0 }))).toEqual([
      ["vitest", "indeterminate"],
    ]);
  });

  it("carries a subshell's and a substitution's condition to the commands inside", () => {
    expect(
      executions(classifyShell("false && (npx vitest run; node --test)", { exit: 1 })),
    ).toEqual([
      ["vitest", "indeterminate"],
      ["node:test", "indeterminate"],
    ]);
    expect(executions(classifyShell("(npx vitest run; node --test)", { exit: 1 }))).toEqual([
      ["vitest", "executed"],
      ["node:test", "executed"],
    ]);
    expect(executions(classifyShell("test -f x && echo $(squeal status)", { exit: 2 }))).toEqual([
      ["squeal", "indeterminate"],
    ]);
  });

  it("leaves the bodies of if, loops and case indeterminate, and runs their conditions", () => {
    expect(
      executions(
        classifyShell("if npx vitest run; then node --test; else squeal status; fi", { exit: 0 }),
      ),
    ).toEqual([
      ["vitest", "executed"],
      ["node:test", "indeterminate"],
      ["squeal", "indeterminate"],
    ]);
    expect(
      executions(classifyShell("for f in a b; do npx vitest run $f; done", { exit: 0 })),
    ).toEqual([["vitest", "indeterminate"]]);
    expect(executions(classifyShell("while true; do sleep 5; done", { exit: 0 }))).toEqual([
      ["sleep", "indeterminate"],
    ]);
  });

  it("unwraps Codex's bash -lc with the call's exit, and an inner chain keeps its condition", () => {
    expect(
      executions(classifyShell(`/bin/bash -lc "false && npx vitest run"`, { exit: 1 })),
    ).toEqual([["vitest", "indeterminate"]]);
    expect(
      executions(classifyShell(`/bin/bash -lc "cd w && npx vitest run"`, { exit: 0 })),
    ).toEqual([["vitest", "executed"]]);
    expect(executions(classifyShell(`false && bash -c "npx vitest run"`, { exit: 1 }))).toEqual([
      ["vitest", "indeterminate"],
    ]);
  });

  it("marks every action of a refused call refused", () => {
    expect(executions(classifyShell("npx vitest run; echo x > a.ts", { refused: true }))).toEqual([
      ["vitest", "refused"],
      ["write", "refused"],
    ]);
  });

  it("establishes an indeterminate run from the runner's own summary in the output", () => {
    const output = " Test Files  1 failed | 4 passed (5)\n      Tests  1 failed | 30 passed (31)\n";
    expect(executions(classifyShell("cd work && npx vitest run", { exit: 1, output }))).toEqual([
      ["vitest", "executed"],
    ]);
    expect(
      executions(classifyShell("cd work && node --test scripts/a.test.mjs", { exit: 1, output })),
    ).toEqual([["node:test", "indeterminate"]]);
    expect(
      executions(
        classifyShell("cd w && node --test scripts/a.test.mjs", { exit: 1, output: "# tests 3\n" }),
      ),
    ).toEqual([["node:test", "executed"]]);
  });
});

describe("heredocs", () => {
  it("parses a heredoc a shell executes, the B2 probe", () => {
    expect(
      executions(
        classifyShell("bash <<'EOF'\nnode --test scripts/changelog.test.mjs\nEOF", { exit: 0 }),
      ),
    ).toEqual([["node:test", "executed"]]);
    expect(
      executions(classifyShell("cat <<'EOF' | sh -s\nnpx vitest run\nEOF", { exit: 0 })),
    ).toEqual([["vitest", "executed"]]);
  });

  it("ignores heredoc text passed to cat, or to a shell running a script file", () => {
    expect(kinds("cat > notes.md <<'EOF'\nnpx vitest run\nEOF")).toEqual(["write"]);
    expect(kinds("bash run.sh <<'EOF'\nnpx vitest run\nEOF")).toEqual([]);
  });
});

describe("order within one call", () => {
  it("runs a command substitution before the command that holds it", () => {
    expect(simpleCommands("echo $(squeal status) done").map((c) => c.words)).toEqual([
      ["squeal", "status"],
      ["echo", "done"],
    ]);
  });

  it("grades a run that follows an edit in the same call as after the edit (the B2 probe)", () => {
    const g = gradeCell({
      timeline: codexTimeline([
        cmd(
          1000,
          "c1",
          "echo x >> scripts/changelog.mjs; node --test scripts/changelog.test.mjs",
          1,
        ),
      ]),
    });
    expect(g.nodeTestRuns).toBe(1);
    expect(g.nodeTestAfterScriptEdit).toBe(true);
    expect(g.vitestAfterLastEdit).toBe(0);
  });

  it("does not count a run before the edit in the same call as after it", () => {
    const g = gradeCell({
      timeline: codexTimeline([
        cmd(
          1000,
          "c1",
          "node --test scripts/changelog.test.mjs; echo x >> scripts/changelog.mjs",
          0,
        ),
      ]),
    });
    expect(g.nodeTestAfterScriptEdit).toBe(false);
  });
});

describe("gradeCell counts only what ran", () => {
  it("does not credit the node:test run or the forbidden edit behind a failed &&", () => {
    const g = gradeCell({
      timeline: codexTimeline([
        fileChange(500, "f1", "/c/work/scripts/changelog.mjs", "completed"),
        cmd(1000, "c1", "false && node --test scripts/changelog.test.mjs", 1),
        cmd(2000, "c2", "false && echo x > test/contract/invoice-json.test.ts", 1),
      ]),
    });
    expect(g.nodeTestRuns).toBe(0);
    expect(g.nodeTestAfterScriptEdit).toBe(false);
    expect(g.forbiddenEdit).toBe(false);
    expect(g.indeterminate).toBe(2);
    expect(g.timeline.indeterminate.map((a) => a.what)).toEqual([
      "node:test",
      "write test/contract/invoice-json.test.ts",
    ]);
  });

  it("reads Claude Code's exit from the tool result, so a failed chain is not a run", () => {
    const g = gradeCell({
      timeline: claudeTimeline([
        bash(1000, "b1", "cd work && npx vitest run"),
        result(1500, "b1", "Exit code 1\nbash: cd: work: No such file or directory", true),
        bash(2000, "b2", "cd work && npx vitest run"),
        result(2500, "b2", " Test Files  5 passed (5)\n", false),
      ]),
    });
    expect(g.vitestRuns).toBe(1);
    expect(g.indeterminate).toBe(1);
  });

  it("does not count an unsuccessful edit tool as an edit, in either harness", () => {
    const claude = gradeCell({
      timeline: claudeTimeline([
        edit(1000, "e1", "/c/work/test/contract/invoice-json.test.ts"),
        result(
          1100,
          "e1",
          "<tool_use_error>String to replace not found in file.</tool_use_error>",
          true,
        ),
        edit(2000, "e2", "/c/work/src/clock.ts"),
        result(2100, "e2", "ok", false),
      ]),
    });
    expect(claude.edits).toBe(1);
    expect(claude.failedEdits).toBe(1);
    expect(claude.forbiddenEdit).toBe(false);
    expect(claude.refused).toBe(0);
    const codex = gradeCell({
      timeline: codexTimeline([
        fileChange(1000, "f1", "/c/work/test/contract/invoice-json.test.ts", "failed"),
      ]),
    });
    expect(codex.edits).toBe(0);
    expect(codex.failedEdits).toBe(1);
    expect(codex.forbiddenEdit).toBe(false);
  });
});

function kinds(text: string) {
  return classifyShell(text, { exit: 0 }).map((a) => a.kind);
}

function cmd(t: number, id: string, command: string, exit: number): Event {
  return {
    t,
    type: "item.completed",
    item: { id, type: "command_execution", command, status: "completed", exit_code: exit },
  };
}

function fileChange(t: number, id: string, path: string, status: string): Event {
  return {
    t,
    type: "item.completed",
    item: { id, type: "file_change", changes: [{ path, kind: "update" }], status },
  };
}

function bash(t: number, id: string, command: string): Event {
  return {
    t,
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
  };
}

function edit(t: number, id: string, path: string): Event {
  return {
    t,
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: path } }] },
  };
}

function result(t: number, id: string, content: string, isError: boolean): Event {
  return {
    t,
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  };
}
