import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher, type Hasher } from "../../src/core/hash/hasher.js";
import { ancestorListings } from "../../src/core/keys/observed.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import {
  copyInputs,
  copyListed,
  decisionOf,
  type FileDecision,
  keepDecisions,
  mergeHoldOf,
  type RecordFacts,
  type RevisionsSince,
  readRecordEvidence,
  recordOutcome,
  revisionsSince,
  runEnd,
  unstableInputs,
} from "../../src/core/run-evidence/run-evidence.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { isEditorScratch } from "../../src/core/scheduler/editor-scratch.js";
import { newFileState } from "../../src/core/scheduler/files.js";
import { MergeHold } from "../../src/core/scheduler/hold.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { NOTHING_OBSERVED } from "../../src/core/scheduler/observed.js";
import { Withholds } from "../../src/core/scheduler/stability.js";
import type { Tier, TierFile } from "../../src/core/scheduler/tiers.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  WorktreeId,
} from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { Policy } from "../../src/core/types/policy.js";
import type { RunReport } from "../../src/core/types/runner.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { git, scratchStore, writeTree } from "../keys/validity/harness/shared.js";

/*
 * Row 011-319: one finished run over a temporary tree and a scratch store,
 * no runner and no daemon. `test/a.test.ts` is the file each row is about;
 * `test/b.test.ts` runs beside it, so a run has two files.
 */

const WORKTREE = "run-evidence" as WorktreeId;
export const A: TestFileRef = { project: "", path: "test/a.test.ts" };
export const B: TestFileRef = { project: "", path: "test/b.test.ts" };

const FILES: Readonly<Record<string, string>> = {
  "src/a.ts": "export const a = 1;\n",
  "src/b.ts": "export const b = 2;\n",
  "src/d.ts": "export const d = 4;\n",
  ".gitignore": "*.log\n",
  "lib/x.ts": "export const x = 6;\n",
  "data/known.txt": "known\n",
  "setup.ts": "export {};\n",
  "other-setup.ts": "export {};\n",
  [A.path]: 'import { a } from "../src/a.ts";\n',
  [B.path]: 'import { b } from "../src/b.ts";\n',
};

/** The project's environment, which reads `setup.ts`. */
const ENVIRONMENT = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "0.0.0",
  adapterVersion: "0",
  resolvedConfig: "{}",
  files: ["setup.ts"],
};

/** Each file's closure: `a` lists `src/` too, so an editor's scratch file there moves its key. */
const CLOSURES: readonly [TestFileRef, readonly string[]][] = [
  [A, ["src/a.ts", "src/"]],
  [B, ["src/b.ts"]],
];

/** What happened while the run ran, and what the daemon's ledger says of `a` after it. */
export interface During {
  /** Paths `a`'s closure names beyond its imports, as when a daemon recorded them read. */
  readonly keyed?: readonly string[];
  /** Files given other bytes. */
  readonly write?: Readonly<Record<string, string>>;
  /** Files written with the bytes they hold, their stat moved. */
  readonly touch?: readonly string[];
  /** Files created, no watcher batch of them applied before the record. */
  readonly create?: Readonly<Record<string, string>>;
  /** Files created, or removed (`null`), and applied in a revision as the watcher's batch is. */
  readonly batch?: Readonly<Record<string, string | null>>;
  /** As `batch`, after it, in a second revision. */
  readonly next?: Readonly<Record<string, string | null>>;
  /** Untracked files written before the run's keys are read. */
  readonly untracked?: Readonly<Record<string, string>>;
  /** Symbolic links committed with the files, by path, to their targets. */
  readonly links?: Readonly<Record<string, string>>;
  /** What `a`'s run read beyond its key (`RunReport.observed`). */
  readonly read?: readonly string[];
  /** The environment files the run loaded (`RunReport.environmentObserved`). */
  readonly loaded?: readonly string[];
  /** The paths a merge leaves unmerged in the index, during the run. */
  readonly merging?: readonly string[];
  /** `a` was selected under another runtime identity. */
  readonly runtimeMoved?: boolean;
  /** `squeal.config.json` written during the run; the daemon reloads it before its record. */
  readonly policy?: Readonly<Record<string, unknown>>;
  /** How the run ended; by default it completed both files. */
  readonly report?: (report: RunReport) => RunReport;
  /** The daemon's ledger of `a`: a backlog cancel cut it, a newer run, gone, its key moved. */
  readonly ledger?: "cancelled" | "superseded" | "gone" | "rekeyed";
  /** The daemon's record queues `a` again for a fact of its own (`RecordFacts`). */
  readonly queued?: "unfinished" | "interrupted" | "not started" | "install moved";
  /** The barrier withheld `a`'s last run at its key too (`Withholds`, task 007-30). */
  readonly withheldBefore?: boolean;
}

