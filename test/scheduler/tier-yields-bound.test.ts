import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { SHARE_FLOOR_MS } from "../../src/core/scheduler/sharing.js";
import type { Tier } from "../../src/core/scheduler/tiers.js";
import { Wakes } from "../../src/core/scheduler/wakes.js";
import {
  publishedYieldRow,
  TierYields,
  YIELD_REMAINDER_MS,
} from "../../src/core/scheduler/yields.js";
import type { RelativePath, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { virtualClock } from "../helpers/virtual-clock.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-107 (coordinator's contract): on the virtual clock (row 011-352;
 * fake timers before), a tier past its
 * estimate yields at estimate + `YIELD_REMAINDER_MS` with no event after the
 * check, through the one unref'd timer `TierYields` arms and the re-check it
 * calls, as the scheduler's `#recheckTiers` does under its lock. The timer
 * goes when its tier ends and when the yields close. Row 011-112: files
 * under `SHARE_FLOOR_MS` or of no known duration yield so too.
 */

const WT = "wt-011-107" as WorktreeId;
const stores: Store[] = [];

let clock = virtualClock();
let wakes = new Wakes(clock);

beforeEach(() => {
  clock = virtualClock(Date.now());
  wakes = new Wakes(clock);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup() {
  const store = freshStore();
  stores.push(store);
  const context = {
    store,
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => clock.now(),
    runner: { traits: NO_TRAITS },
    keys: { cache: new StatCache(), isEnvironmentInput: () => false, runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  const ledger = new Ledger(context);
  // A named wait's file, queued and promoted.
  const named = { project: "", path: "test/named.test.ts" };
  const file = ledger.addFile(named);
  file.key = "n".padEnd(64, "0") as CheckKey;
  ledger.enqueue(file, Priority.edited, false, true);
  ledger.queue.promote([named], clock.now() + 600_000);
  return { store, context, ledger };
}

/** A tier in flight since now of `paths`, each last `ms`, whose run cancels. */
function tierOf(ledger: Ledger, runId: string, paths: readonly string[], ms: number | null): Tier {
  const files = paths.map((path, i) => {
    const file = ledger.addFile({ project: "", path });
    file.key = `${runId}${i}`.padEnd(64, "0") as CheckKey;
    file.durationMs = ms;
    return {
      file,
      key: file.key,
      inputs: [path as RelativePath],
      checkpointId: null,
      forced: false,
    };
  });
  return {
    runId,
    lane: "",
    kind: "edit",
    files,
    changes: new Set(),
    revision: { number: 1 },
    startedAt: clock.now(),
    cancel: new AbortController(),
  } as unknown as Tier;
}

describe("a tier past its estimate yields at its bound with no event (row 011-107)", () => {
  it("a 5 s estimate: overrun 20 s past it, the timer checks again at 30 s past and the tier yields", () => {
    const { store, context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts", "test/b.test.ts"], 5_000);
    let rechecks = 0;
    const yields = new TierYields(() => {
      rechecks += 1;
      yields.check(context, ledger, [tier], null);
    }, wakes);

    clock.advance(5_000 + 20_000);
    yields.check(context, ledger, [tier], null);
    expect([...publishedYieldRow(store, WT, 0).tiers.values()]).toEqual([
      { kind: "overrun", yieldsAt: (tier.startedAt ?? 0) + 5_000 + YIELD_REMAINDER_MS },
    ]);
    expect(clock.armed).toBe(1);

    clock.advance(YIELD_REMAINDER_MS - 20_000 - 1);
    expect(rechecks).toBe(0);
    expect(tier.cancel?.signal.aborted).toBe(false);

    clock.advance(1);
    expect(rechecks).toBe(1);
    expect(tier.cancel?.signal.reason).toBe("yield");
    expect([...publishedYieldRow(store, WT, 0).tiers.values()]).toEqual([{ kind: "yields" }]);
    expect(clock.armed).toBe(0);
  });

  it("within its estimate the bound is estimate + 30 s too, so a stale estimate yields there", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], 20_000);
    const yields = new TierYields(() => yields.check(context, ledger, [tier], null), wakes);

    yields.check(context, ledger, [tier], null);
    expect(tier.cancel?.signal.aborted).toBe(false);

    clock.advance(20_000 + YIELD_REMAINDER_MS - 1);
    expect(tier.cancel?.signal.aborted).toBe(false);
    clock.advance(1);
    expect(tier.cancel?.signal.reason).toBe("yield");
  });

  it("files under SHARE_FLOOR_MS or of no known duration yield at the timer, 30 s past their estimate (row 011-112)", () => {
    const { context, ledger } = setup();
    const unknown = tierOf(ledger, "run-a", ["test/a.test.ts"], null);
    const short = tierOf(ledger, "run-b", ["test/b.test.ts"], SHARE_FLOOR_MS - 1);
    const yields = new TierYields(
      () => yields.check(context, ledger, [unknown, short], null),
      wakes,
    );

    yields.check(context, ledger, [unknown, short], null);
    expect(clock.armed).toBe(1);
    clock.advance(YIELD_REMAINDER_MS - 1);
    expect(unknown.cancel?.signal.aborted).toBe(false);
    clock.advance(1);
    expect(unknown.cancel?.signal.reason).toBe("yield");
    expect(short.cancel?.signal.aborted).toBe(false);
    clock.advance(SHARE_FLOOR_MS - 1);
    expect(short.cancel?.signal.reason).toBe("yield");
    expect(clock.armed).toBe(0);
  });

  it("the files an overrun yield cut read as cut past their estimate until their key moves; a remainder yield's do not (row 011-112)", () => {
    const { context, ledger } = setup();
    const overrun = tierOf(ledger, "run-a", ["test/a.test.ts"], 5_000);
    const remainder = tierOf(ledger, "run-b", ["test/b.test.ts"], 100_000);
    const yields = new TierYields(undefined, wakes);
    const [a, b] = [overrun, remainder].map((tier) => tier.files[0]?.file);
    if (a === undefined || b === undefined) throw new Error("no files");
    expect(yields.cutPastEstimate(a)).toBe(false);

    clock.advance(5_000 + YIELD_REMAINDER_MS);
    yields.check(context, ledger, [overrun, remainder], null);
    expect(overrun.cancel?.signal.reason).toBe("yield");
    expect(remainder.cancel?.signal.reason).toBe("yield");
    expect(yields.cutPastEstimate(a)).toBe(true);
    expect(yields.cutPastEstimate(b)).toBe(false);

    a.key = "moved".padEnd(64, "0") as CheckKey;
    expect(yields.cutPastEstimate(a)).toBe(false);
  });

  it("a tier whose files have all ended arms no timer and never yields past its estimate", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], 5_000);
    const ended = { ...tier, ended: new Set(tier.files.map(({ file }) => file.id)) } as Tier;
    const yields = new TierYields(() => yields.check(context, ledger, [ended], null), wakes);

    yields.check(context, ledger, [ended], null);
    clock.advance(10 * YIELD_REMAINDER_MS);
    yields.check(context, ledger, [ended], null);

    expect(clock.armed).toBe(0);
    expect(ended.cancel?.signal.aborted).toBe(false);
  });

  it("one timer at the earliest bound; it goes when its tiers end and when the yields close", () => {
    const { context, ledger } = setup();
    const early = tierOf(ledger, "run-a", ["test/a.test.ts"], 5_000);
    const late = tierOf(ledger, "run-b", ["test/b.test.ts"], 25_000);
    let rechecks = 0;
    const yields = new TierYields(() => {
      rechecks += 1;
    }, wakes);

    yields.check(context, ledger, [early, late], null);
    expect(clock.armed).toBe(1);
    yields.ended(context, early);
    expect(clock.armed).toBe(1);
    // The timer moved to the later bound: nothing at the earlier one.
    clock.advance(5_000 + YIELD_REMAINDER_MS);
    expect(rechecks).toBe(0);
    yields.ended(context, late);
    expect(clock.armed).toBe(0);

    yields.check(context, ledger, [tierOf(ledger, "run-c", ["test/c.test.ts"], 5_000)], null);
    expect(clock.armed).toBe(1);
    yields.close();
    expect(clock.armed).toBe(0);
    clock.advance(10 * YIELD_REMAINDER_MS);
    expect(rechecks).toBe(0);
  });
});
