import { FILE_ERROR } from "../core/code/gate/evidence.js";
import type { FailedTest } from "../core/code/gate/types.js";
import type { BeforeRemove, KeyedFile } from "../core/commit/at-keys-checkout.js";
import { sideKeys } from "../core/commit/at-keys-side.js";
import type { CheckoutOptions, KeyingOptions } from "../core/commit/at-keys-walk.js";
import { compare } from "../core/fs/compare.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { type Entry, missingImport, type Side } from "../core/proof/sides.js";
import type { SideEnd } from "../core/proof/verdict.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { ResultRecord } from "../core/types/store-records.js";
import type { GateFileRun } from "./code-gate-files.js";
import type { SideState } from "./status-at-report.js";
import { type RunAnswer, runInChild } from "./status-at-run-child.js";
import { outcomesOf } from "./status-at-run-outcome.js";
import { needsOf } from "./status-at-run-select.js";

/*
 * Spec 023 D5.1, D5.2 (row 023-08): one side of a proof for its files, in
 * one temporary checkout at the side's code version with the side's test
 * version copied in (`sideKeys`). Each file is keyed there by the gate's
 * keyer; a stored result at its key is read, not run (D5.1). A file whose
 * test imports a source file the code version lacks is refused (D5.2), as
 * is one whose closure needs a path git does not hold (D4.9). The rest run
 * in that checkout through 023-07's child (`runInChild`) and are read back
 * as 023-07 reads them (`outcomesOf`). A run is stored only when the
 * checkout equals the side's expected tree after the install; its outcome
 * counts either way.
 */

/** Where one file's side came from. */
export type SideFrom = "store" | "daemon" | "run" | null;

/** One file's side. */
export interface SideFile {
  readonly end: SideEnd;
  readonly from: SideFrom;
  /** A run's result is in the shared store at its key. */
  readonly stored: boolean;
  /** Why a run's result was not stored; `null` when it was, or nothing ran. */
  readonly notStored: string | null;
}

export interface SideAnswer {
  /** Each file's side, by `testFileId`. */
  readonly files: ReadonlyMap<string, SideFile>;
  /** How many files ran. */
  readonly ran: number;
  /** The first path the install changed in the checkout; `null` when none. */
  readonly changed: RelativePath | null;
}

export interface SideInput {
  readonly root: AbsolutePath;
  readonly own: WorktreeId;
  readonly side: Side;
  readonly files: readonly TestFileRef[];
  /** D5.2: the test-side files copied in beside the named ones. */
  readonly also: readonly RelativePath[];
  /** Each version's entries, and the named paths (`isTestSide`). */
  readonly tests: ReadonlyMap<RelativePath, Entry>;
  readonly code: ReadonlyMap<RelativePath, Entry>;
  readonly named: ReadonlySet<RelativePath>;
  readonly keying: KeyingOptions & CheckoutOptions;
  /** `CliIo.relaunch`, for the run's child. */
  readonly relaunch: readonly string[] | undefined;
  /** The command's environment as it started: the run's. */
  readonly env: NodeJS.ProcessEnv;
  /** `performance.now()` when the command's budget ends. */
  readonly deadline: number;
  readonly forward: (text: string) => void;
}

/** The install's own ceiling (row 023-16), when the budget left is longer. */
const INSTALL_TIMEOUT_MS = 300_000;

