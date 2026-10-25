import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../../src/core/fs/worktree-paths.js";
import type { AbsolutePath, TestFileRef } from "../../../../src/core/types/index.js";
import { parsePytestEvents } from "../../../../src/runners/pytest/run/events.js";
import { observeBatch } from "../../../../src/runners/pytest/run/observed.js";
import { type BatchFile, readBatch } from "../../../../src/runners/pytest/run/report.js";

/*
 * Spec 007 D3 and D6 on recorded event files: `squeal_pytest`'s streams of
 * the small fixture's outcome files under Python 3.13 and pytest 9.1.1,
 * with the fixture copy's path written as `<root>`. `phases.jsonl` is one
 * batch of test_phases, test_collection_error, test_fail, test_module_skip
 * and test_pass; `killed.jsonl` is test_pass then test_hang, SIGKILLed in
 * test_hang's call.
 */

const ROOT = "/w/small" as AbsolutePath;
const paths = new WorktreePaths(ROOT);

function recorded(name: string) {
  const text = readFileSync(join(import.meta.dirname, "recorded", name), "utf8");
  return parsePytestEvents(text.replaceAll("<root>", ROOT));
}

function batch(names: readonly string[]): BatchFile[] {
  return names.map((name) => ({
    testFile: { project: "small", path: `outcomes/${name}` },
    real: join(ROOT, "outcomes", name) as AbsolutePath,
  }));
}

const outcomes = (results: readonly { check: { fullName: string }; outcome: string }[]) =>
  Object.fromEntries(results.map((r) => [r.check.fullName, r.outcome]));

describe("readBatch on a recorded batch (spec 007 D3, D6)", () => {
  const files = batch([
    "test_phases.py",
    "test_collection_error.py",
    "test_fail.py",
    "test_module_skip.py",
    "test_pass.py",
  ]);
  const read = readBatch(recorded("phases.jsonl"), files, ROOT, paths);
  const file = (name: string) => read.files.find((f) => f.testFile.path === `outcomes/${name}`);

  it("joins the three phases into D3's outcomes", () => {
    expect(outcomes(file("test_phases.py")?.results ?? [])).toEqual({
      test_setup_error: "fail",
      test_teardown_error: "fail",
      test_skip: "skip",
      test_xfail: "skip",
      test_xpass: "pass",
      test_strict_xpass: "fail",
    });
  });

  it("gives a failing setup or teardown that phase's error, its line from reprcrash", () => {
    const results = file("test_phases.py")?.results ?? [];
    const setup = results.find((r) => r.check.fullName === "test_setup_error");
    const teardown = results.find((r) => r.check.fullName === "test_teardown_error");
    expect(setup?.errors).toMatchObject([
      {
        name: "ValueError",
        message: "[setup] fixture setup",
        location: { path: "outcomes/test_phases.py", line: 6 },
      },
    ]);
    expect(teardown?.errors).toMatchObject([
      { name: "ValueError", message: "[teardown] fixture teardown" },
    ]);
    const strict = results.find((r) => r.check.fullName === "test_strict_xpass");
    expect(strict?.errors[0]?.message).toContain("[XPASS(strict)]");
  });

  it("takes a check's location from report.location, made one-based", () => {
    const failing = file("test_fail.py")?.results.find((r) => r.check.fullName === "test_fails");
    expect(failing?.location).toEqual({ path: "outcomes/test_fail.py", line: 5, column: 1 });
    expect(failing?.errors[0]).toMatchObject({
      name: "AssertionError",
      location: { path: "outcomes/test_fail.py", line: 6 },
    });
    expect(failing?.errors[0]?.stack).not.toContain(ROOT);
  });

  it("makes a collection error a file-level error and keeps the batch's other files", () => {
    const broken = file("test_collection_error.py");
    expect(broken).toMatchObject({ completed: true, results: [] });
    expect(broken?.fileError?.errors).toMatchObject([
      { name: "ModuleNotFoundError", message: "No module named 'app.not_there'" },
    ]);
    expect(file("test_pass.py")).toMatchObject({ completed: true, fileError: null });
    expect(outcomes(file("test_fail.py")?.results ?? [])).toEqual({
      test_passes_beside_the_failure: "pass",
      test_fails: "fail",
    });
  });

  it("completes a module-level skip with its reason and no results", () => {
    expect(file("test_module_skip.py")).toMatchObject({
      completed: true,
      results: [],
      skipped: expect.stringContaining("skipped on purpose"),
    });
  });

  it("sums a file's items into its duration and sees the session record", () => {
    const phases = file("test_phases.py");
    const sum = phases?.results.reduce((s, r) => s + r.durationMs, 0) ?? 0;
    expect(phases?.durationMs).toBe(Math.round(sum));
    expect(read.session).toBe(true);
  });
});

