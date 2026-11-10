// Throwaway probe (survey 020-07, Q2 and Q4). Pure: no I/O, no store, no run.
// The same inputs through the daemon's coverage rules (015 D9:
// `fileCondition`, `coverageOf`, `judgeFiles`) and the gate's `evaluate`
// (020 D5), to show where the two disagree today.
// Usage (from the worktree root): node_modules/.bin/tsx <this file>
import { coverageOf, fileCondition } from "../../../../../../src/core/code/crap/file.ts";
import { judgeFiles } from "../../../../../../src/core/code/crap/judge.ts";
import type { Loader } from "../../../../../../src/core/code/crap/loaders.ts";
import { evaluate } from "../../../../../../src/core/code/gate/evaluate.ts";
import type { TestFileEvidence } from "../../../../../../src/core/code/gate/types.ts";
import type { CoverageRecord } from "../../../../../../src/core/code/coverage/types.ts";
import {
  BLOB,
  changedSet,
  evidence,
  fn,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "../../../../../../test/code/gate/evaluate-fixture.ts";

const PATH = "src/a.ts";
const TEST = "test/a.test.ts";
const KEY = "k1" as never;

interface Case {
  readonly name: string;
  readonly cc: number;
  /** The daemon's loaders of PATH; `ready` ones read `record`. */
  readonly loaders: readonly Loader["condition"][];
  readonly record: CoverageRecord | null;
  /** The gate's test files. */
  readonly files: (f: ReturnType<typeof fn>) => TestFileEvidence[];
}

const ready = { kind: "ready", key: KEY, storedAt: 1 } as const;
const ranRecord = (f: ReturnType<typeof fn>): CoverageRecord => ({
  v: 1,
  sources: [source(PATH, [f])],
  unread: [],
});

const cases: Case[] = [
  { name: "A no loader, CC 3", cc: 3, loaders: [], record: null, files: () => [] },
  { name: "A no loader, CC 7", cc: 7, loaders: [], record: null, files: () => [] },
  {
    name: "B loader ran it, a test failed",
    cc: 7,
    loaders: [ready],
    record: null,
    files: (f) => [testFile(TEST, [PATH], [source(PATH, [f])], { failed: ["a > fails"] })],
  },
  {
    name: "C loader ran it, a test skipped",
    cc: 7,
    loaders: [{ kind: "unknown", cause: "skipped" }],
    record: null,
    files: (f) => [testFile(TEST, [PATH], [source(PATH, [f])])],
  },
  {
    name: "C2 loader ran none of it, a test skipped",
    cc: 7,
    loaders: [{ kind: "unknown", cause: "skipped" }],
    record: null,
    files: (f) => [testFile(TEST, [PATH], [source(PATH, [f], { ran: [] })])],
  },
  {
    name: "E loader ran none of it",
    cc: 7,
    loaders: [ready],
    record: null,
    files: (f) => [testFile(TEST, [PATH], [source(PATH, [f], { ran: [] })])],
  },
];

const rows = [];
for (const c of cases) {
  const f = fn("work", [1, 10], c.cc);
  // Daemon side.
  const loaders: Loader[] = c.loaders.map((condition) => ({
    testFile: { project: "", path: TEST } as never,
    condition,
  }));
  const condition = fileCondition(loaders, true);
  let daemon: string;
  if (condition.state !== "ready") {
    daemon = `${condition.state}${"cause" in condition ? ` (${condition.cause})` : ""}: states kept or unknown, no CRAP`;
  } else {
    const rec = c.name.startsWith("E")
      ? { v: 1 as const, sources: [source(PATH, [f], { ran: [] })], unread: [] }
      : ranRecord(f);
    const cov = coverageOf({ path: PATH, blob: BLOB as never }, [f], condition.loaders, () => rec);
    if (cov === "unread") daemon = "unknown (unread)";
    else {
      const { states } = judgeFiles(
        { worktreeId: "w", revision: 1, threshold: 30, at: 0, prior: new Map(), edits: new Map() },
        [{ file: { path: PATH, blob: BLOB } as never, count: { functions: [f] } as never, coverage: cov }],
      );
      daemon = states.map((s) => `${s.measure} ${s.outcome}${s.value === null ? "" : ` ${s.value}`}`).join(", ");
    }
  }
  // Gate side.
  const report = evaluate(
    changedSet([{ path: PATH, functions: [f], changed: ["work"] }]),
    evidence(c.files(f)),
    POLICY,
    VERSIONS,
    TIMES,
  );
  const g = report.functions[0];
  const gate = `${g?.state}${g?.gap ? ` (${g.gap})` : ""}${g?.crap === null ? "" : `, CRAP ${g?.crap}`}; verdict ${report.verdict}`;
  rows.push({ case: c.name, daemon, gate });
}
console.log(JSON.stringify(rows, null, 2));
