import { describe, expect, it } from "vitest";
import { formatCodeReport } from "../../../src/cli/code.js";
import { crapFor, pendingCrapReason, pendingWords } from "../../../src/cli/code-crap-reason.js";
import { readCodeReport } from "../../../src/cli/code-report.js";
import {
  clearCoverage,
  coverageChecks,
  type FileSummary,
  readSummary,
} from "../../../src/core/code/crap/index.js";
import type { CodeKnownState } from "../../../src/core/types/code.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-104 (gh-155, D9): while coverage and CRAP are on, a function
 * `squeal code <path>` lists with a complexity reads CRAP pending with
 * the condition it waits for, never nothing: a new function beside a
 * queued loader (research Q4 a), a file the coverage step judged at
 * older bytes (Q4 b), a file unknown by its cause, and a function
 * seeded pending. An excluded file, CRAP off and coverage off show
 * nothing new. Output only: no judgement, state or key changes.
 */

const POLICY = { threshold: 20, maxFileBytes: 524_288 };
const ONE = "double 2 d1\n";
const TWO = "double 2 d1\ntriple 2 t1\n";
const RUN = "waits for a test file to run; squeal run --all runs it";
const NOT_JUDGED = "the coverage step has not judged this file's current bytes yet";
const UNKEYED = "Squeal cannot key a test file that loads this file";

const blobOf = (rig: CoverageRig) => rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
const report = (rig: CoverageRig) =>
  readCodeReport(rig.main, rig.store, WT, POLICY, {
    paths: ["src/a.ts"],
    changed: false,
    shell: null,
  });
const coverageOf = (rig: CoverageRig, name: string) =>
  report(rig).functions.find((f) => f.qualifiedName === name)?.coverage;
const lineOf = (rig: CoverageRig, name: string) =>
  formatCodeReport(report(rig))
    .split("\n")
    .find((l) => l.includes(`  ${name}  `));
const checks = (over: { crap?: boolean; exclude?: string[] }) =>
  coverageChecks({
    crap: { ...DEFAULT_POLICY.crap, enabled: over.crap ?? true },
    coverage: { ...DEFAULT_POLICY.coverage, exclude: over.exclude ?? [] },
  });

/** `double` judged from `test/a.test.ts`, then an edit adds `triple`, with no step after it. */
async function added(): Promise<CoverageRig> {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": ONE });
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blobOf(rig), 1, [1])],
  });
  rig.step();
  expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({ state: "judged" });
  await rig.edit({ "src/a.ts": TWO });
  return rig;
}

/** As `added`, with `test/a.test.ts` run again at the new bytes. */
async function rerun(): Promise<CoverageRig> {
  const rig = await added();
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    key: "key-2",
    record: [sourceOf("src/a.ts", blobOf(rig), 2, [1, 2])],
  });
  return rig;
}

describe("a function the coverage step has not judged (row 015-104)", () => {
  it("waits for a queued loader, with the command status names, in text and JSON (Q4 a)", async () => {
    const rig = await rerun();
    rig.loader("test/a.e2e.test.ts", { closure: ["src/a.ts"], pending: "queued" });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({
      state: "pending",
      reason: "run",
      waiting: 1,
    });
    expect(coverageOf(rig, "triple")).toEqual({
      crap: { outcome: "pending", value: null, reason: RUN },
    });
    expect(lineOf(rig, "triple")).toBe(
      `  src/a.ts:2  triple  CC 2 (if 1), at or under; CRAP pending: ${RUN}`,
    );
    // `double` keeps its last judged CRAP, with no reason (D9: a pending source keeps them).
    expect(coverageOf(rig, "double")?.crap).toEqual({ outcome: "pass", value: 2 });
    expect(rig.states("crap")).toEqual(["double pass 2"]);
  });

  it("names a judgement at older bytes before the next step (Q4 b)", async () => {
    const rig = await added();
    expect(coverageOf(rig, "triple")).toEqual({
      crap: { outcome: "pending", value: null, reason: NOT_JUDGED },
    });
    expect(lineOf(rig, "triple")).toBe(
      `  src/a.ts:2  triple  CC 2 (if 1), at or under; CRAP pending: ${NOT_JUDGED}`,
    );
    // The step judges it; the pending CRAP goes.
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      key: "key-2",
      record: [sourceOf("src/a.ts", blobOf(rig), 2, [1, 2])],
    });
    rig.step();
    expect(coverageOf(rig, "triple")?.crap).toEqual({ outcome: "pass", value: 2 });
    expect(formatCodeReport(report(rig))).not.toContain("CRAP pending");
  });

  it("gives an unknown file's cause", async () => {
    const rig = await rerun();
    rig.loader("test/b.test.ts", { closure: ["src/a.ts"], key: null });
    rig.step();
    expect(readSummary(rig.store.meta, WT)?.files["src/a.ts"]).toMatchObject({
      state: "unknown",
      cause: "unkeyed",
    });
    expect(coverageOf(rig, "triple")?.crap).toEqual({
      outcome: "pending",
      value: null,
      reason: UNKEYED,
    });
    expect(lineOf(rig, "triple")).toMatch(new RegExp(`; CRAP pending: ${UNKEYED}$`));
  });

  it("gives functions seeded pending beside queued loaders their wait and its count", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": TWO });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blobOf(rig), 2, [1, 2])],
    });
    rig.loader("test/a.e2e.test.ts", { closure: ["src/a.ts"], pending: "queued" });
    rig.loader("test/b.e2e.test.ts", { closure: ["src/a.ts"], pending: "queued" });
    rig.step();
    expect(rig.states("crap")).toEqual(["double pending -", "triple pending -"]);
    const two = "waits for a test file to run (2 test files wait); squeal run --all runs them";
    expect(coverageOf(rig, "double")?.crap).toEqual({
      outcome: "pending",
      value: null,
      reason: two,
    });
    expect(lineOf(rig, "double")).toBe(
      `  src/a.ts:1  double  CC 2 (if 1), at or under; CRAP pending: ${two}`,
    );
  });
  it("reads not measured beside its siblings in a file only a runner without records loads", async () => {
    const rig = coverageRig();
    rig.configure(["pytest"]);
    rig.closures.setEnvironment({ runner: "pytest", files: [] });
    await rig.edit({ "scripts/helper.ts": "classify 4 h1\n", "scripts/helper.test.ts": "it\n" });
    rig.loader("scripts/helper.test.ts", { closure: ["scripts/helper.ts"] });
    rig.step();
    await rig.edit({ "scripts/helper.ts": "classify 4 h1\nsort 3 s1\n" });
    const read = readCodeReport(rig.main, rig.store, WT, POLICY, {
      paths: ["scripts/helper.ts"],
      changed: false,
      shell: null,
    });
    expect(read.functions.map((f) => [f.qualifiedName, f.coverage])).toEqual([
      ["classify", { notMeasured: ["pytest"] }],
      ["sort", { notMeasured: ["pytest"] }],
    ]);
  });
});

