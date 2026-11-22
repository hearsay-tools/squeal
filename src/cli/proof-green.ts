import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { commonDirOf, type KeyedFile, withStores } from "../core/commit/at-keys-checkout.js";
import { changedText } from "../core/commit/at-keys-walk.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { NOT_RUN_BUDGET } from "../core/proof/verdict.js";
import type { CommitSetup } from "../core/types/commit-ask.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonKeyed } from "./proof-green-rows.js";
import { askGreen, type GreenAsk, type RunInput, readGreen } from "./proof-green-run.js";
import { endOfRecords } from "./proof-run.js";
import type { OpenSide, SideAnswer, SideFile } from "./proof-side.js";
import type { AtDaemons, CommitDaemonInput } from "./status-at-daemons.js";
import { keptAlive } from "./status-at-now-ask.js";
import { needsOf } from "./status-at-run-select.js";

/*
 * Spec 023 D7.6 (row 023-42): a proof's green side with no condition and
 * no repeat, on the commit daemon at HEAD, the same commit worktree
 * `status --at` uses (D7.1). The call makes the worktree (no install) and
 * starts its daemon when none serves it, waits for its setup (the daemon
 * installs and keys), then reads each named file's row there: its live
 * key, the result stored at it, its stored closure. A stored result is
 * read, not run (D5.1). A file with none is asked of the daemon by its
 * own path once D5.2 admits it, before the red side runs, and read
 * only when the red side decides (`proof-green-run.ts`). Every step ends
 * by the proof's one deadline; what is not done then reads `not run
 * (budget)` with the rerun line, and goes on in the daemon. The daemon's
 * whole-checkout check (setup `changed`) and D4.9 (`needs <path>`) read
 * not comparable (D5.5). The green side is the committed HEAD: nothing is
 * read from the working tree, whose uncommitted paths the report names.
 */

/** How often the call reads the commit daemon's setup until it is done. */
const SETUP_EVERY_MS = 250;

export interface GreenInput {
  readonly root: AbsolutePath;
  /** The committed HEAD the side is at. */
  readonly head: string;
  /** The named files, as named (the default project). */
  readonly files: readonly TestFileRef[];
  readonly named: ReadonlySet<RelativePath>;
  readonly daemons: AtDaemons;
  /**
   * The commit worktree's input (fingerprint, ceiling, cache root, notes), less its deadline;
   * `null` when the budget ended before it was read.
   */
  readonly commit: CommitDaemonInput | null;
  /** `performance.now()` when the proof's budget ends. */
  readonly deadline: number;
}

/** The commit daemon's tree once its setup is done, or why the side reads none. */
type Ready = { readonly tree: AbsolutePath } | { readonly side: SideFile };

/**
 * D7.6: the green side on the commit daemon at HEAD, `body` called with
 * its keyed files while the side is open (as `withSide` does), then each
 * named file's side.
 */
export async function withGreenDaemon<T>(
  input: GreenInput,
  body: (open: OpenSide) => Promise<T>,
): Promise<SideAnswer & { readonly value: T | undefined }> {
  const started = performance.now();
  const by = Date.now() + Math.max(0, input.deadline - performance.now());
  const at = input.head.slice(0, 9);
  const files = new Map<string, SideFile>();
  const ready = await readyTree(input, by);
  const answer = (refs: readonly TestFileRef[], ran: number, value: T | undefined) => {
    for (const ref of refs)
      if (!files.has(testFileId(ref))) files.set(testFileId(ref), unknown("not run (not needed)"));
    const checkoutMs = Math.round(performance.now() - started);
    return { files, refs, ran, changed: null, checkoutMs, value };
  };
  if ("side" in ready) {
    for (const ref of input.files) files.set(testFileId(ref), ready.side);
    return answer(input.files, 0, undefined);
  }
  const { tree } = ready;
  const commonDir = commonDirOf(input.root);
  const keyed = await withStores(commonDir, async (main) => daemonKeyed(main, tree, input.named));
  const needs = await greenNeeds(input, tree, by);
  if (typeof needs !== "function") {
    for (const ref of input.files) files.set(testFileId(ref), needs);
    return answer(input.files, 0, undefined);
  }
  const pending = new Map<string, KeyedFile>();
  for (const file of keyed) {
    if (!("key" in file.at)) continue;
    const needed = needs(file);
    if (needed !== null) files.set(testFileId(file.ref), unknown(`needs ${needed}`));
    else if (file.at.stored.length > 0) files.set(testFileId(file.ref), stored(file));
    else pending.set(testFileId(file.ref), file);
  }
  let ran = 0;
  const run: RunInput = { daemons: input.daemons, root: input.root, tree, commonDir, by, at };
  // Asked once D5.2 admits the files (the stop, the case), before the red side runs
  // (`proof-green-run.ts`); read only when it decides. A stopped proof asks nothing (review
  // 0.1.597 B2).
  const owner = randomUUID();
  let asked: GreenAsk | null = null;
  const open: OpenSide = {
    keyed,
    admit: async (refs) => {
      const toAsk = refs
        .map((ref) => pending.get(testFileId(ref)))
        .filter((f): f is KeyedFile => f !== undefined);
      if (toAsk.length > 0 && asked === null) asked = await askGreen(run, toAsk, owner);
    },
    run: async (refs) => {
      const toRun = refs
        .map((ref) => pending.get(testFileId(ref)))
        .filter((f): f is KeyedFile => f !== undefined && !files.has(testFileId(f.ref)));
      if (toRun.length === 0 || asked === null) return;
      const sides = await readGreen(run, asked, toRun, owner);
      for (const [id, side] of sides) files.set(id, side);
      ran += [...sides.values()].filter((side) => side.from === "run").length;
    },
  };
  const value = await body(open);
  const refs = [...keyed.map((f) => f.ref), ...unlisted(input.files, keyed)];
  for (const ref of refs) {
    const file = keyed.find((f) => testFileId(f.ref) === testFileId(ref));
    if (file === undefined) files.set(testFileId(ref), unknown(`no runner lists it at ${at}`));
    else if ("notDetermined" in file.at)
      files.set(testFileId(ref), unknown(file.at.notDetermined.detail));
  }
  return answer(refs, ran, value);
}

