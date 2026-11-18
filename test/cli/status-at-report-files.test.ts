import { describe, expect, it } from "vitest";
import { parseAt } from "../../src/cli/status-at.js";
import {
  type AtReport,
  compareSides,
  formatAt,
  jsonAt,
  type SideState,
  stateOf,
} from "../../src/cli/status-at-report.js";
import { result } from "../store/helpers.js";

/*
 * Row 023-19 (lessons P6, P8): a cold store's unknown files are grouped by
 * their states with a count and a few paths, every file behind `--full`
 * and in the JSON; a test file new since the commit gets one line naming
 * `squeal proof <file> --base <commit>`.
 */

const OWN = "own-worktree-id1";
const DAY = 86_400_000;
const NOW = 100 * DAY;
const ref = (path: string) => ({ project: "", path });
const pass: SideState = stateOf(
  "k1",
  [result({ kind: "file", project: "", testPath: "x" }, "k1", { worktreeId: OWN })],
  OWN,
);
const none = (key: string): SideState => ({ state: "no result", key });

function report(files: AtReport["files"]): AtReport {
  return {
    commit: "1234567890abcdef",
    commitTimeMs: NOW - DAY,
    head: "fedcba0987654321",
    dirty: false,
    now: { kind: "daemon", revision: 3 },
    checkoutMs: 1000,
    failure: null,
    files,
  };
}

/** `n` files with no result on both sides, and one that changed. */
function cold(n: number): AtReport {
  const refs = Array.from({ length: n }, (_, i) => ref(`t/f${String(i).padStart(3, "0")}.test.ts`));
  const fail: SideState = { ...pass, state: "fail", failed: ["x"] } as SideState;
  return report(
    compareSides(
      [...refs, ref("t/changed.test.ts")],
      (r) => (r.path === "t/changed.test.ts" ? pass : none("a")),
      (r) => (r.path === "t/changed.test.ts" ? fail : none("b")),
    ),
  );
}

describe("status --at groups unknown files (row 023-19, P6)", () => {
  it("folds a large group into one line with its count and three paths", () => {
    const text = formatAt(cold(1200), NOW);
    expect(text).toContain(
      "1200 test files: no result -> no result: t/f000.test.ts, t/f001.test.ts, t/f002.test.ts and 1197 more\n",
    );
    expect(text).not.toContain("t/f003.test.ts");
    // A changed file keeps its own line.
    expect(text).toContain("t/changed.test.ts: pass -> fail");
    expect(text).toContain("`--full` lists every file; `--json` gives each file's states.");
    expect(text).toContain("1 pass -> fail, 0 fail -> pass, 0 unchanged, 1200 unknown");
    expect(text.split("\n").length).toBeLessThan(15);
  });

  it("lists every file with --full, and the JSON always holds every file", () => {
    const text = formatAt(cold(1200), NOW, true);
    expect(text).toContain("t/f003.test.ts: no result -> no result\n");
    expect(text).toContain("t/f1199.test.ts: no result -> no result\n");
    expect(text).not.toContain("--full");
    expect(JSON.parse(jsonAt(cold(1200))).files).toHaveLength(1201);
  });

  it("keeps a group of three or fewer one file per line, and groups by the states' text", () => {
    const files = compareSides(
      [ref("a.test.ts"), ref("b.test.ts"), ...[1, 2, 3, 4].map((i) => ref(`n${i}.test.ts`))],
      (r) =>
        r.path.startsWith("n")
          ? { state: "not run", reason: "budget" }
          : { state: "not determined", reason: "no runner lists it" },
      () => pass,
    );
    const text = formatAt(report(files), NOW);
    expect(text).toContain(
      "a.test.ts: not determined (no runner lists it) -> pass (now: run in this worktree)\n",
    );
    expect(text).toContain(
      "4 test files: not run (budget) -> pass (now: run in this worktree): n1.test.ts, n2.test.ts, n3.test.ts and 1 more\n",
    );
    // The larger group comes first.
    expect(text.indexOf("4 test files")).toBeLessThan(text.indexOf("a.test.ts:"));
  });

  it("takes --full with --at", () => {
    expect(parseAt(["--at", "a", "--full"])).toMatchObject({ full: true });
    expect(parseAt(["--at", "a"])).not.toHaveProperty("full");
  });
});

describe("status --at points a new test file at squeal proof (row 023-19, P8)", () => {
  const files = (n: number) =>
    compareSides(
      [ref("old.test.ts"), ...Array.from({ length: n }, (_, i) => ref(`new${i}.test.ts`))],
      (r) => (r.path === "old.test.ts" ? pass : { state: "absent" }),
      () => pass,
    );

  it("adds one line per new file naming squeal proof with the commit as base", () => {
    const text = formatAt(report(files(1)), NOW);
    expect(text).toContain("new0.test.ts: absent -> pass");
    expect(text).toContain(
      "new0.test.ts is new since 123456789: `squeal proof new0.test.ts --base 123456789` shows whether it fails on the code at 123456789.\n",
    );
    expect(text).not.toContain("old.test.ts is new");
    const value = JSON.parse(jsonAt(report(files(1))));
    expect(value.files.find((f: { path: string }) => f.path === "new0.test.ts").proof).toBe(
      "squeal proof new0.test.ts --base 123456789",
    );
    expect(value.files.find((f: { path: string }) => f.path === "old.test.ts")).not.toHaveProperty(
      "proof",
    );
  });

  it("names three new files and counts the rest; a file absent on both sides is not new", () => {
    const text = formatAt(report(files(5)), NOW);
    expect(text.match(/ is new since /g)).toHaveLength(3);
    expect(text).toContain(
      "2 more test files are new since 123456789; `squeal proof <file> --base 123456789` does the same for each.",
    );
    const gone = compareSides(
      [ref("gone.test.ts")],
      () => ({ state: "absent" }),
      () => ({
        state: "absent",
      }),
    );
    expect(formatAt(report(gone), NOW)).not.toContain("is new since");
  });
});
