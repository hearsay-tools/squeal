import { describe, expect, it } from "vitest";
import { askRetry } from "../../src/core/retry/records.js";
import { fullSuiteRequest } from "../../src/core/scheduler/checkpoint-requests.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { REINSTALLED_REASON } from "../../src/core/scheduler/narrow-run.js";
import { BacklogQuiet } from "../../src/core/scheduler/quiet.js";
import { NO_PASS } from "../../src/core/scheduler/request-intake.js";
import { groupRequest } from "../../src/core/scheduler/request-intake-requests.js";
import type { NowRequest, Request } from "../../src/core/scheduler/request-intake-types.js";
import { retryRequest } from "../../src/core/scheduler/retries.js";
import { WarmUp } from "../../src/core/scheduler/warm-up.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { TESTS_GROUP } from "../../src/core/types/scheduler.js";
import { threadLockHolder } from "../helpers/busy-store.js";
import {
  A,
  B,
  KEYS,
  NO_RUNNER,
  NOTHING,
  OPERATION,
  probe,
  probeHost,
  queueA,
  WT,
  waited,
} from "./request-intake-probe.js";

/*
 * Row 011-322: the request intake's table. A probe request goes through
 * `RequestIntake.take`, the entry point every scheduler request takes, over
 * a real store and a real ledger (`request-intake-probe.ts`); a second
 * connection holding `BEGIN IMMEDIATE` makes the store busy. The host's
 * lanes and pump are a log, and its progress record a log line and the
 * real `RequestProgress`, so each row reads what the intake did, in what
 * order, and what the progress counts. No runner: the probe asks none.
 * The covered files' record (row 011-325) is `request-covered.test.ts`.
 */

const HOLD_MS = 300;
/** What the intake does with the probe, in order: its stage, then after the commit its record, wake and pump. */
const TAKEN = [
  "stage (A not queued)",
  "record test/a.test.ts (A queued)",
  "wake lane probe",
  "pump",
];

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
      const installWait = { stage: waited("abandoned") };
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
      installWait: { answer: (_c, _l, plan, why) => ({ answer: `${plan}: ${why}`, covered: [] }) },
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
    const installWait = { stage: waited("abandoned"), passFirst: true as const };
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

  // The per-request registration cases this replaces: `request-progress.test.ts`'s "run tests counts
  // each of its files" (the group's files) and the retry request's claimed files (review wave 3.6, B3).
  it("records the real group request's files: a running one counts once it ended", async () => {
    const p = probeHost();
    const b = p.ledger.file(B);
    const key = KEYS.get(B.path) as CheckKey;
    if (b === undefined) throw new Error("B is not listed");
    p.ledger.setRunning(b, key);
    const answer = await p.intake.take(groupRequest(TESTS_GROUP, p.groups, undefined));
    // `B` was running; `A` has no key, so it is not queued and its ask counts nothing.
    expect(answer).toMatchObject({ queued: 1 });
    expect(p.log).toEqual(["record test/a.test.ts test/b.test.ts (A not queued)", "pump"]);
    expect(p.progress.count).toBe(0);
    p.ledger.setRunning(b, null);
    p.ledger.applyResults(b, key, [], null);
    expect(p.progress.count).toBe(1);
  });

  // Review 0.1.470, S1: `request-progress.test.ts`'s "run --all counts each of its files once it
  // ended, slow files included", with the real `run --all` declaration.
  it("records the real run --all request's files: a slow one counts once it ended", async () => {
    const slow = { ...DEFAULT_POLICY.slow, include: [B.path] };
    const p = probeHost({ policy: { ...DEFAULT_POLICY, slow } });
    const host = { quiet: new BacklogQuiet(), warmUp: new WarmUp() };
    const record = await p.intake.take(fullSuiteRequest({}, host));
    // `A` cannot be keyed, so the checkpoint fails it; `B`, slow and queued, is its work.
    expect(record.testFiles.map((ref) => ref.path)).toEqual([B.path, A.path]);
    expect(p.log).toContain("record test/b.test.ts test/a.test.ts (A not queued)");
    const b = p.ledger.file(B);
    if (b === undefined) throw new Error("B is not listed");
    p.ledger.applyResults(b, KEYS.get(B.path) as CheckKey, [], record.id);
    expect(p.progress.count).toBe(1);
  });

  it("records the real retry request's claimed files only, then wakes their lanes", async () => {
    const p = probeHost();
    p.ledger.settle([A], NOTHING);
    p.ledger.commit();
    const key = KEYS.get(A.path) as CheckKey;
    askRetry(p.store, {
      testFile: A,
      key,
      session: "s1",
      reason: "environment",
      at: 1,
      worktreeId: WT,
    });
    await p.intake.take(retryRequest());
    expect(p.ledger.file(A)?.retryKey).toBe(key);
    // Row 011-323: the lane of each claimed file's group, after the record; `A` is a `tests` file.
    expect(p.log).toEqual(["record test/a.test.ts (A queued)", "wake lane tests", "pump"]);
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
      installWait: { stage: waited("abandoned"), passFirst: true },
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