/**
 * The commit worktree at HEAD with its daemon serving it (made, no
 * install, and started when none serves it), read until its setup is
 * done, failed or changed, or `by`.
 */
async function readyTree(input: GreenInput, by: number): Promise<Ready> {
  const { daemons } = input;
  const at = input.head.slice(0, 9);
  if (input.commit === null || Date.now() >= by) return { side: unknown(NOT_RUN_BUDGET) };
  const tree = await keptAlive(daemons.commit({ ...input.commit, deadline: by }));
  if (typeof tree !== "string") {
    const late = Date.now() >= by;
    return { side: late ? unknown(NOT_RUN_BUDGET) : unknown(tree.problem) };
  }
  let setup: CommitSetup | null = null;
  for (;;) {
    const read = await keptAlive(daemons.commitRead(tree, [], by)).catch(String);
    if (typeof read === "string") return { side: unknown(`its commit daemon at ${at}: ${read}`) };
    setup = read.setup;
    if (setup.phase === "ready") return { tree };
    if (setup.phase === "failed")
      return { side: unknown(`the commit daemon's setup at ${at} failed: ${setup.text}`) };
    if (setup.phase === "changed") return { side: unknown(changedText(setup)) };
    if (Date.now() >= by) return { side: unknown(NOT_RUN_BUDGET) };
    await keptAlive(sleep(Math.min(SETUP_EVERY_MS, Math.max(0, by - Date.now()))));
  }
}

/**
 * D4.9 over the daemon's stored closure, which holds the reads Squeal
 * observed too. A listed folder (`test/fixtures/`, or `./`) is no blob, so
 * it reads `needs <folder>`: its key hashes the tracked names only, so a
 * result stored from a listing with ignored or untracked names would
 * stand for the commit's (review 0.1.597 B1). Its git reads end by `by`
 * (B3); one that does not reads `not run (budget)` for every file.
 */
async function greenNeeds(
  input: GreenInput,
  tree: AbsolutePath,
  by: number,
): Promise<((file: KeyedFile) => string | null) | SideFile> {
  const within = () => by - Date.now();
  if (within() <= 0) return unknown(NOT_RUN_BUDGET);
  const copied = input.named;
  return keptAlive(needsOf({ root: input.root, commit: input.head, tree, copied, within })).catch(
    (error: unknown) =>
      within() <= 0
        ? unknown(NOT_RUN_BUDGET)
        : unknown(`the commit's tree at ${input.head.slice(0, 9)}: ${String(error)}`),
  );
}

/** The named files no runner at HEAD lists, each as it was named. */
function unlisted(named: readonly TestFileRef[], keyed: readonly KeyedFile[]): TestFileRef[] {
  return named.filter((ref) => !keyed.some((k) => k.ref.path === ref.path));
}

function stored(file: KeyedFile): SideFile {
  const records = "key" in file.at ? file.at.stored : [];
  return { end: endOfRecords(records), from: "store", stored: true, notStored: null, runs: 0 };
}

export function unknown(reason: string): SideFile {
  return { end: { end: "unknown", reason }, from: null, stored: false, notStored: null, runs: 0 };
}
