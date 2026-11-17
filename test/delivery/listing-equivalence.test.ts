import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { viewMarkOf } from "../../src/core/delivery/view-mark.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { check, freshStore, OTHER, releasedStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 005-113: the equivalence of `view-equivalence.test.ts` (row 005-106) on the real delivery
 * and two real stores. Random runs of registrations before and after the listing, the listing,
 * state writes (own and inherited), unknowns, retirements, tool boundaries, peeks and Stops go
 * to both stores alike:
 *
 * - a store no daemon of 0.1.545 or later served (`releasedStore`): every registration seeds
 *   the full copy and every delivery writes each state never told, the reference;
 * - a store with birth marks (`freshStore`): the registration seeds the rows not `pass`, and
 *   every unrestricted delivery seeds its writes the same way (`markedWrites`), the first one
 *   after the listing included; a peek keeps its writes.
 *
 * Every registration's and delivery's text must be the same, later deliveries included.
 */

const RUNS = 300;
const STEPS = 24;
const SEED = 11;

const FILE: TestFileRef = { project: "", path: "src/own.test.ts" };
const CHECKS = ["a", "b", "c"].map((name) => check(name, FILE));
const CONSUMERS: readonly Consumer[] = ["s1", "s2"].map((sessionId) => ({
  worktreeId: WT,
  sessionId,
  agentId: "main",
}));
const REGRESSIONS = new Set(["pass-to-fail", "first-seen-fail", "fail-changed"]);
type Design = "reference" | "seeded";

const root = mkdtempSync(join(tmpdir(), "squeal-005-113-eq-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Side {
  readonly store: Store;
  readonly delivery: HarnessDelivery;
}

function side(store: Store): Side {
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, WT);
  return { store, delivery: createDelivery(store, { status: fixedStatus(), now: () => 10_000 }) };
}

const text = (d: Delta | null) => (d === null ? "null" : formatDelta(d));
const viewRows = (s: Side) =>
  Number(connectionOf(s.store).get("SELECT count(*) AS n FROM consumer_views")?.n ?? 0);

interface Tally {
  differences: string[];
  deliveries: number;
  told: number;
  /** Deliveries after which the seeded store held fewer view rows than the reference. */
  sparser: number;
  /** Deliveries that seeded their writes: the consumer's mark moved. */
  seeded: number;
}

async function run(rand: () => number, tally: Tally): Promise<void> {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const sides: Record<Design, Side> = {
    reference: side(releasedStore()),
    seeded: side(freshStore()),
  };
  const both = async (step: string, act: (s: Side) => Promise<string> | string) => {
    const reference = await act(sides.reference);
    const seeded = await act(sides.seeded);
    if (reference !== seeded) tally.differences.push(`${step}\n${reference}\n---\n${seeded}`);
    return reference;
  };
  let listed = false;
  let revision = 0;
  for (let step = 0; step < STEPS; step++) {
    const r = rand();
    const c = pick(CHECKS);
    const consumer = pick(CONSUMERS);
    if (r < 0.35) {
      const outcome = pick(["pass", "pass", "fail", "skip"] as const);
      const message = pick(["m1", "m2"]);
      const worktreeId = rand() < 0.3 ? OTHER : WT;
      revision++;
      await both("land", (s) => {
        const results = [result(c, outcome, { message, worktreeId, revision })];
        s.store.results.putMany(results);
        createStateSink(s.store).applyResults(WT, revision, results, { checkpointId: null });
        return "";
      });
    } else if (r < 0.42) {
      await both("unknown", (s) => {
        const state = s.store.knownStates.get(WT, c);
        if (state !== null) {
          s.store.knownStates.upsertMany([{ ...state, outcome: "unknown", fingerprint: null }]);
        }
        return "";
      });
    } else if (r < 0.48) {
      await both("retire", (s) => {
        createStateSink(s.store).retire(WT, [c]);
        return "";
      });
    } else if (r < 0.58) {
      await both(`register ${consumer.sessionId}`, async (s) =>
        formatRegistration(await s.delivery.register(consumer, { atStart: true })),
      );
    } else if (r < 0.63) {
      if (listed) continue;
      listed = true;
      await both("list", (s) => {
        setKey(s.store, "k1", { file: FILE });
        return "";
      });
    } else {
      const kind = r < 0.85 ? "boundary" : r < 0.93 ? "peek" : "stop";
      tally.deliveries++;
      const mark = viewMarkOf(sides.seeded.store, consumer)?.mark;
      const said = await both(`${kind} ${consumer.sessionId}`, async (s) =>
        text(
          kind === "peek"
            ? await s.delivery.peek(consumer, { kinds: [...REGRESSIONS] as never })
            : await s.delivery.onToolBoundary(consumer, { stop: kind === "stop" }),
        ),
      );
      if (said !== "null") tally.told++;
      if (viewMarkOf(sides.seeded.store, consumer)?.mark !== mark) tally.seeded++;
      if (viewRows(sides.seeded) < viewRows(sides.reference)) tally.sparser++;
    }
  }
  sides.reference.store.close();
  sides.seeded.store.close();
}

describe("the seeded first delivery after the listing against the full write (row 005-113)", async () => {
  let state = SEED;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const tally: Tally = {
    differences: [],
    deliveries: 0,
    told: 0,
    sparser: 0,
    seeded: 0,
  };
  for (let i = 0; i < RUNS; i++) await run(rand, tally);

  it("delivers and seeds often enough to mean something", () => {
    // Seed 11 at 300 runs: 2,608 deliveries, 259 with text, 153 that seeded their writes.
    expect(tally.told).toBeGreaterThan(RUNS / 2);
    expect(tally.seeded).toBeGreaterThan(RUNS / 4);
    expect(tally.sparser).toBeGreaterThan(RUNS);
  });

  it("says the same text at every registration and delivery", () => {
    expect(tally.differences.slice(0, 3)).toEqual([]);
  });
});
