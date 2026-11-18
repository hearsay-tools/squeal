import type { Checkout } from "../core/checkout/checkout.js";
import { FILE_ERROR } from "../core/code/gate/evidence.js";
import type { FailedTest } from "../core/code/gate/types.js";
import {
  type BeforeRemove,
  type KeyedFile,
  resultsAt,
  withStores,
} from "../core/commit/at-keys-checkout.js";
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
export type SideFrom = "store" | "run" | null;

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
  /** The side's files: the named ones, or with `listed` as the checkout's runners list them. */
  readonly refs: readonly TestFileRef[];
  /** The checkout's whole time: make, install, key, what ran in it, remove. */
  readonly checkoutMs: number;
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
  /** The named files' projects are those the checkout's runners list (`sideKeys`' `listed`). */
  readonly listed?: boolean;
}

/** The install's own ceiling (row 023-16), when the budget left is longer. */
const INSTALL_TIMEOUT_MS = 300_000;

/** A side's checkout while it is open: its keyed files, and runs on request. */
export interface OpenSide {
  /** The files keyed in the checkout. */
  readonly keyed: readonly KeyedFile[];
  /** Runs those of `refs` that need a run, in this checkout, within the budget left. */
  run(refs: readonly TestFileRef[]): Promise<void>;
}

/**
 * D5.1, D5.2: the side's checkout, with `body` called while it is open
 * (after keying, before removal), then each file's side. Without `body`,
 * every file that needs a run runs (`runSide`). A file `body` leaves
 * undecided reads `not read`.
 */
export async function withSide<T>(
  input: SideInput,
  body: (open: OpenSide) => Promise<T>,
): Promise<SideAnswer & { readonly value: T | undefined }> {
  const { side } = input;
  const files = new Map<string, SideFile>();
  let ran = 0;
  let changed: RelativePath | null = null;
  let value: T | undefined;
  let keyedRefs: TestFileRef[] = [];
  const started = performance.now();
  const beforeRemove: BeforeRemove = async (checkout, keyed, change) => {
    changed = change;
    keyedRefs = keyed.map((f) => f.ref);
    const needs = await needsOf({
      root: input.root,
      commit: side.code,
      tree: checkout.tree,
      copied: new Set([...input.named, ...input.also]),
    });
    const pending = new Map<string, KeyedFile>();
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
      else pending.set(id, file);
    }
    const run = async (refs: readonly TestFileRef[]) => {
      const toRun = refs
        .map((ref) => pending.get(testFileId(ref)))
        .filter((f): f is KeyedFile => f !== undefined && !files.has(testFileId(f.ref)));
      if (toRun.length === 0) return;
      ran += await runFiles(input, checkout, toRun, change, files);
    };
    const open: OpenSide = {
      keyed,
      run,
    };
    value = await body(open);
  };
  const left = Math.max(1, input.deadline - performance.now());
  const listed = input.listed === true;
  const keys = await sideKeys({
    ...input.keying,
    root: input.root,
    code: side.code,
    tests: side.tests,
    files: input.files,
    also: input.also,
    listed,
    beforeRemove,
    installTimeoutMs: Math.min(INSTALL_TIMEOUT_MS, left),
  });
  // Listed by the checkout: the keyed files, and a named path no runner there lists.
  const refs = listed ? [...keyedRefs, ...unlistedOf(input.files, keyedRefs)] : input.files;
  for (const ref of refs) {
    const id = testFileId(ref);
    if (files.has(id)) continue;
    const at = keys.get(id);
    const why =
      at !== undefined && "notDetermined" in at
        ? at.notDetermined.detail
        : keyedRefs.some((r) => testFileId(r) === id)
          ? "not read"
          : `no runner lists it at ${side.code.slice(0, 9)}`;
    files.set(id, unknown(why));
  }
  const checkoutMs = Math.round(performance.now() - started);
  return { files, refs, ran, changed, checkoutMs, value };
}

/** D5.1, D5.2: `input.files` on one side, read from the store or run. */
export async function runSide(input: SideInput): Promise<SideAnswer> {
  return withSide(input, (open) => open.run(open.keyed.map((f) => f.ref)));
}

/** The named files whose path no runner in the checkout listed, each as it was named. */
function unlistedOf(named: readonly TestFileRef[], keyed: readonly TestFileRef[]): TestFileRef[] {
  return named.filter((ref) => !keyed.some((k) => k.path === ref.path));
}

