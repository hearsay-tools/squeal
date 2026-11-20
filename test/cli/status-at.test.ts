import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { parseAt } from "../../src/cli/status-at.js";
import { select } from "../../src/cli/status-at-now.js";
import {
  type AtReport,
  change,
  commitState,
  compareSides,
  exitCode,
  formatAt,
  jsonAt,
  type SideState,
  stateOf,
} from "../../src/cli/status-at-report.js";
import { importMark } from "../../src/core/types/state.js";
import { result } from "../store/helpers.js";

/*
 * Row 023-06 (spec 023 D1, D3): `status --at`'s arguments, its per-file
 * states with their origins, the comparison, the text and the JSON, with
 * no repository. `status-at-fixture.test.ts` runs the command on git
 * fixtures.
 */

const OWN = "own-worktree-id1";
const file = (path: string) => ({ kind: "file", project: "", testPath: path }) as const;
const test = (path: string, fullName: string) =>
  ({ kind: "test", project: "", testPath: path, fullName }) as const;
const ref = (path: string) => ({ project: "", path });
const pass: SideState = stateOf("k1", [result(file("a.test.ts"), "k1", { worktreeId: OWN })], OWN);
const fail: SideState = stateOf(
  "k2",
  [result(test("a.test.ts", "adds"), "k2", { outcome: "fail", worktreeId: OWN })],
  OWN,
);

describe("status --at arguments (rows 023-06, 023-07)", () => {
  it("takes the commit, paths and --json, and refuses what it does not take", () => {
    expect(parseAt(["--at", "HEAD~1", "test/a.test.ts", "--json"])).toEqual({
      commit: "HEAD~1",
      paths: ["test/a.test.ts"],
      json: true,
      run: null,
    });
    expect(parseAt(["--at=abc"])).toEqual({ commit: "abc", paths: [], json: false, run: null });
    expect(parseAt(["--at"])).toBe("--at needs a commit");
    expect(parseAt(["--at", "--json"])).toBe("--at needs a commit");
    expect(parseAt(["--at", "a", "--at", "b"])).toBe("--at is given twice");
    expect(parseAt(["--at", "a", "--wait", "10"])).toBe('unknown option "--wait" with --at');
    expect(parseAt(["--at=", "--json"])).toBe("--at needs a commit");
  });

  it("takes --run with --all-missing and one --timeout, 300 s by default (rows 023-07, 023-19)", () => {
    // Row 023-19 (P3): well inside a 600 s tool call, the keying and the removal included.
    expect(parseAt(["--at", "a", "--run"])).toMatchObject({
      run: { allMissing: false, timeoutSeconds: 300 },
    });
    expect(parseAt(["--run", "--all-missing", "--timeout", "90", "--at", "a", "x"])).toEqual({
      commit: "a",
      paths: ["x"],
      json: false,
      run: { allMissing: true, timeoutSeconds: 90 },
    });
    expect(parseAt(["--at", "a", "--run", "--timeout=30"])).toMatchObject({
      run: { timeoutSeconds: 30 },
    });
    expect(parseAt(["--at", "a", "--all-missing"])).toBe("--all-missing needs --run");
    expect(parseAt(["--at", "a", "--timeout", "5"])).toBe("--timeout needs --run");
    expect(parseAt(["--at", "a", "--run", "--timeout", "0"])).toBe(
      "--timeout takes whole seconds above 0",
    );
    expect(parseAt(["--at", "a", "--run", "--timeout"])).toBe("--timeout needs whole seconds");
    expect(parseAt(["--at", "a", "--run", "--timeout=1", "--timeout=2"])).toBe(
      "--timeout is given twice",
    );
  });

  it("exits 2 on a usage error through main, and its help line is in status's help", async () => {
    const err: string[] = [];
    const io = { stdout: () => {}, stderr: (t: string) => err.push(t) };
    expect(await main(["status", "--at"], io)).toBe(2);
    expect(err.join("")).toContain("squeal status: --at needs a commit");
    const out: string[] = [];
    expect(main(["status", "--help"], { stdout: (t) => out.push(t), stderr: () => {} })).toBe(0);
    expect(out.join("")).toContain(
      "squeal status --at <commit> [<path>...] [--run [--all-missing] [--timeout <seconds>]] [--full] [--json]",
    );
  });
});

