import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { GroupTiers } from "../../src/core/scheduler/group-tiers.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { type IntakeHost, RequestIntake } from "../../src/core/scheduler/request-intake.js";
import type { Request, Skip, Staged } from "../../src/core/scheduler/request-intake-types.js";
import { RequestProgress } from "../../src/core/scheduler/request-progress.js";
import type { SlowTier } from "../../src/core/scheduler/slow-tier.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { BusyWaits } from "../../src/core/store/busy.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import type { DeliveredPass } from "../../src/core/types/watcher.js";
import { HARNESS_DAEMON } from "./store-wait.js";

/*
 * Rows 011-322 and 011-325: the request intake's probe. `RequestIntake`
 * over a real store and a real ledger, its host's lanes and pump a log,
 * its progress record the real `RequestProgress` (review 0.1.470, S1) and
 * a log line, so a row reads what the intake did, in what order, and what
 * the progress counts. No runner: no probe asks one.
 */

export const WT = "wt-011-322" as WorktreeId;
export const A: TestFileRef = { project: "", path: "test/a.test.ts" };
export const B: TestFileRef = { project: "", path: "test/b.test.ts" };
/** Not listed by the probe: a row lists them (row 011-325). */
export const C: TestFileRef = { project: "", path: "test/c.test.ts" };
export const D: TestFileRef = { project: "", path: "test/d.test.ts" };
export const S: TestFileRef = { project: "", path: "test/s.test.ts" };
/** Each test file's key; a file not listed has none. */
export const KEYS = new Map<string, CheckKey>(
  [A, B, C, D, S].map((ref, i) => [ref.path, "abcde"[i]?.repeat(64) as CheckKey]),
);
/** `ref`'s key. */
export function keyOf(ref: TestFileRef): CheckKey {
  const key = KEYS.get(ref.path);
  if (key === undefined) throw new Error(`${ref.path} has no key`);
  return key;
}
export const NOTHING = new Set<never>();
/** The daemon's `BUSY_SLICE_MS`, short. */
const SLICE_MS = 25;
export const OPERATION = "taking a probe request";
export const NO_RUNNER: Skip = { skip: "the probe waits for no runner work" };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

export interface Probe {
  readonly intake: RequestIntake;
  readonly store: Store;
  readonly dir: AbsolutePath;
  readonly database: string;
  readonly context: SchedulerContext;
  readonly ledger: Ledger;
  readonly lock: Mutex;
  /** The real progress record (row 018-12), the ledger's `ends`. */
  readonly progress: RequestProgress;
  /** The lanes of the real group requests; each logs its request. */
  readonly groups: GroupTiers;
  /** What the intake and the probe did, in order. */
  readonly log: string[];
  readonly notes: string[];
  /**
   * The host's state: open, stopping, waiting, started; `now`, the context's
   * clock; `keys`, each file's key (`KEYS` at first), which an edit moves.
   */
  readonly state: {
    open: boolean;
    stopping: boolean;
    waiting: string | null;
    started: boolean;
    delivered: number;
    now: EpochMs;
    readonly keys: Map<string, CheckKey>;
  };
  /** `A`'s row as another connection reads it: what the store committed. */
  committed(): { key: CheckKey | null; pending: string | null } | undefined;
  /** `A`'s pending phase as the store committed it. */
  seen(): string;
}

/**
 * A store with `B` queued and `A` listed, unkeyed; the intake over it. With
 * `dir`, the store there, as a daemon that took the worktree over opens it;
 * with `queued: false`, `B` is listed and unkeyed too.
 */