describe("nothing new where CRAP is not checked (row 015-104)", () => {
  it("leaves an excluded file's functions as excluded", async () => {
    const rig = await rerun();
    rig.step({ checks: checks({ exclude: ["src/a.ts"] }) });
    expect(coverageOf(rig, "triple")).toEqual({ excluded: true });
    expect(lineOf(rig, "triple")).toBe(
      "  src/a.ts:2  triple  CC 2 (if 1), at or under; coverage not checked (coverage.exclude)",
    );
  });

  it("gives no CRAP with crap.enabled off", async () => {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": ONE });
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts"],
      record: [sourceOf("src/a.ts", blobOf(rig), 1, [1])],
    });
    rig.step({ checks: checks({ crap: false }) });
    await rig.edit({ "src/a.ts": TWO });
    expect(coverageOf(rig, "double")?.crap).toBeUndefined();
    expect(coverageOf(rig, "triple")).toBeUndefined();
    expect(formatCodeReport(report(rig))).not.toContain("CRAP");
  });

  it("gives no coverage with coverage off", async () => {
    const rig = await added();
    clearCoverage(rig.store, WT);
    expect(report(rig).functions.map((f) => f.coverage)).toEqual([undefined, undefined]);
    expect(formatCodeReport(report(rig))).not.toContain("CRAP");
  });
});

describe("the words of a pending CRAP (row 015-104)", () => {
  type Pending = Extract<FileSummary, { state: "pending" }>;
  const pending = (reason: Pending["reason"], waiting: number): Pending => ({
    state: "pending",
    blob: "b1",
    reason,
    waiting,
  });
  const judged: FileSummary = { state: "judged", blob: "b1", signature: "s" };
  const counted = (outcome: CodeKnownState["outcome"]) => ({ outcome }) as CodeKnownState;

  it("counts the test files a pending file waits for, and names the run command for runs", () => {
    expect(
      [
        pending("imports", 1),
        pending("imports", 2),
        pending("run", 0),
        pending("run", 3),
        pending("record", 1),
        pending("record", 2),
      ].map(pendingWords),
    ).toEqual([
      "waits for a test file's imports",
      "waits for a test file's imports (2 test files wait)",
      RUN,
      "waits for a test file to run (3 test files wait); squeal run --all runs them",
      "waits for a coverage record",
      "waits for a coverage record (2 test files wait)",
    ]);
  });

  it("names the current bytes not judged, and no cause in a file judged at them", () => {
    expect(pendingCrapReason(undefined, "b1")).toBe(NOT_JUDGED);
    expect(pendingCrapReason(judged, "b2")).toBe(NOT_JUDGED);
    expect(pendingCrapReason(judged, undefined)).toBe(NOT_JUDGED);
    expect(pendingCrapReason(judged, "b1")).toBe("cause unknown");
  });

  it("gives no CRAP with CRAP off or no complexity, and a parse error's reason to a pending one", () => {
    expect(crapFor({ complexity: counted("pass") }, judged, "b2", false)).toBeNull();
    expect(crapFor({ complexity: counted("unknown") }, judged, "b2", true)).toBeNull();
    expect(crapFor({}, judged, "b2", true)).toBeNull();
    expect(crapFor({ complexity: counted("fail") }, judged, "b2", true)).toEqual({
      outcome: "pending",
      value: null,
      reason: NOT_JUDGED,
    });
    const seeded = { outcome: "pending", value: null } as CodeKnownState;
    expect(crapFor({ crap: seeded, complexity: counted("unknown") }, judged, "b1", true)).toEqual({
      outcome: "pending",
      value: null,
      reason: "it is in a parse error, so its complexity is not judged",
    });
    // A judged CRAP keeps its value, with no reason.
    const pass = { outcome: "pass", value: 4 } as CodeKnownState;
    expect(crapFor({ crap: pass, complexity: counted("pass") }, judged, "b1", true)).toEqual({
      outcome: "pass",
      value: 4,
    });
  });
});
