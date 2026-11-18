import type { BeforeRemove, KeyedFile } from "../core/commit/at-keys-checkout.js";
import { sideKeys } from "../core/commit/at-keys-side.js";
import type { CheckoutOptions, KeyingOptions } from "../core/commit/at-keys-walk.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { type Conditions, hiddenInRepository } from "../core/proof/conditions.js";
import { type Entry, missingImport, type Side } from "../core/proof/sides.js";
import type { SideEnd } from "../core/proof/verdict.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { endOfRecords, forcedReason, runFiles } from "./proof-run.js";
import { needsOf } from "./status-at-run-select.js";

/*
 * Spec 023 D5.1, D5.2 (row 023-08): one side of a proof for its files, in
 * one temporary checkout at the side's code version with the side's test
 * version copied in (`sideKeys`). Each file is keyed there by the gate's
 * keyer; a stored result at its key is read, not run (D5.1). A file whose
 * test imports a source file the code version lacks is refused (D5.2), as
 * is one whose closure needs a path git does not hold (D4.9). The rest run
 * in that checkout through 023-07's child (`runInChild`) and are read back
 * as 023-07 reads them (`outcomesOf`, in `proof-run.ts`). A run is
 * stored only when the checkout equals the side's expected tree after the
 * install; its outcome counts either way. Row 023-11 (D5.3, D5.4): a side
 * under a condition, or repeated, is never read from the store and never
 * stored; a repository path `--without` names is removed from its checkout.
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
  /** Row 023-11 (D5.4): how many times this command ran it on this side. */
  readonly runs: number;
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
  /** Row 023-11 (D5.3): the side's conditions; with any, it always runs and stores nothing. */
  readonly conditions: Conditions;
  /** Row 023-11 (D5.4): each file runs up to this many times, to its first run that does not pass. */
  readonly repeat: number;
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
  // D5.1, D5.3, D5.4: a side under a condition, or repeated, is never read from the store.
  const forced = forcedReason(input);
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
      else if (change === null && forced === null && file.at.stored.length > 0)
        files.set(id, {
          end: endOfRecords(file.at.stored),
          from: "store",
          stored: true,
          notStored: null,
          runs: 0,
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
    hidden: hiddenInRepository(input.conditions),
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

function unknown(reason: string): SideFile {
  return { end: { end: "unknown", reason }, from: null, stored: false, notStored: null, runs: 0 };
}
