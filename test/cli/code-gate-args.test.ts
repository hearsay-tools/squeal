import { describe, expect, it } from "vitest";
import { isGate, narrow } from "../../src/cli/code-gate.js";
import { DEFAULT_BUDGET_SECONDS, parseGateArgs } from "../../src/cli/code-gate-args.js";
import { main } from "../../src/cli/main.js";
import type { ChangedSet } from "../../src/core/code/gate/types.js";

/*
 * Spec 020 D1 (row 020-05): the arguments of `squeal code --base`, the
 * narrowing by paths, and the text lines the end-to-end runs do not reach.
 */

describe("parseGateArgs (spec 020 D1)", () => {
  it("takes the ref, paths, --test files, the budget and --json", () => {
    expect(isGate(["src", "--base=origin/main"])).toBe(true);
    expect(isGate(["src", "--changed"])).toBe(false);
    expect(parseGateArgs(["--base", "origin/main"])).toEqual({
      ref: "origin/main",
      paths: [],
      tests: [],
      budgetSeconds: DEFAULT_BUDGET_SECONDS,
      json: false,
    });
    expect(
      parseGateArgs([
        "src",
        "lib/a.ts",
        "--base=main",
        "--test",
        "test/a.test.ts",
        "test/b.test.ts",
        "--timeout",
        "90",
        "--test=test/c.test.ts",
        "--json",
      ]),
    ).toEqual({
      ref: "main",
      paths: ["src", "lib/a.ts"],
      tests: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"],
      budgetSeconds: 90,
      json: true,
    });
  });

  it.each([
    [["--base"], "--base names no ref"],
    [["--base", "--json"], "--base names no ref"],
    [["--base", "a", "--base", "b"], "--base is given twice"],
    [["--base", "main", "--changed"], "--base does not combine with --changed"],
    [["--base", "main", "--told"], "--base does not combine with --told"],
    [["--base", "main", "--timeout", "0"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--timeout", "1.5"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--timeout", "-5"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--timeout"], "--timeout takes whole seconds above 0"],
    [["--base", "main", "--test"], "--test names no file"],
    [["--base", "main", "--test="], "--test names no file"],
    [["--base", "main", "--json=yes"], 'unknown option "--json=yes"'],
    [["--base", "main", "--all"], 'unknown option "--all"'],
    [["--base", "main", "--exceptions"], "--exceptions names no file"],
    [["--base", "main", "--exceptions="], "--exceptions names no file"],
    [["--base", "main", "--exceptions", "a", "--exceptions", "b"], "--exceptions is given twice"],
    [["--base", "main", "--parts"], "--parts names no directory"],
    [["--base", "main", "--parts", "--json"], "--parts names no directory"],
    [["--base", "main", "--parts="], "--parts names no directory"],
    [["--base", "main", "--group"], "--group names no check group"],
    [["--base", "main", "--group", "--json"], "--group names no check group"],
    [["--base", "main", "--group="], "--group names no check group"],
  ])("refuses %j", (args, error) => {
    expect(parseGateArgs(args)).toEqual({ error: expect.stringContaining(error) });
  });

  it("takes the check groups, which only --group adds (spec 020 D14.1)", () => {
    const args = ["src", "--base", "main", "--group", "browser", "e2e", "--group=slow", "--json"];
    expect(parseGateArgs(args)).toEqual({
      ref: "main",
      paths: ["src"],
      tests: [],
      budgetSeconds: DEFAULT_BUDGET_SECONDS,
      json: true,
      groups: ["browser", "e2e", "slow"],
    });
  });

  it("takes an exceptions file, which only --exceptions adds (spec 020 D8)", () => {
    expect(parseGateArgs(["--base", "main", "--exceptions", "/tmp/x.json", "--json"])).toEqual({
      ref: "main",
      paths: [],
      tests: [],
      budgetSeconds: DEFAULT_BUDGET_SECONDS,
      json: true,
      exceptions: "/tmp/x.json",
    });
    expect(parseGateArgs(["--base", "main", "--exceptions=e.json"])).toMatchObject({
      exceptions: "e.json",
    });
  });

  it("takes the parts' directories, which only --parts adds (spec 020 D13.2)", () => {
    const args = ["src", "--base", "main", "--parts", "p/1", "p/2", "--parts=p/3", "--json"];
    expect(parseGateArgs(args)).toEqual({
      ref: "main",
      paths: ["src"],
      tests: [],
      budgetSeconds: DEFAULT_BUDGET_SECONDS,
      json: true,
      parts: ["p/1", "p/2", "p/3"],
    });
  });
});

describe("narrow (spec 020 D1: paths narrow the changed functions)", () => {
  const fn = (path: string) => ({ path }) as ChangedSet["functions"][number];
  const changed = {
    ref: "main",
    baseCommit: "b",
    headCommit: "h",
    dirty: false,
    paths: ["README.md", "lib/c.ts", "src/a.ts", "src/big.ts", "src/notes.md", "src2/b.ts"],
    functions: [fn("src/a.ts"), fn("src2/b.ts"), fn("lib/c.ts")],
    counted: [{ path: "src/a.ts", blob: "x", functions: [] }],
    inErrors: [fn("lib/c.ts")],
    uncounted: [{ path: "src/big.ts", reason: "too-large" }],
    baseCounted: [
      { path: "src/a.ts", blob: "y", functions: [] },
      { path: "src2/b.ts", blob: "z", functions: [] },
    ],
    omitted: [
      { path: "src/a.ts", qualifiedName: "a", occurrence: 0, line: 1, reason: "unchanged" },
      { path: "src2/b.ts", qualifiedName: "b", occurrence: 0, line: 1, reason: "unchanged" },
    ],
  } as ChangedSet;

  it("keeps the files under each directory and each file named", () => {
    const narrowed = narrow(changed, ["src", "lib/c.ts"]);
    expect(narrowed.paths).toEqual(["lib/c.ts", "src/a.ts", "src/big.ts", "src/notes.md"]);
    expect(narrowed.functions.map((f) => f.path)).toEqual(["src/a.ts", "lib/c.ts"]);
    expect(narrowed.counted.map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(narrowed.inErrors.map((f) => f.path)).toEqual(["lib/c.ts"]);
    expect(narrowed.uncounted.map((u) => u.path)).toEqual(["src/big.ts"]);
    expect(narrowed.baseCounted?.map((c) => c.path)).toEqual(["src/a.ts"]);
    // Spec 020 D16 (row 020-18): only the left-out functions inside the paths.
    expect(narrowed.omitted?.map((o) => o.path)).toEqual(["src/a.ts"]);
  });

  it("keeps every path with none named, or with the worktree's top named", () => {
    expect(narrow(changed, [])).toBe(changed);
    expect(narrow(changed, [""]).functions).toHaveLength(3);
  });
});

describe("squeal --help (spec 020 D1)", () => {
  it("names squeal code --base after squeal code; its first line says it runs tests, with no daemon", () => {
    let out = "";
    const stdout = (text: string) => {
      out += text;
    };
    main(["--help"], { stdout, stderr: () => {} });
    const lines = out.split("\n");
    const gate = lines.indexOf(
      "  squeal code --base <ref> [<path>...] [--test <file>...] [--group <name>...]",
    );
    expect(gate).toBeGreaterThan(
      lines.indexOf("  squeal code [<path>...] [--changed | --told] [--json]"),
    );
    expect(lines[gate + 1]?.trim()).toBe(
      "[--timeout <seconds>] [--parts <dir>...] [--exceptions <file>] [--json]",
    );
    expect(lines[gate + 2]?.trim()).toMatch(/^Runs tests, with no daemon,/);
  });
});