/** Runs `toRun` in the open checkout through 023-07's child; each file's side into `files`; how many ran. */
async function runFiles(
  input: SideInput,
  checkout: Checkout,
  toRun: readonly KeyedFile[],
  change: RelativePath | null,
  files: Map<string, SideFile>,
): Promise<number> {
  const left = Math.floor((input.deadline - performance.now()) / 1000);
  if (left < 1) {
    for (const file of toRun) files.set(testFileId(file.ref), unknown("not run (budget)"));
    return 0;
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
    commit: input.side.code,
    own: input.own,
    run: toRun,
    siblings: [],
    answer,
    changed: change,
  });
  let ran = 0;
  // Review wave-8 B1: a stored run's failures are its own project's, read at its own key.
  await withStores(checkout.commonDir, async (main) => {
    for (const file of toRun) {
      const state = states.get(testFileId(file.ref));
      const records =
        main !== null && "key" in file.at ? resultsAt(main, file.ref, file.at.key) : [];
      const side = ranSide(state, answer, file.ref.path, change, records);
      if (side.from === "run") ran++;
      files.set(testFileId(file.ref), side);
    }
  });
  return ran;
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

/**
 * A run file's side from 023-07's state. A stored outcome takes its
 * failures from `records`, the results at the file's own key for its own
 * project. An outcome the store does not hold takes them from the gate's
 * answer, which is by path: a path two projects ran takes them only when
 * every project's failure evidence is the same, test by test and error by
 * error, as the report shows it (review wave-8 B1, and its re-review: equal
 * kinds are not equal evidence). Otherwise the file reads unknown, and
 * still counts as run.
 */
function ranSide(
  state: SideState | undefined,
  answer: RunAnswer,
  path: RelativePath,
  changed: RelativePath | null,
  records: readonly ResultRecord[],
): SideFile {
  const runs: readonly GateFileRun[] =
    "result" in answer ? answer.result.runs.filter((r) => r.path === path) : [];
  const notStored = changed === null ? null : `install changed the checkout: ${changed}`;
  if (state === undefined) return unknown("the run gave it no outcome");
  if ((state.state === "pass" || state.state === "fail") && state.origin.stored === true) {
    if (records.length === 0) return unknown("its stored result could not be read back");
    return { end: endOfRecords(records), from: "run", stored: true, notStored: null };
  }
  const ranAs = (outcome: "pass" | "fail"): SideFile => {
    if (outcome === "pass") return { ...unstored(notStored), end: { end: "pass" } };
    const failures = sharedFailures(runs);
    if (failures === null)
      return {
        ...unstored(notStored),
        end: {
          end: "unknown",
          reason: `its ${runs.length} projects failed with different failures, and no stored result tells which is this project's`,
        },
      };
    return { ...unstored(notStored), end: { end: "fail", failures } };
  };
  if (state.state === "pass" || state.state === "fail") return ranAs(state.state);
  if (state.state === "not comparable" && state.ran !== undefined) return ranAs(state.ran);
  if (state.state === "not run") {
    // 023-07's `fromGate` gives `not run` only when every project's run of the path agrees.
    if (state.reason === "prepare") return { ...unknown(""), end: { end: "prepare" }, from: "run" };
    if (runs.length > 0 && runs.every((r) => r.outcome === "not-finished"))
      return { ...unknown(""), end: { end: "timeout" }, from: "run" };
    return unknown("not run (budget)");
  }
  if (state.state === "not determined" || state.state === "not comparable")
    return unknown(state.reason);
  return unknown(state.state);
}

function unstored(notStored: string | null): Omit<SideFile, "end"> {
  return {
    from: "run",
    stored: false,
    notStored: notStored ?? "the gate keeps a result only with coverage on",
  };
}

/**
 * The failures of a path's runs when every run failed with the same
 * evidence: the same tests, each with the same errors (name, message,
 * stack, diff, code, causes, phase), so any one project's failures are
 * this project's word for word; `null` otherwise. A timeout's recorded
 * load is the host's, not the test's, and is left out of the comparison.
 */
function sharedFailures(runs: readonly GateFileRun[]): readonly FailedTest[] | null {
  const [first] = runs;
  if (first === undefined || runs.some((r) => r.outcome !== "failed")) return null;
  const evidence = (r: GateFileRun) =>
    JSON.stringify(
      r.failed.map((f) => [f.test, f.errors.map(({ loadAverage: _load, ...error }) => error)]),
    );
  return runs.every((r) => evidence(r) === evidence(first)) ? first.failed : null;
}
