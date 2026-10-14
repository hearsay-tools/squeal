import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { omittedTestFilesMetaKey } from "../../../src/core/scheduler/omitted-test-files.js";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../../src/harness/claude-code/index.js";
import { check, result, setKey } from "../../state/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * Spec 007 D8 on 005 D8: a pytest command run from its project's `cwd` is
 * denied once when every file it runs is current, naming those files; run
 * from anywhere else, or in any form that falls through, it runs.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const A: TestFileRef = { project: "svc", path: "svc/tests/test_a.py" };
const B: TestFileRef = { project: "svc", path: "svc/tests/unit/test_b.py" };
const POLICY = {
  testCommand: { denyWhenCurrent: true },
  pytest: [{ name: "svc", cwd: "svc", include: ["tests/**/test_*.py"] }],
};

/** Registered, the Vitest file and both pytest files passing and current; `svc/.venv` synced. */
async function answered(): Promise<SquealRepo> {
  const r = squealRepo();
  r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
  setKey(r.store, "ka", { file: A, worktreeId: r.worktreeId });
  setKey(r.store, "kb", { file: B, worktreeId: r.worktreeId });
  r.apply(
    r.pass(),
    result(check("test_one", A), "pass", { key: "ka" }),
    result(check("test_two", B), "pass", { key: "kb" }),
  );
  mkdirSync(join(r.root, "svc", ".venv"), { recursive: true });
  writeFileSync(join(r.root, "svc", ".venv", "pyvenv.cfg"), "home = /usr/bin\n");
  r.policy(POLICY);
  await runHook("session-start", recorded("session-start", r.root), deps);
  return r;
}

const bash = (r: SquealRepo, command: string, cwd = join(r.root, "svc")) =>
  runHook(
    "pre-tool-use",
    JSON.stringify({
      ...JSON.parse(recorded("pre-tool-use", cwd)),
      tool_name: "Bash",
      tool_input: { command },
    }),
    deps,
  );

async function reasonOf(r: SquealRepo, command: string, cwd?: string): Promise<string | null> {
  const out = await bash(r, command, cwd);
  if (out.stdout === "") return null;
  const parsed = JSON.parse(out.stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

describe("the one-time deny of a pytest command (spec 007 D8)", () => {
  it("denies a node ID's command with its file's results, naming only that file", async () => {
    const r = await answered();
    const reason = await reasonOf(r, "pytest -q tests/test_a.py::test_one");
    expect(reason).toContain(
      "Squeal holds current results at revision 1 for the 1 test file it runs " +
        "(svc/tests/test_a.py): 1 check passed, no known failures,",
    );
    expect(reason).not.toContain("test_b");
  });

  it.each([
    "pytest",
    "python -m pytest tests",
    "uv run pytest tests/unit tests/test_a.py",
    ".venv/bin/pytest",
    ".venv/bin/python -m pytest -v",
  ])("denies %s, resolved to the project's two files", async (command) => {
    const r = await answered();
    expect(await reasonOf(r, command)).toContain(
      "for the 2 test files it runs (svc/tests/test_a.py, svc/tests/unit/test_b.py)",
    );
  });

  it("runs a pytest command from the root, a cd, or with a flag that changes what runs", async () => {
    const r = await answered();
    expect(await bash(r, "pytest", r.root)).toEqual(SILENT);
    expect(await bash(r, "cd svc && pytest", r.root)).toEqual(SILENT);
    expect(await bash(r, "pytest -x tests")).toEqual(SILENT);
    expect(await bash(r, "pytest tests/test_missing.py")).toEqual(SILENT);
  });

  it("runs a Vitest command from the project's directory", async () => {
    const r = await answered();
    expect(await bash(r, "npx vitest run")).toEqual(SILENT);
  });

  it("still denies a Vitest command at the root, its files apart from pytest's", async () => {
    const r = await answered();
    expect(await reasonOf(r, "npx vitest run", r.root)).toContain(
      "for the 1 test file it runs (src/math.test.ts)",
    );
  });
});
