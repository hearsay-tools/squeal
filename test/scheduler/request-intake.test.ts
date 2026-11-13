import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import { REINSTALLED_REASON } from "../../src/core/scheduler/narrow-run.js";
import {
  type IntakeHost,
  NO_PASS,
  RequestIntake,
} from "../../src/core/scheduler/request-intake.js";
import type { NowRequest, Request, Skip } from "../../src/core/scheduler/request-intake-types.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { BusyWaits } from "../../src/core/store/busy.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import type { DeliveredPass } from "../../src/core/types/watcher.js";
import { threadLockHolder } from "../helpers/busy-store.js";
import { HARNESS_DAEMON } from "./store-wait.js";

/*
 * Row 011-322: the request intake's table. A probe request goes through
 * `RequestIntake.take`, the entry point every scheduler request takes, over
 * a real store and a real ledger; a second connection holding `BEGIN
 * IMMEDIATE` makes the store busy. The host's lanes, pump and progress
 * record are a log, so each row reads what the intake did and in what
 * order. No runner: the probe asks none.
 */

const WT = "wt-011-322" as WorktreeId;
const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const KEYS = new Map([
  [A.path, "a".repeat(64) as CheckKey],
  [B.path, "b".repeat(64) as CheckKey],
]);
const NOTHING = new Set<never>();
/** The daemon's `BUSY_SLICE_MS`, short. */
const SLICE_MS = 25;
const HOLD_MS = 300;
const OPERATION = "taking a probe request";
const NO_RUNNER: Skip = { skip: "the probe waits for no runner work" };
/** What the intake does with the probe, in order: its stage, then after the commit its record, wake and pump. */
const TAKEN = [
  "stage (A not queued)",
  "record test/a.test.ts (A queued)",
  "wake lane probe",
  "pump",
];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface Probe {
  readonly intake: RequestIntake;
  readonly store: Store;
  readonly database: string;
  readonly ledger: Ledger;
  readonly lock: Mutex;
  /** What the intake and the probe did, in order. */
  readonly log: string[];
  readonly notes: string[];
  /** The host's state: open, stopping, waiting, started. */
  readonly state: {
    open: boolean;
    stopping: boolean;
    waiting: string | null;
    started: boolean;
    delivered: number;
  };
  /** `A`'s row as another connection reads it: what the store committed. */
  committed(): { key: CheckKey | null; pending: string | null } | undefined;
  /** `A`'s pending phase as the store committed it. */
  seen(): string;
}

/** A store with `B` queued and `A` listed, unkeyed; the intake over it. */
function probeHost(): Probe {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-322-")) as AbsolutePath;
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
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
  const context = {
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: Date.now,
    note: () => {},
    keys: {
      runnerOf: () => undefined,
      runtimeIdentity: () => "",
      writeRuntimeApplications: () => {},
      index: { key: (ref: TestFileRef) => KEYS.get(ref.path) ?? null, keysReadAsOne: () => null },
      stabilityPaths: () => [],
      removeTestFile: () => {},
    },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  ledger.addFile(A);
  ledger.addFile(B);
  ledger.settle([B], NOTHING);
  ledger.commit();
  const log: string[] = [];
  const notes: string[] = [];
  const lock = new Mutex();
  const state = { open: true, stopping: false, waiting: null, started: true, delivered: 2 };
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
    record: (files) => log.push(`record ${files.map((f) => f.ref.path).join(" ")} (${seen()})`),
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
    database: storePaths(dir).database,
    ledger,
    lock,
    log,
    notes,
    state,
    committed,
    seen,
  };
}

function open(dir: AbsolutePath): Store {
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  return store;
}

/** The probe's stage: keys and queues `A`, its covered file, and commits; logs what the store had. */
function queueA(p: Probe) {
  return (_: SchedulerContext, ledger: Ledger) => {
    p.log.push(`stage (${p.seen()})`);
    ledger.settle([A], NOTHING);
    ledger.commit();
    const file = ledger.file(A);
    if (file === undefined) throw new Error("A is not listed");
    return { answer: "queued", covered: [file] };
  };
}