/**
 * Each file's store decision with the daemon's sources and record, and with
 * `squeal code`'s; `null` where `during` names a fact of the daemon's alone.
 */
export interface Decided {
  readonly daemon: ReadonlyMap<string, FileDecision>;
  readonly keeper: ReadonlyMap<string, FileDecision> | null;
}

const OTHER_KEY = "another-key" as CheckKey;

export async function decide(during: During): Promise<Decided> {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-run-evidence-"));
  try {
    const root = writeTree(join(scratch, "repo"), FILES);
    for (const [path, target] of Object.entries(during.links ?? {})) {
      symlinkSync(target, join(root, path));
    }
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "fixture"]);
    writeTree(root, during.untracked ?? {});
    const store = scratchStore(join(root, ".git"));
    try {
      return await decided(root, store, during);
    } finally {
      store.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function decided(root: string, store: Store, during: During): Promise<Decided> {
  const hasher = createFsHasher(root, "sha1");
  const keys = await keyed(root, store, hasher, during.keyed ?? []);
  const files = CLOSURES.map(([ref]) => entryOf(keys, ref, during));
  const paths = files.flatMap((f) => f.inputs);
  const revision = store.revisions.latest(WORKTREE)?.number ?? 0;
  const tier = {
    files,
    lane: "vitest",
    run: keys.beginRun(),
    changes: new Set<RelativePath>(),
    revision: { number: revision },
    snapshot: copyInputs(keys.cache, paths),
    cancel: during.ledger === "cancelled" ? aborted() : null,
  } as unknown as Tier;
  // The keeper's copy of the files below the listings, taken as `Expectations.add` takes it.
  const listed = copyListed(keys, paths);
  const revisions = revisionsSince({ store, worktreeId: WORKTREE });
  const policy = loadPolicy(root).policy;
  await happen(root, keys, hasher, tier, during);
  const report = (during.report ?? ((r) => r))(completed([A, B], during));
  const ran = { root, keys, hasher, tier, report, listed, revisions, policy };
  const ledgerFree = during.ledger === undefined && during.queued === undefined;
  const keeper = ledgerFree ? await keeperColumn(ran) : null;
  const daemon = await daemonColumn(ran, store, during);
  keys.endRun();
  return { daemon, keeper };
}

/** One finished run, as both columns read it. */
interface Ran {
  readonly root: string;
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  readonly tier: Tier;
  readonly report: RunReport;
  readonly listed: ReadonlySet<RelativePath>;
  readonly revisions: RevisionsSince;
  /** The policy the lookup's keys hold. */
  readonly policy: Policy;
}

/** `squeal code`'s decisions: `keepDecisions` over its files as `Expectations.add` gives them. */
function keeperColumn({ root, keys, hasher, tier, report, listed, revisions, policy }: Ran) {
  const runtime = {
    identity: (ref: TestFileRef) => keys.runtimeIdentity(ref),
    rules: policy,
    rulesNow: () => loadPolicy(root).policy,
  };
  // Each file with the runtime identity its tier entry has, as the lookup read it.
  const files = tier.files.map(({ file, key, inputs: paths, runtimePolicy: runtimeIdentity }) => {
    return { ref: file.ref, key, paths, runtimeIdentity };
  });
  const before = tier.snapshot;
  const hold = mergeHoldOf(root);
  const run = tier.run;
  const sources = { root, keys, hasher, run, before, hold, listed, revisions, runtime };
  return keepDecisions(sources, files, report);
}

/**
 * The daemon's decisions, as `TierRecords` takes them: its merge hold read
 * at the record (`#ended`), the evidence, the record's outcome, then
 * `recordTier`'s end and `recordFile`'s decision per file.
 */
async function daemonColumn(
  { root, keys, hasher, tier, report }: Ran,
  store: Store,
  during: During,
) {
  const context = {
    root,
    worktreeId: WORKTREE,
    store,
    keys,
    hasher,
    runner: {
      traits: NO_TRAITS,
      environment: () => Promise.reject(new Error("no runner in this table")),
    },
    note: () => {},
  } as unknown as SchedulerContext;
  const hold = new MergeHold({
    root: root as AbsolutePath,
    store,
    worktreeId: WORKTREE,
    now: () => Date.now() as EpochMs,
    revision: () => tier.revision.number,
    resumed: () => {},
    note: () => {},
  });
  try {
    await hold.check();
    // A revision of the policy file reloads it (`reloadPolicy`, `WorktreeKeys.setPolicy`).
    if (during.policy !== undefined) keys.setPolicy(loadPolicy(root).policy);
    const { files } = tier;
    const installMoved = during.queued === "install moved";
    const inputs = await unstableInputs(tier, hasher);
    const evidence = await readRecordEvidence(context, tier, report, inputs, installMoved, hold);
    const outcome = recordOutcome(files, report, evidence, facts(files, evidence.held, during));
    const observed = evidence.observed ?? NOTHING_OBSERVED;
    const runtime = (ref: TestFileRef) => keys.runtimeIdentity(ref);
    const end = runEnd(tier, outcome.report, evidence.changed, outcome.requeue, observed, runtime);
    const holds = (entry: TierFile) => during.ledger !== "gone" || entry.file.ref !== A;
    return new Map(
      files.map((entry) => [entry.file.id, decisionOf(entry, end, outcome, holds(entry))]),
    );
  } finally {
    hold.close();
  }
}

/** The daemon record's facts of `a` that `during` names, at its one try. */
function facts(files: readonly TierFile[], held: readonly TierFile[], during: During): RecordFacts {
  const [a] = files;
  if (a === undefined) throw new Error("no file `a`");
  const withholds = new Withholds();
  if (during.withheldBefore === true) withholds.record([a]);
  const { queued } = during;
  return {
    held,
    startupHeld: queued === "not started",
    withholds: (barred) => withholds.peek(barred),
    unfinished: queued === "unfinished" ? [a.file.id] : [],
    notStarted: queued === "not started" ? [a] : [],
    interrupted: queued === "interrupted" ? [a.file.id] : [],
    installMoved: queued === "install moved",
  };
}

async function keyed(
  root: string,
  store: Store,
  hasher: Hasher,
  more: readonly string[],
): Promise<WorktreeKeys> {
  const keys = new WorktreeKeys({
    root,
    worktreeId: WORKTREE,
    store,
    hasher,
    objectFormat: "sha1",
    policy: loadPolicy(root).policy,
    squealVersion: "0.0.0-run-evidence",
    env: {},
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(root));
  await keys.setEnvironments([ENVIRONMENT]);
  for (const [testFile, paths] of CLOSURES) {
    keys.setClosure({ testFile, paths: [...paths, ...(testFile === A ? more : [])] });
  }
  await keys.trackUntracked();
  return keys;
}

function key(keys: WorktreeKeys, ref: TestFileRef): CheckKey {
  const at = keys.index.key(ref);
  if (at === null) throw new Error(`${ref.path} has no key`);
  return at;
}

/** A tier's entry as `selectTier` picks it, with the ledger's state of `a` that `during` names. */
function entryOf(keys: WorktreeKeys, ref: TestFileRef, during: During): TierFile {
  const at = key(keys, ref);
  const moved = ref === A ? during.ledger : undefined;
  const file = {
    ...newFileState(ref),
    key: moved === "rekeyed" ? OTHER_KEY : at,
    runningKey: moved === "superseded" ? OTHER_KEY : at,
  };
  const runtimePolicy =
    ref === A && during.runtimeMoved === true ? "an identity before" : keys.runtimeIdentity(ref);
  const inputs = keys.stabilityPaths(ref);
  return { file, key: at, inputs, runtimePolicy, checkpointId: null, forced: false };
}

/** `during`'s writes, each stat later than any before the run. */
async function happen(
  root: string,
  keys: WorktreeKeys,
  hasher: Hasher,
  tier: Tier,
  during: During,
): Promise<void> {
  const later = new Date(Date.now() + 60_000);
  const write = (path: string, text: string) => {
    writeTree(root, { [path]: text });
    utimesSync(join(root, path), later, later);
  };
  for (const [path, text] of Object.entries(during.write ?? {})) write(path, text);
  for (const path of during.touch ?? []) write(path, FILES[path] ?? "");
  for (const [path, text] of Object.entries(during.create ?? {})) writeTree(root, { [path]: text });
  if (during.merging !== undefined) unmerge(root, during.merging);
  if (during.policy !== undefined) {
    writeTree(root, { [POLICY_FILE]: `${JSON.stringify(during.policy)}\n` });
  }
  await revise(root, keys, hasher, tier, during.batch ?? {});
  await revise(root, keys, hasher, tier, during.next ?? {});
}

/** `batch` written, then applied in a revision as the watcher's batch is, to `tier` in flight. */
async function revise(
  root: string,
  keys: WorktreeKeys,
  hasher: Hasher,
  tier: Tier,
  batch: Readonly<Record<string, string | null>>,
): Promise<void> {
  const entries = Object.entries(batch);
  for (const [path, text] of entries) {
    if (text === null) rmSync(join(root, path));
    else writeTree(root, { [path]: text });
  }
  if (entries.length === 0) return;
  const candidates = await statCandidates(
    entries.map(([path]) => path),
    hasher,
  );
  const revision = await keys.reconcile({ trigger: "interval", paths: candidates }, () =>
    readHead(root),
  );
  // As `applyBatch` adds a revision to the tiers in flight: each path, and for an add or delete
  // its directories' listings, but an editor's scratch file's only as the record finds them.
  for (const change of revision?.changes ?? []) {
    tier.changes.add(change.path);
    const structural = change.oldHash === null || change.newHash === null;
    if (!structural || isEditorScratch(change.path)) continue;
    for (const listing of ancestorListings(change.path)) tier.changes.add(listing);
  }
}

/** The run's report: both files completed, `a`'s reads and the environment's loads as `during` says. */
function completed(files: readonly TestFileRef[], during: During): RunReport {
  return {
    end: "completed",
    durationMs: 1,
    completedFiles: files,
    results: [],
    fileErrors: [],
    failure: null,
    ...(during.read === undefined
      ? {}
      : { observed: [{ testFile: A, paths: [...during.read], directories: [] }] }),
    ...(during.loaded === undefined
      ? {}
      : { environmentObserved: [{ project: "", paths: [...during.loaded] }] }),
  };
}

/**
 * Marks `paths` unmerged in the index, each with three stages at the bytes
 * it holds, as a conflicted merge leaves a path: the worktree's bytes do
 * not move.
 */
function unmerge(root: string, paths: readonly string[]): void {
  const lines = paths.flatMap((path) => {
    const blob = git(root, ["rev-parse", `:${path}`]).trim();
    const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${path}`);
    return [`0 ${"0".repeat(blob.length)}\t${path}`, ...stages];
  });
  execFileSync("git", ["update-index", "--index-info"], {
    cwd: root,
    input: `${lines.join("\n")}\n`,
  });
}

function aborted(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}
