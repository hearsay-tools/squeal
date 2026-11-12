import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "../../src/core/daemon/policy.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher, type Hasher } from "../../src/core/hash/hasher.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import {
  copyInputs,
  decideFiles,
  type FileDecision,
  keepDecisions,
  readRecordEvidence,
  unstableInputs,
} from "../../src/core/run-evidence/run-evidence.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { newFileState } from "../../src/core/scheduler/files.js";
import type { MergeHold } from "../../src/core/scheduler/hold.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import type { Tier, TierFile } from "../../src/core/scheduler/tiers.js";
import type { RelativePath, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import type { RunReport } from "../../src/core/types/runner.js";
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
  /** Files created, and applied in a revision as the watcher's batch is. */
  readonly batch?: Readonly<Record<string, string>>;
  /** What `a`'s run read beyond its key (`RunReport.observed`). */
  readonly read?: readonly string[];
  /** The environment files the run loaded (`RunReport.environmentObserved`). */
  readonly loaded?: readonly string[];
  /** The paths a merge holds. */
  readonly merging?: readonly string[];
  /** `a` was selected under another runtime identity. */
  readonly runtimeMoved?: boolean;
  /** How the run ended; by default it completed both files. */
  readonly report?: (report: RunReport) => RunReport;
  /** The daemon's ledger of `a`: queued again, a cancel cut it, a newer run, gone, its key moved. */
  readonly ledger?: "requeue" | "cancelled" | "superseded" | "gone" | "rekeyed";
}

/** Each file's store decision with the daemon's sources, and with `squeal code`'s; `null` where it has none. */
export interface Decided {
  readonly daemon: ReadonlyMap<string, FileDecision>;
  readonly keeper: ReadonlyMap<string, FileDecision> | null;
}

const OTHER_KEY = "another-key" as CheckKey;

export async function decide(during: During): Promise<Decided> {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-run-evidence-"));
  try {
    const root = writeTree(join(scratch, "repo"), FILES);
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "fixture"]);
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
  await happen(root, keys, hasher, tier, during);
  const report = (during.report ?? ((r) => r))(completed([A, B], during));
  const keeper =
    during.ledger === undefined
      ? await keepDecisions(
          { root, keys, hasher, run: tier.run, before: tier.snapshot },
          CLOSURES.map(([ref]) => ({ ref, key: key(keys, ref), paths: keys.stabilityPaths(ref) })),
          report,
        )
      : null;
  const context = {
    root,
    worktreeId: WORKTREE,
    store,
    keys,
    hasher,
    runner: { environment: () => Promise.reject(new Error("no runner in this table")) },
    note: () => {},
  } as unknown as SchedulerContext;
  const inputs = await unstableInputs(tier, hasher);
  const evidence = await readRecordEvidence(context, tier, report, inputs, false, hold(during));
  const daemon = decideFiles(tier, report, evidence, {
    ...(during.ledger === "requeue" ? { requeue: new Set([testFileId(A)]) } : {}),
    holds: (entry) => during.ledger !== "gone" || entry.file.ref !== A,
    runtimeIdentity: (ref) => keys.runtimeIdentity(ref),
  });
  keys.endRun();
  return { daemon, keeper };
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
  const batch = Object.entries(during.batch ?? {});
  for (const [path, text] of batch) writeTree(root, { [path]: text });
  if (batch.length === 0) return;
  const candidates = await statCandidates(
    batch.map(([path]) => path),
    hasher,
  );
  const revision = await keys.reconcile({ trigger: "interval", paths: candidates }, () =>
    readHead(root),
  );
  for (const change of revision?.changes ?? []) tier.changes.add(change.path);
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

/** A merge hold of `during.merging`, as `MergeHold` names paths. */
function hold(during: During): MergeHold {
  const merging = new Set(during.merging ?? []);
  return {
    holding: merging.size > 0,
    names: (paths: readonly RelativePath[]) => paths.some((path) => merging.has(path)),
  } as unknown as MergeHold;
}

function aborted(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}