describe("readBatch on a batch killed mid-file (spec 007 D6)", () => {
  const files = batch(["test_pass.py", "test_hang.py"]);
  const events = recorded("killed.jsonl");

  it("keeps the file whose every item tore down and drops the one in progress", () => {
    const read = readBatch(events, files, ROOT, paths);
    expect(read.session).toBe(false);
    expect(read.files.map((f) => [f.testFile.path, f.completed])).toEqual([
      ["outcomes/test_pass.py", true],
      ["outcomes/test_hang.py", false],
    ]);
    expect(read.files[1]?.results).toEqual([]);
  });

  it("completes nothing before collection finished", () => {
    const cut = events.slice(
      0,
      events.findIndex((e) => e.type === "collected"),
    );
    expect(readBatch(cut, files, ROOT, paths).files.every((f) => !f.completed)).toBe(true);
  });

  it("does not complete a file whose last item ran its call but not its teardown", () => {
    const cut = events.filter(
      (e) => !(e.type === "phase" && e.nodeid.endsWith("test_passes") && e.when === "teardown"),
    );
    expect(readBatch(cut, files, ROOT, paths).files[0]?.completed).toBe(false);
  });
});

describe("readBatch's node ids (spec 007 D3)", () => {
  it("names the ids holding a memory address, which change every run", () => {
    const [file] = batch(["test_ids.py"]);
    const real = file?.real ?? "";
    const read = readBatch(
      [
        {
          type: "collected",
          items: [
            { nodeid: "outcomes/test_ids.py::test_id[<object at 0x7f3a2c1d9e50>]", path: real },
            { nodeid: "outcomes/test_ids.py::test_id[value0]", path: real },
          ],
        },
      ],
      file === undefined ? [] : [file],
      ROOT,
      paths,
    );
    expect(read.addressIds).toEqual(["outcomes/test_ids.py::test_id[<object at 0x7f3a2c1d9e50>]"]);
  });
});

describe("observeBatch (spec 007 D6)", () => {
  const ref = (path: string): TestFileRef => ({ project: "p", path });
  const file = (path: string): BatchFile => ({
    testFile: ref(path),
    real: `${ROOT}/${path}` as AbsolutePath,
  });
  const edge = (from: string | null, to: string, ctx: string | null = null) => ({
    type: "import" as const,
    from: from === null ? null : `${ROOT}/${from}`,
    to: `${ROOT}/${to}`,
    ctx: ctx === null ? null : `${ROOT}/${ctx}`,
  });

  it("roots a file at itself and the conftests above it, and attributes pytest's imports to the item in progress", () => {
    const observed = observeBatch(
      [
        edge(null, "tests/__init__.py"),
        edge(null, "tests/conftest.py"),
        edge("tests/conftest.py", "src/app/version.py"),
        edge(null, "tests/unit/conftest.py"),
        edge("tests/unit/conftest.py", "src/app/numbers.py"),
        edge(null, "src/plugin.py"),
        edge("src/plugin.py", "src/plugin_dep.py"),
        edge(null, "tests/unit/test_a.py", "tests/unit/test_a.py"),
        edge("tests/unit/test_a.py", "src/app/core.py", "tests/unit/test_a.py"),
        edge(null, "src/app/lazy.py", "tests/unit/test_a.py"),
        edge(null, "tests/test_b.py", "tests/test_b.py"),
      ],
      [file("tests/unit/test_a.py"), file("tests/test_b.py")],
      paths,
    );
    expect(observed.closures.map((c) => c.paths)).toEqual([
      [
        "src/app/core.py",
        "src/app/lazy.py",
        "src/app/numbers.py",
        "src/app/version.py",
        "tests/conftest.py",
        "tests/unit/conftest.py",
        "tests/unit/test_a.py",
      ],
      ["src/app/version.py", "tests/conftest.py", "tests/test_b.py"],
    ]);
    expect(observed.session).toEqual(["src/plugin.py", "src/plugin_dep.py", "tests/__init__.py"]);
  });

  it("puts what a test's child processes found one hop from that test file, never in the session (007-55)", () => {
    const spawned = (to: string, ctx: string) => ({
      type: "spawned" as const,
      to: `${ROOT}/${to}`,
      ctx: `${ROOT}/${ctx}`,
      pid: 7,
    });
    const observed = observeBatch(
      [
        edge(null, "tests/test_a.py", "tests/test_a.py"),
        spawned("src/app/__main__.py", "tests/test_a.py"),
        spawned("src/app/cli.py", "tests/test_a.py"),
        // a child pytest's conftest roots no file of this batch
        spawned("tests/conftest.py", "tests/test_a.py"),
        edge(null, "tests/test_b.py", "tests/test_b.py"),
      ],
      [file("tests/test_a.py"), file("tests/test_b.py")],
      paths,
    );
    expect(observed.closures).toEqual([
      {
        testFile: ref("tests/test_a.py"),
        paths: ["src/app/__main__.py", "src/app/cli.py", "tests/conftest.py", "tests/test_a.py"],
        spawned: ["src/app/__main__.py", "src/app/cli.py", "tests/conftest.py"],
        written: [],
      },
      { testFile: ref("tests/test_b.py"), paths: ["tests/test_b.py"], spawned: [], written: [] },
    ]);
    expect(observed.session).toEqual([]);
  });
});