/** D5.1, D5.2: `input.files` on one side, read from the store or run. */
export async function runSide(input: SideInput): Promise<SideAnswer> {
  const { side } = input;
  const files = new Map<string, SideFile>();
  let ran = 0;
  let changed: RelativePath | null = null;
  const beforeRemove: BeforeRemove = async (checkout, keyed, change) => {
    changed = change;
    const needs = await needsOf({
      root: input.root,
      commit: side.code,
      tree: checkout.tree,
      copied: new Set([...input.named, ...input.also]),
    });
    const toRun: KeyedFile[] = [];
    for (const file of keyed) {
      const id = testFileId(file.ref);
      if (!("key" in file.at)) continue;
      const loads = file.at.loads ?? [];
      const missing = missingImport(loads, input.tests, input.code, input.named);
      const needed = missing === null ? needs(file) : null;
      if (missing !== null)
        files.set(id, unknown(`imports ${missing}, absent at ${side.code.slice(0, 9)}`));
      else if (needed !== null) files.set(id, unknown(`needs ${needed}`));
      else if (change === null && file.at.stored.length > 0)
        files.set(id, {
          end: endOfRecords(file.at.stored),
          from: "store",
          stored: true,
          notStored: null,
        });
      else toRun.push(file);
    }
    if (toRun.length === 0) return;
    const left = Math.floor((input.deadline - performance.now()) / 1000);
    if (left < 1) {
      for (const file of toRun) files.set(testFileId(file.ref), unknown("not run (budget)"));
      return;
    }
    const answer = await runInChild({
      relaunch: input.relaunch,
      checkout,
      files: [...new Set(toRun.map((f) => f.ref.path))].sort(),
      budgetSeconds: left,
      // "Whole-checkout check": a checkout that is not the side's expected tree stores nothing.
      store: change === null,
      env: input.env,
      forward: input.forward,
    });
    const states = await outcomesOf({
      commonDir: checkout.commonDir,
      commit: side.code,
      own: input.own,
      run: toRun,
      siblings: [],
      answer,
      changed: change,
    });
    for (const file of toRun) {
      const state = states.get(testFileId(file.ref));
      const side = ranSide(state, answer, file.ref.path, change);
      if (side.from === "run") ran++;
      files.set(testFileId(file.ref), side);
    }
  };
  const left = Math.max(1, input.deadline - performance.now());
  const keys = await sideKeys({
    ...input.keying,
    root: input.root,
    code: side.code,
    tests: side.tests,
    files: input.files,
    also: input.also,
    beforeRemove,
    installTimeoutMs: Math.min(INSTALL_TIMEOUT_MS, left),
  });
  // Not keyed: absent at the test version, not listed there, or no checkout.
  for (const ref of input.files) {
    const id = testFileId(ref);
    const at = keys.get(id);
    if (files.has(id)) continue;
    files.set(
      id,
      unknown(at !== undefined && "notDetermined" in at ? at.notDetermined.detail : "not keyed"),
    );
  }
  return { files, ran, changed };
}

function unknown(reason: string): SideFile {
  return { end: { end: "unknown", reason }, from: null, stored: false, notStored: null };
}

/** A file's side from the results stored at its key: fail when one failed, with their errors. */
export function endOfRecords(records: readonly ResultRecord[]): SideEnd {
  const failed = records.filter((r) => r.outcome === "fail");
  if (failed.length === 0) return { end: "pass" };
  const byTest = new Map<string, FailedTest>();
  for (const r of failed) {
    const test = r.check.kind === "test" ? r.check.fullName : FILE_ERROR;
    const errors = [...(byTest.get(test)?.errors ?? []), ...r.errors];
    byTest.set(test, { test, errors });
  }
  return { end: "fail", failures: [...byTest.values()].sort((a, b) => compare(a.test, b.test)) };
}

/** A run file's side from 023-07's state and the gate's own failure records for its path. */
function ranSide(
  state: SideState | undefined,
  answer: RunAnswer,
  path: RelativePath,
  changed: RelativePath | null,
): SideFile {
  const runs: readonly GateFileRun[] =
    "result" in answer ? answer.result.runs.filter((r) => r.path === path) : [];
  const failures = runs.find((r) => r.outcome === "failed")?.failed ?? [];
  const notStored = changed === null ? null : `install changed the checkout: ${changed}`;
  const ranAs = (outcome: "pass" | "fail", stored: boolean): SideFile => ({
    end: outcome === "pass" ? { end: "pass" } : { end: "fail", failures },
    from: "run",
    stored,
    notStored: stored ? null : (notStored ?? "the gate keeps a result only with coverage on"),
  });
  if (state === undefined) return unknown("the run gave it no outcome");
  if (state.state === "pass" || state.state === "fail")
    return ranAs(state.state, "origin" in state && state.origin.stored === true);
  if (state.state === "not comparable" && state.ran !== undefined) return ranAs(state.ran, false);
  if (state.state === "not run") {
    if (state.reason === "prepare") return { ...unknown(""), end: { end: "prepare" }, from: "run" };
    if (runs.some((r) => r.outcome === "not-finished"))
      return { ...unknown(""), end: { end: "timeout" }, from: "run" };
    return unknown("not run (budget)");
  }
  if (state.state === "not determined" || state.state === "not comparable")
    return unknown(state.reason);
  return unknown(state.state);
}
