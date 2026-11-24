import { afterEach, describe, expect, it, vi } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { planDelta } from "../../src/core/delivery/delta.js";
import { markedView, trustedMark } from "../../src/core/delivery/view-mark.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { SELECT_STATES, toKnownState } from "../../src/core/store/repos/states.js";
import { connectionOf } from "../../src/core/store/store.js";
import { KNOWN_STATES_NON_PASS, relevantStates } from "../../src/core/store/view-seed.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { Consumer, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { check, freshStore, releasedStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Spec 024 D2 (row 024-02): a consumer with a trusted mark plans its delivery on
 * `relevantStates` (the states not `pass`, those its view holds, those born after the mark),
 * not on every known state. A state left out is a pass with no entry born at or before the
 * mark, which `markedView` reads as a told pass, so the plan is the same.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };
const CONSUMERS = [C1, C2] as const;
const CHECKS: readonly CheckId[] = Array.from({ length: 8 }, (_, i) => check(`c${i}`));

let store: Store | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

/** A small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `planDelta` as `createDelivery`'s `plan` calls it, on `states`. */
function planOn(s: Store, consumer: Consumer, states: readonly KnownState[]) {
  const view = s.views.list(consumer);
  return planDelta({
    view: markedView(s, consumer, view, states),
    states,
    isBaselineFinding: () => false,
    toldAt: 1,
    rootOf: () => null,
    revision: s.revisions.latest(consumer.worktreeId)?.number ?? 0,
    history: (c) => s.transitions.history(consumer.worktreeId, c),
  });
}