describe("status --at states and comparison (D3)", () => {
  it("reads pass, fail with its failed tests, no result, absent and not determined", () => {
    expect(pass).toMatchObject({ state: "pass", key: "k1", origin: { kind: "own" } });
    expect(fail).toMatchObject({ state: "fail", failed: ["adds"] });
    expect(stateOf("k3", [], OWN)).toEqual({ state: "no result", key: "k3" });
    expect(commitState(undefined, OWN)).toEqual({ state: "absent" });
    const absent = { notDetermined: { reason: "absent", detail: "gone" } } as const;
    expect(commitState(absent, OWN)).toEqual({ state: "absent" });
    const install = { notDetermined: { reason: "install", detail: "npm ci: exit 1" } } as const;
    expect(commitState(install, OWN)).toEqual({
      state: "not determined",
      reason: "install: npm ci: exit 1",
    });
  });

  it("names each origin: CI's export, an import, this worktree, another worktree", () => {
    const at = (worktreeId: string, extra = {}) =>
      stateOf("k", [{ ...result(file("a"), "k", { worktreeId }), ...extra }], OWN);
    expect(at(OWN, { origin: "ci" })).toMatchObject({ origin: { kind: "ci", worktreeId: null } });
    expect(at(importMark("i1"))).toMatchObject({ origin: { kind: "import" } });
    expect(at(OWN)).toMatchObject({ origin: { kind: "own" } });
    expect(at("other-worktree00")).toMatchObject({
      origin: { kind: "worktree", worktreeId: "other-worktree00" },
    });
  });

  it("compares: pass to fail, fail to pass, unchanged, unknown on either side", () => {
    const none = stateOf("k", [], OWN);
    expect(change(pass, fail)).toBe("pass -> fail");
    expect(change(fail, pass)).toBe("fail -> pass");
    expect(change(fail, fail)).toBe("unchanged");
    expect(change(none, pass)).toBe("unknown");
    expect(change(pass, { state: "absent" })).toBe("unknown");
    const files = compareSides(
      [ref("b"), ref("a")],
      () => pass,
      () => pass,
    );
    expect(files.map((f) => f.ref.path)).toEqual(["a", "b"]);
    expect(exitCode(files)).toBe(0);
    expect(
      exitCode(
        compareSides(
          [ref("a")],
          () => none,
          () => pass,
        ),
      ),
    ).toBe(3);
  });

  it("narrows by a file or a folder; a path that selects nothing now is the commit side's", () => {
    const all = [ref("test/a.test.ts"), ref("test/sub/b.test.ts"), ref("other/c.test.ts")];
    expect(select(all, ["test/sub"])).toEqual([ref("test/sub/b.test.ts")]);
    expect(select(all, ["test/sub/"])).toEqual([ref("test/sub/b.test.ts")]);
    expect(select(all, ["test/a.test.ts", "gone.test.ts"])).toEqual([ref("test/a.test.ts")]);
    expect(select(all, ["test/a"])).toEqual([]);
    expect(select(all, null)).toHaveLength(3);
  });
});

const DAY = 86_400_000;
const NOW = 100 * DAY;

function report(over: Partial<AtReport> = {}): AtReport {
  const none = stateOf("k", [], OWN);
  return {
    commit: "1234567890abcdef",
    commitTimeMs: NOW - DAY,
    head: "fedcba0987654321",
    dirty: true,
    now: { kind: "daemon", revision: 7 },
    checkoutMs: 6100,
    failure: null,
    files: compareSides(
      [ref("a.test.ts"), ref("b.test.ts"), ref("c.test.ts"), ref("d.test.ts")],
      (r) => ({ "a.test.ts": pass, "b.test.ts": fail, "c.test.ts": pass })[r.path] ?? none,
      (r) => ({ "a.test.ts": fail, "b.test.ts": pass, "c.test.ts": pass })[r.path] ?? pass,
    ),
    ...over,
  };
}

describe("status --at text and JSON (D1, D3)", () => {
  it("lists changed and unknown files one per line, then counts; unchanged only counted", () => {
    const text = formatAt(report(), NOW);
    expect(text).toContain("against the working tree (HEAD fedcba098, dirty)");
    expect(text).toContain("Now is this worktree's daemon at revision 7.");
    expect(text).toContain("Keys at 123456789 from a temporary checkout, 6.1 s.");
    expect(text).toContain(
      "a.test.ts: pass -> fail (at 123456789: run in this worktree; now: adds; run in this worktree)",
    );
    expect(text).toContain("b.test.ts: fail -> pass (at 123456789: adds; run in this worktree;");
    expect(text).toContain("d.test.ts: no result -> pass (now: run in this worktree)");
    expect(text).not.toContain("c.test.ts");
    expect(text).toContain("1 pass -> fail, 1 fail -> pass, 1 unchanged, 1 unknown");
    expect(text).not.toContain("kept 7 days");
  });

  it("says results are kept 7 days only when most files have none and the commit is older", () => {
    const none = stateOf("k", [], OWN);
    const missing = compareSides(
      [ref("a"), ref("b"), ref("c")],
      (r) => (r.path === "a" ? pass : none),
      () => pass,
    );
    const old = report({ files: missing, commitTimeMs: NOW - 9 * DAY });
    expect(formatAt(old, NOW)).toContain(
      "Results are kept 7 days; 123456789 is 9 days old, so most of its files have no result.",
    );
    expect(formatAt({ ...old, commitTimeMs: NOW - 6 * DAY }, NOW)).not.toContain("kept 7 days");
    expect(formatAt(report({ commitTimeMs: NOW - 9 * DAY }), NOW)).not.toContain("kept 7 days");
  });

  it("says when no daemon runs, and when the checkout gave no keys", () => {
    const text = formatAt(report({ now: { kind: "stored" }, failure: "install: exit 1" }), NOW);
    expect(text).toContain(
      "No daemon runs in this worktree: now is the stored results at the working tree's keys.",
    );
    expect(text).toContain("The checkout gave no keys: install: exit 1");
  });

  it("writes a versioned JSON report with the commit, HEAD, dirty flag, both sides and the checkout time", () => {
    const value = JSON.parse(jsonAt(report()));
    expect(value).toMatchObject({
      version: "squeal-status-at/1",
      commit: "1234567890abcdef",
      head: "fedcba0987654321",
      dirty: true,
      now: { kind: "daemon", revision: 7 },
      checkoutMs: 6100,
      counts: { "pass -> fail": 1, "fail -> pass": 1, unchanged: 1, unknown: 1 },
    });
    expect(value.files[0]).toMatchObject({
      path: "a.test.ts",
      change: "pass -> fail",
      at: { state: "pass", key: "k1", origin: { kind: "own" } },
      now: { state: "fail", failed: ["adds"] },
    });
  });
});
