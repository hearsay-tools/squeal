import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { omittedTestFilesMetaKey } from "../../../src/core/scheduler/omitted-test-files.js";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../../src/harness/claude-code/index.js";
import { check, result, setKey } from "../../state/helpers.js";
import { recorded, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * Spec 007 D8 on 005 D8: a pytest command run from its project's `cwd` is
 * denied once when it names its files and every one is current, naming
 * them; with no path or a directory, run from anywhere else, or in any form
 * that falls through, it runs.
 */

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const A: TestFileRef = { project: "svc", path: "svc/tests/test_a.py" };
const B: TestFileRef = { project: "svc", path: "svc/tests/unit/test_b.py" };
const POLICY = {
  testCommand: { denyWhenCurrent: true },
  pytest: [{ name: "svc", cwd: "svc", args: [], env: {}, include: ["tests/**/test_*.py"] }],
};

/**
 * Registered, the Vitest file and the pytest files `listed` passing and
 * current under `policy`; `svc/.venv` synced. `A` and `B` are both on disk,
 * an unlisted one failing: bare pytest would still run it.
 */
async function answered(
  listed: readonly TestFileRef[] = [A, B],
  policy: object = POLICY,
): Promise<SquealRepo> {
  const r = squealRepo();
  r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
  for (const [i, file] of listed.entries())
    setKey(r.store, `k${i}`, { file, worktreeId: r.worktreeId });
  r.apply(
    r.pass(),
    ...listed.map((file, i) => result(check(`test_${i}`, file), "pass", { key: `k${i}` })),
  );
  for (const file of [A, B]) {
    mkdirSync(dirname(join(r.root, file.path)), { recursive: true });
    const body = listed.includes(file) ? "assert True" : "assert False";
    writeFileSync(join(r.root, file.path), `def test_0():\n    ${body}\n`);
  }
  mkdirSync(join(r.root, "svc", ".venv"), { recursive: true });
  writeFileSync(join(r.root, "svc", ".venv", "pyvenv.cfg"), "home = /usr/bin\n");
  r.policy(policy);
  await runHook("session-start", recorded("session-start", r.root), deps);
  return r;
}

/** POLICY with the project's entry changed by `entry`. */
const svc = (entry: object) => ({ ...POLICY, pytest: [{ ...POLICY.pytest[0], ...entry }] });

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
    const reason = await reasonOf(r, "pytest -q tests/test_a.py::test_0");
    expect(reason).toContain(
      "Squeal holds current results at revision 1 for the 1 test file it runs " +
        "(svc/tests/test_a.py): 1 check passed, no known failures,",
    );
    expect(reason).not.toContain("test_b");
  });

  it.each([
    "pytest tests/test_a.py tests/unit/test_b.py",
    "python -m pytest tests/unit/test_b.py tests/test_a.py::test_0",
    "uv run pytest -q tests/test_a.py tests/unit/test_b.py",
    ".venv/bin/pytest tests/test_a.py tests/unit/test_b.py",
    ".venv/bin/python -m pytest -v tests/test_a.py tests/unit/test_b.py",
  ])("denies %s, which names the project's two files", async (command) => {
    const r = await answered();
    expect(await reasonOf(r, command)).toContain(
      "for the 2 test files it runs (svc/tests/test_a.py, svc/tests/unit/test_b.py)",
    );
  });

  // Review 007-19 B4: pytest's discovery under no path or a directory is not
  // Squeal's `include`, so its files' results prove nothing about the rest.
  it.each([
    "pytest",
    "python -m pytest tests",
    "uv run pytest tests/unit tests/test_a.py",
    ".venv/bin/pytest .",
    ".venv/bin/python -m pytest -v",
  ])(
    "runs %s, a bare or directory command, though every listed file is current",
    async (command) => {
      const r = await answered();
      expect(await bash(r, command)).toEqual(SILENT);
    },
  );

  it("runs a bare or directory command under a narrower include, and denies its file by name", async () => {
    const r = await answered([A], svc({ include: ["tests/test_a.py"] }));
    expect(await bash(r, "pytest")).toEqual(SILENT);
    expect(await bash(r, "pytest tests")).toEqual(SILENT);
    expect(await bash(r, "pytest tests/unit/test_b.py")).toEqual(SILENT);
    expect(await reasonOf(r, "pytest tests/test_a.py")).toContain(
      "for the 1 test file it runs (svc/tests/test_a.py)",
    );
  });

  it("runs a bare command while an excluded file, failing, sits beside the passing one", async () => {
    const r = await answered([A], svc({ exclude: ["tests/unit/**"] }));
    expect(await bash(r, "pytest")).toEqual(SILENT);
    expect(await bash(r, "pytest -q")).toEqual(SILENT);
    expect(await bash(r, "pytest tests/test_a.py tests/unit/test_b.py")).toEqual(SILENT);
  });

  it("runs a directory holding an unlisted test beside a listed, current one", async () => {
    const r = await answered([A], svc({ exclude: ["tests/unit/**"] }));
    expect(await bash(r, "pytest tests")).toEqual(SILENT);
    expect(await bash(r, "pytest tests/unit")).toEqual(SILENT);
    expect(await bash(r, "pytest tests/unit/")).toEqual(SILENT);
  });

  it("runs a pytest command from the root, a cd, or with a flag that changes what runs", async () => {
    const r = await answered();
    expect(await bash(r, "pytest", r.root)).toEqual(SILENT);
    expect(await bash(r, "cd svc && pytest", r.root)).toEqual(SILENT);
    expect(await bash(r, "pytest -x tests/test_a.py")).toEqual(SILENT);
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