/** `relevantStates` as 024 D2 wrote it, one scan with three tests per state: the rows D6.2 keeps. */
function reference(s: Store, consumer: Consumer, mark: number): KnownState[] {
  return connectionOf(s)
    .all(
      `${SELECT_STATES} WHERE s.worktree_id = ? AND (s.outcome != 'pass'
         OR EXISTS (SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id
           AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)
         OR EXISTS (SELECT 1 FROM state_born b WHERE b.worktree_id = s.worktree_id
           AND b.check_id = s.check_id AND b.id > ?))
       ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      consumer.worktreeId,
      consumer.sessionId,
      consumer.agentId,
      mark,
    )
    .map(toKnownState);
}

/** The plan of `relevantStates`' statement, read from the connection's last prepared form. */
function relevantPlan(s: Store, consumer: Consumer, mark: number): string {
  const conn = connectionOf(s);
  const all = vi.spyOn(conn, "all");
  relevantStates(s, consumer, mark);
  const [sql, ...params] = all.mock.calls.at(-1) ?? [""];
  all.mockRestore();
  return conn
    .all(`EXPLAIN QUERY PLAN ${sql}`, ...params)
    .map((row) => String(row.detail))
    .join(" | ");
}

describe("relevantStates plans as every known state does (spec 024 D2)", () => {
  it("over random writes, retirements, re-births, registrations and deliveries", {
    timeout: 20_000,
  }, async () => {
    let compared = 0;
    let narrower = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
      const s = freshStore();
      store = s;
      // Spec 025 D6.2: half the stores as an older daemon leaves them, without the index.
      if (seed % 2 === 0) connectionOf(s).run(`DROP INDEX ${KNOWN_STATES_NON_PASS}`);
      setKey(s, "k1");
      const delivery: HarnessDelivery = createDelivery(s, {
        status: fixedStatus(),
        now: () => 10_000,
      });
      const sink = createStateSink(s, { now: () => 10_000 });
      let revision = 0;
      const land = (c: CheckId, outcome: "pass" | "fail", message: string) => {
        revision++;
        sink.applyResults(WT, revision, [result(c, outcome, { message })], { checkpointId: null });
      };
      for (const c of CHECKS) land(c, next() < 0.7 ? "pass" : "fail", "m0");
      const registered = new Set<Consumer>();
      for (let step = 0; step < 40; step++) {
        const r = next();
        const c = pick(CHECKS);
        if (r < 0.3) land(c, next() < 0.6 ? "pass" : "fail", pick(["m0", "m1"]));
        else if (r < 0.4) {
          const state = s.knownStates.get(WT, c);
          if (state !== null) s.knownStates.upsertMany([{ ...state, outcome: "unknown" }]);
        } else if (r < 0.5) sink.retire(WT, [c]);
        else if (r < 0.65) {
          const consumer = pick(CONSUMERS);
          await delivery.register(consumer);
          registered.add(consumer);
        } else if (r < 0.85) await delivery.onToolBoundary(pick(CONSUMERS));
        else await delivery.peek(pick(CONSUMERS), { kinds: ["pass-to-fail", "first-seen-fail"] });
        for (const consumer of registered) {
          const mark = trustedMark(s, consumer);
          if (mark === null) continue;
          const full = s.knownStates.list(WT);
          const narrow = relevantStates(s, consumer, mark.mark);
          expect(narrow).toEqual(reference(s, consumer, mark.mark));
          expect(planOn(s, consumer, narrow)).toEqual(planOn(s, consumer, full));
          compared++;
          if (narrow.length < full.length) narrower++;
        }
      }
      s.close();
      store = null;
    }
    // The comparison ran, and on reads that left states out.
    expect(compared).toBeGreaterThan(500);
    expect(narrower).toBeGreaterThan(100);
  });
});

describe("relevantStates' indexed lookups (spec 025 D6.2)", () => {
  it("search the non-pass index, the view and the birth marks, then each state by key", () => {
    const s = freshStore();
    store = s;
    const plan = relevantPlan(s, C1, 0);
    expect(plan).toMatch(/SEARCH known_states USING (COVERING )?INDEX known_states_non_pass/);
    expect(plan).toMatch(/SEARCH consumer_views USING (COVERING )?INDEX/);
    expect(plan).toMatch(/SEARCH state_born USING (COVERING )?INDEX/);
    expect(plan).toMatch(
      /SEARCH s USING INDEX sqlite_autoindex_known_states_1 \(worktree_id=\? AND check_id=\?\)/,
    );
    expect(plan).not.toMatch(/SCAN (s|known_states)\b/);
  });

  it("read without the index on a store that lacks it", () => {
    const s = freshStore();
    store = s;
    connectionOf(s).run(`DROP INDEX ${KNOWN_STATES_NON_PASS}`);
    const plan = relevantPlan(s, C1, 0);
    expect(plan).not.toMatch(/known_states_non_pass/);
    expect(plan).not.toMatch(/SCAN s\b/);
  });
});

describe("a marked consumer's silent boundary (spec 024 D2)", () => {
  async function marked(s: Store) {
    setKey(s, "k1");
    const sink = createStateSink(s, { now: () => 10_000 });
    sink.applyResults(WT, 1, [result(check("a"), "pass"), result(check("b"), "pass")], {
      checkpointId: null,
    });
    const delivery = createDelivery(s, { status: fixedStatus(), now: () => 10_000 });
    await delivery.register(C1);
    return { delivery, sink };
  }

  it("reads no full state list while nothing is told", async () => {
    const s = freshStore();
    store = s;
    const { delivery } = await marked(s);
    expect(trustedMark(s, C1)).not.toBeNull();
    const list = vi.spyOn(s.knownStates, "list");
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(await delivery.peek(C1, { kinds: ["pass-to-fail"] })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("still touches the consumer's last seen time (row 001-89)", async () => {
    const s = freshStore();
    store = s;
    let at = 10_000;
    setKey(s, "k1");
    createStateSink(s, { now: () => at }).applyResults(WT, 1, [result(check("a"), "pass")], {
      checkpointId: null,
    });
    const delivery = createDelivery(s, { status: fixedStatus(), now: () => at });
    await delivery.register(C1);
    at = 20_000;
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(s.consumers.get(C1)?.lastSeenAt).toBe(20_000);
  });

  it("reads the full list for the news it tells, and tells it", async () => {
    const s = freshStore();
    store = s;
    const { delivery, sink } = await marked(s);
    sink.applyResults(WT, 2, [result(check("a"), "fail", { revision: 2 })], { checkpointId: null });
    const list = vi.spyOn(s.knownStates, "list");
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.entries.map((e) => e.kind)).toEqual(["pass-to-fail"]);
    expect(list).toHaveBeenCalledWith(WT);
  });

  it("reads every state for a consumer with no mark, as before", async () => {
    const s = releasedStore();
    store = s;
    const { delivery } = await marked(s);
    expect(trustedMark(s, C1)).toBeNull();
    const list = vi.spyOn(s.knownStates, "list");
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(list).toHaveBeenCalledWith(WT);
  });
});