/** The probe request: rules as given, else at-once waiting, no runner work, `queueA`, its lane woken. */
function probe(p: Probe, rules: Partial<Request<string>> = {}): Request<string> {
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

describe("request intake: a busy store (spec 021 D2)", () => {
  it("runs the stage once, after the holder ends, and names the wait", async () => {
    const p = probeHost();
    const holder = threadLockHolder(p.database, HOLD_MS);
    holder.take();

    const answer = await p.intake.take(probe(p));

    expect(answer).toBe("queued");
    expect(holder.released).toBe(true);
    expect(p.log.filter((line) => line.startsWith("stage"))).toHaveLength(1);
    expect(p.committed()?.pending).not.toBeNull();
    expect(p.notes.join("\n")).toMatch(/a probe request/);
  });

  it("answers a refusal at the daemon's stop with the operation named, and records nothing", async () => {
    const p = probeHost();
    const holder = threadLockHolder(p.database, HOLD_MS);
    holder.take();
    p.state.stopping = true;

    await expect(p.intake.take(probe(p))).rejects.toThrow(
      `${OPERATION}: the store was still busy when the daemon stopped`,
    );

    expect(p.log).toEqual([]);
    expect(p.committed()?.pending).toBeNull();
  });

  // Quirk 1: with no runner work the lock is taken again on each try; with runner work it is held.
  it.each([
    ["no runner work: the lock is let go between tries", NO_RUNNER, ["other", "stage"]],
    [
      "runner work always: the lock is held through every try",
      { always: async () => ({ plan: undefined }) },
      ["stage", "other"],
    ],
  ] as const)("%s", async (_, runnerWork, order) => {
    const p = probeHost();
    const holder = threadLockHolder(p.database, HOLD_MS);
    holder.take();

    const request = p.intake.take(probe(p, { runnerWork }));
    const other = p.lock.run(() => void p.log.push("other"));
    await Promise.all([request, other]);

    const seen = p.log.filter((line) => line === "other" || line.startsWith("stage"));
    expect(seen.map((line) => line.split(" ")[0])).toEqual(order);
  });
});

describe("request intake: the install wait", () => {
  const reasons = [AWAITING_INSTALL_REASON, REINSTALLED_REASON];

  it.each(reasons)("at once (%s): answers before the lock, nothing else", async (reason) => {
    const p = probeHost();
    p.state.waiting = reason;
    expect(await p.intake.take(probe(p))).toBe("waiting");
    expect(p.log).toEqual([]);
  });

  it.each(reasons)(
    "in the stage's transaction (%s): its answer, nothing recorded or woken",
    async (reason) => {
      const p = probeHost();
      p.state.waiting = reason;
      const installWait = { stage: () => "abandoned" };
      expect(await p.intake.take(probe(p, { installWait }))).toBe("abandoned");
      expect(p.log).toEqual(["pump"]);
      expect(p.ledger.file(A)?.phase).toBeNull();
    },
  );

  it.each(reasons)("from its plan (%s): the reason in the answer, no write", async (reason) => {
    const p = probeHost();
    p.state.waiting = reason;
    const request: Request<string, string> = {
      ...probe(p),
      installWait: { answer: (_c, _l, plan, why) => `${plan}: ${why}` },
      runnerWork: { always: async () => ({ plan: "selected" }) },
      store: { stage: (context, ledger) => queueA(p)(context, ledger) },
    };
    expect(await p.intake.take(request)).toBe(`selected: ${reason}`);
    expect(p.log).toEqual(["pump"]);
    expect(p.committed()?.pending).toBeNull();
  });

  it("runs an awaited install's pass first; the wait it ended takes the stage", async () => {
    const p = probeHost();
    p.state.waiting = AWAITING_INSTALL_REASON;
    const installWait = { stage: () => "abandoned", passFirst: true as const };
    expect(await p.intake.take(probe(p, { installWait }))).toBe("queued");
    expect(p.log[0]).toBe("install pass");
  });
});

describe("request intake: the progress record (row 018-12)", () => {
  it("records only the covered files the stage queued, after the commit", async () => {
    const p = probeHost();
    await p.intake.take(probe(p));
    // `B` is queued too, but not by this request; the record line reads the committed store.
    expect(p.ledger.file(B)?.phase).toBe("queued");
    expect(p.ledger.file(A)?.phase).toBe("queued");
    expect(p.log).toEqual(TAKEN);
  });

  it("records nothing for a stage that throws, and leaves the ledger and store as they were", async () => {
    const p = probeHost();
    const request = probe(p, {
      store: {
        stage: (context, ledger) => {
          queueA(p)(context, ledger);
          throw new Error("the probe failed");
        },
      },
    });

    await expect(p.intake.take(request)).rejects.toThrow("the probe failed");

    expect(p.log).toEqual(["stage (A not queued)"]);
    expect(p.ledger.file(A)).toMatchObject({ key: null, phase: null });
    expect(p.committed()).toEqual({ key: null, pending: null });
  });
});

describe("request intake: the stop", () => {
  it("answers the closed answer once closed, before the lock", async () => {
    const p = probeHost();
    p.state.open = false;
    expect(await p.intake.take(probe(p, { start: { closed: "closed" } }))).toBe("closed");
    expect(p.log).toEqual([]);
  });

  it("answers the closed answer for a request that asks for nothing", async () => {
    const p = probeHost();
    const start = { closed: "nothing asked", nothing: true };
    expect(await p.intake.take(probe(p, { start }))).toBe("nothing asked");
    expect(p.log).toEqual([]);
  });

  it("rejects before the start with no closed answer, and starts no work", async () => {
    const p = probeHost();
    p.state.started = false;
    await expect(p.intake.take(probe(p))).rejects.toThrow("not started");
    expect(p.log).toEqual([]);
  });

  it("answers a synchronous request at once, closed or waiting", () => {
    const p = probeHost();
    const request: NowRequest<boolean> = {
      operation: "refreshing a probe",
      start: { closed: false },
      installWait: { atOnce: false },
      runnerWork: NO_RUNNER,
      store: {
        skip: "the probe writes no store",
        covers: { skip: "the probe queues no file" },
        now: () => p.log.push("now") > 0,
      },
      wake: { skip: "the probe wakes no lane" },
    };
    p.state.open = false;
    expect(p.intake.take(request)).toBe(false);
    p.state.open = true;
    p.state.waiting = REINSTALLED_REASON;
    expect(p.intake.take(request)).toBe(false);
    p.state.waiting = null;
    expect(p.intake.take(request)).toBe(true);
    expect(p.log).toEqual(["now", "pump"]);
  });
});

describe("request intake: the order", () => {
  it("records, then wakes, then starts work", async () => {
    const p = probeHost();
    await p.intake.take(probe(p));
    expect(p.log).toEqual(TAKEN);
  });

  // Quirk 5, then quirk 2: a pass delivered after the request, the install's pass, then all lanes.
  it("takes a pass, the install's pass and every lane's wake before the lock", async () => {
    const p = probeHost();
    p.state.waiting = AWAITING_INSTALL_REASON;
    const request = probe(p, {
      start: { skip: "probe", afterPass: true },
      installWait: { stage: () => "abandoned", passFirst: true },
      wake: { allLanes: "the probe's lanes" },
    });
    await p.intake.take(request);
    expect(p.log).toEqual([
      "pass",
      "install pass",
      "wake all lanes",
      "stage (A not queued)",
      "record test/a.test.ts (A queued)",
      "pump",
    ]);
  });

  it("rejects with no pass delivered after the request, and takes nothing", async () => {
    const p = probeHost();
    p.state.delivered = 1;
    const request = probe(p, { start: { skip: "probe", afterPass: true } });
    await expect(p.intake.take(request)).rejects.toThrow(NO_PASS);
    expect(p.log).toEqual(["pass"]);
  });

  it("applies a request that writes no store under the lock, then cuts the tiers", async () => {
    const p = probeHost();
    const request = probe(p, {
      store: {
        skip: "the probe writes no store",
        covers: { skip: "the probe queues no file" },
        apply: () => `applied ${p.log.push("apply")}`,
      },
      wake: { cutTiers: true },
    });
    expect(await p.intake.take(request)).toBe("applied 1");
    expect(p.log).toEqual(["apply", "cut tiers", "pump"]);
  });

  it("takes a release outside the store first, or the stage when it declines", async () => {
    const p = probeHost();
    const outside = (answer: string | null) => ({
      skip: "the probe's release writes no store",
      release: () => (answer === null ? null : { answer }),
      work: () => void p.log.push("work"),
    });
    const released = probe(p, { store: { stage: queueA(p), outside: outside("released") } });
    expect(await p.intake.take(released)).toBe("released");
    expect(p.log).toEqual(["work", "pump"]);
    p.log.length = 0;
    const declined = probe(p, { store: { stage: queueA(p), outside: outside(null) } });
    expect(await p.intake.take(declined)).toBe("queued");
    expect(p.log).toEqual(TAKEN);
  });

  it("does not compile a request without its install-wait answer or covered files", () => {
    const p = probeHost();
    const { installWait: _, ...rest } = probe(p);
    // @ts-expect-error: no install-wait answer
    const noWait: Request<string> = rest;
    const noCovered: Request<string> = {
      ...probe(p),
      // @ts-expect-error: a stage that names no covered files
      store: { stage: () => ({ answer: "queued" }) },
    };
    const noCovers: Request<string> = {
      ...probe(p),
      // @ts-expect-error: a request that writes no store names why it records no file
      store: { skip: "the probe writes no store", apply: () => "applied" },
    };
    expect([noWait, noCovered, noCovers]).toHaveLength(3);
  });
});