export function probeHost(
  options: { dir?: AbsolutePath; policy?: Policy; queued?: boolean } = {},
): Probe {
  const dir = options.dir ?? tempDir();
  const store = open(dir);
  const reader = open(dir);
  store.worktrees.upsert({
    id: WT,
    root: join(dir, "wt"),
    commonDir: dir,
    isMain: true,
    registeredAt: Date.now(),
    daemon: {
      ...HARNESS_DAEMON,
      socketPath: "/tmp/squeal-011-322.sock",
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 600_000,
    },
  });
  const log: string[] = [];
  const notes: string[] = [];
  const lock = new Mutex();
  const state = {
    open: true,
    stopping: false,
    waiting: null as string | null,
    started: true,
    delivered: 2,
    now: Date.now(),
    keys: new Map(KEYS),
  };
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: options.policy ?? DEFAULT_POLICY,
    now: () => state.now,
    note: () => {},
    keys: {
      runnerOf: () => undefined,
      runtimeIdentity: () => "",
      writeRuntimeApplications: () => {},
      index: {
        key: (ref: TestFileRef) => state.keys.get(ref.path) ?? null,
        keysReadAsOne: () => null,
      },
      stabilityPaths: () => [],
      removeTestFile: () => {},
    },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  const progress = new RequestProgress();
  ledger.ends = progress;
  ledger.addFile(A);
  ledger.addFile(B);
  if (options.queued !== false) ledger.settle([B], NOTHING);
  ledger.commit();
  const lane = {
    request: () => log.push("lane requested"),
    narrow: { add: () => log.push("lane asked") },
  } as unknown as SlowTier;
  const waits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
  const host: IntakeHost = {
    lock,
    started: () => {
      if (!state.started) throw new Error("squeal scheduler: not started");
      return { context, ledger };
    },
    open: () => state.open,
    stopping: () => state.stopping,
    waiting: () => state.waiting,
    awaitingInstall: () => state.waiting === AWAITING_INSTALL_REASON,
    installPass: async () => {
      log.push("install pass");
      state.waiting = null;
    },
    passes: () => ({
      started: () => 1,
      pass: async () => void log.push("pass"),
      deliveredPass: () => ({ number: state.delivered }) as DeliveredPass,
    }),
    busy: () => ({ waits, sliceMs: SLICE_MS }),
    runnerPending: () => false,
    afterRunnerWork: (task, operation) => lock.run(task, operation),
    record: (files) => {
      log.push(`record ${files.map((f) => f.ref.path).join(" ")} (${seen()})`);
      progress.ask(files);
    },
    wakeAll: () => log.push("wake all lanes"),
    wakeLane: (group) => log.push(`wake lane ${group}`),
    cutTiers: () => log.push("cut tiers"),
    pump: () => log.push("pump"),
  };
  const committed = () => {
    const row = reader.testFileKeys.list(WT).find((r) => r.testFile.path === A.path);
    return row === undefined ? undefined : { key: row.key, pending: row.pending };
  };
  const seen = () => `A ${committed()?.pending ?? "not queued"}`;
  return {
    intake: new RequestIntake(host),
    store,
    dir,
    database: storePaths(dir).database,
    context,
    ledger,
    lock,
    progress,
    groups: new GroupTiers(() => lane),
    log,
    notes,
    state,
    committed,
    seen,
  };
}

export function tempDir(): AbsolutePath {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-322-")) as AbsolutePath;
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(dir: AbsolutePath): Store {
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  return store;
}

/** The probe's stage: keys and queues `A`, its covered file, and commits; logs what the store had. */
export function queueA(p: Probe) {
  return (_: SchedulerContext, ledger: Ledger): Staged<string> => {
    p.log.push(`stage (${p.seen()})`);
    ledger.settle([A], NOTHING);
    ledger.commit();
    const file = ledger.file(A);
    if (file === undefined) throw new Error("A is not listed");
    return { answer: "queued", covered: [file] };
  };
}

/** The probe request: rules as given, else at-once waiting, no runner work, `queueA`, its lane woken. */
export function probe(p: Probe, rules: Partial<Request<string>> = {}): Request<string> {
  return {
    operation: OPERATION,
    start: { skip: "the probe's host throws before the start" },
    installWait: { atOnce: "waiting" },
    runnerWork: NO_RUNNER,
    store: { stage: queueA(p) },
    wake: { lane: "probe" },
    ...rules,
  };
}

/** An install-wait answer in the stage's transaction: `answer`, covering no file. */
export function waited(answer: string): (_c: SchedulerContext, _l: Ledger) => Staged<string> {
  return () => ({ answer, covered: [] });
}
