import { afterEach, describe, expect, it } from "vitest";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import {
  type Cut,
  decideYields,
  YIELD_REMAINDER_MS,
  type YieldView,
} from "../../src/core/scheduler/decide-yields.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { SHARE_FLOOR_MS } from "../../src/core/scheduler/sharing.js";
import type { SchedulerEvent } from "../../src/core/scheduler/step-events.js";
import type { Tier, TierKind } from "../../src/core/scheduler/tiers.js";
import { type YieldReach, yieldReach } from "../../src/core/scheduler/yields.js";
import type { EpochMs, RelativePath, WorktreeId } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Revision } from "../../src/core/types/revision.js";
import { NO_TRAITS } from "../../src/core/types/runner-traits.js";
import type { Store } from "../../src/core/types/store.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-354 (card 7, `research/scheduler-step.md`, "The yield split"):
 * the yield check's decide half over one reading, and the one switch that
 * places each scheduler event. These rows replace the direct `TierYields`
 * cases of `tier-yields-bound.test.ts` (row 011-107, 011-112) that only
 * read a decision; `tasks/011-354/notes.md` names them.
 */

const S = 1_000;
const T = 1_800_000_000_000 as EpochMs;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

/** A context at `T` whose clock throws when read: `decideYields` reads only `at`. */
function setup(promoted = true) {
  const store = freshStore();
  stores.push(store);
  const context = {
    store,
    worktreeId: "wt-011-354" as WorktreeId,
    policy: DEFAULT_POLICY,
    now: () => {
      throw new Error("decideYields read the clock");
    },
    runner: { traits: NO_TRAITS },
    keys: { cache: new StatCache(), isEnvironmentInput: () => false, runnerOf: () => undefined },
  } as unknown as SchedulerContext;
  const ledger = new Ledger({ ...context, now: () => T });
  if (promoted) {
    // A named wait's file, queued and promoted.
    const named = { project: "", path: "test/named.test.ts" };
    const file = ledger.addFile(named);
    file.key = "n".padEnd(64, "0") as CheckKey;
    ledger.enqueue(file, Priority.edited, false, true);
    ledger.queue.promote([named], T + 600_000);
  }
  return { context, ledger };
}

interface TierOptions {
  readonly ms: number | null;
  readonly kind?: TierKind;
  readonly ended?: boolean;
  readonly changed?: boolean;
}

/** A tier in flight since `T` of `paths`, each last `ms`, whose run cancels. */
function tierOf(ledger: Ledger, runId: string, paths: readonly string[], options: TierOptions) {
  const files = paths.map((path, i) => {
    const file = ledger.addFile({ project: "", path });
    file.key = `${runId}${i}`.padEnd(64, "0") as CheckKey;
    file.durationMs = options.ms;
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
    kind: options.kind ?? "edit",
    files,
    changes: new Set(options.changed === true ? paths : []),
    revision: { number: 1 },
    startedAt: T,
    cancel: new AbortController(),
    ...(options.ended === true ? { ended: new Set(files.map(({ file }) => file.id)) } : {}),
  } as unknown as Tier;
}

function view(
  context: SchedulerContext,
  ledger: Ledger,
  tiers: readonly Tier[],
  more: Partial<YieldView> = {},
): YieldView {
  return { context, ledger, tiers, marks: new Map(), standing: new Map(), held: false, ...more };
}

describe("decideYields: one reading, one answer per tier in flight (row 011-354)", () => {
  it("a hold reaches nothing: no decision, and no mark dropped (row 011-72)", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 5 * S });
    const stale: Cut = { key: "moved".padEnd(64, "0") as CheckKey, applied: 0, past: true };
    const marks = new Map([[tier.files[0]?.file.id ?? "", stale]]);
    expect(
      decideYields(T + 60 * S, null, view(context, ledger, [tier], { marks, held: true })),
    ).toBeNull();
  });

  it("a 5 s estimate 25 s in overruns: it yields at start + 35 s, its bound; the clock is never read", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts", "test/b.test.ts"], { ms: 5 * S });
    const decided = decideYields(T + 25 * S, null, view(context, ledger, [tier]));
    const yieldsAt = T + 5 * S + YIELD_REMAINDER_MS;
    expect(decided?.tiers).toEqual([
      { tier, decision: { kind: "overrun", yieldsAt }, bound: yieldsAt, yielded: null },
    ]);
    expect([...(decided?.standing.values() ?? [])]).toEqual([{ kind: "overrun", yieldsAt }]);
    expect(decided?.changed).toBe(true);
  });

  it("at its bound the overrun yields to the promoted file: its files are marked past their estimate", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 5 * S });
    const decided = decideYields(T + 35 * S, null, view(context, ledger, [tier]));
    const [file] = tier.files;
    expect(decided?.tiers).toEqual([
      {
        tier,
        decision: "yield",
        bound: null,
        yielded: { to: "promoted", remainderMs: -30 * S, cut: tier.files },
      },
    ]);
    expect([...(decided?.marks ?? [])]).toEqual([
      [file?.file.id, { key: file?.key, applied: 0, past: true }],
    ]);
    expect([...(decided?.standing.values() ?? [])]).toEqual([{ kind: "yields" }]);
    // The trigger never cancels it: nothing was aborted by deciding.
    expect(tier.cancel?.signal.aborted).toBe(false);
  });

  it("within its estimate the bound is estimate + 30 s, so a stale estimate yields there", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 20 * S });
    const decided = decideYields(T, null, view(context, ledger, [tier]));
    expect(decided?.tiers[0]?.decision).toEqual({ kind: "remainder", remainderMs: 20 * S });
    expect(decided?.tiers[0]?.bound).toBe(T + 20 * S + YIELD_REMAINDER_MS);
    const later = decideYields(T + 50 * S, null, view(context, ledger, [tier]));
    expect(later?.tiers[0]?.decision).toBe("yield");
  });

  it("files of no known duration or under SHARE_FLOOR_MS are bound 30 s past their estimate (row 011-112)", () => {
    const { context, ledger } = setup();
    const unknown = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: null });
    const short = tierOf(ledger, "run-b", ["test/b.test.ts"], { ms: SHARE_FLOOR_MS - 1 });
    const decided = decideYields(T, null, view(context, ledger, [unknown, short]));
    expect(decided?.tiers.map(({ bound }) => bound)).toEqual([
      T + YIELD_REMAINDER_MS,
      T + SHARE_FLOOR_MS - 1 + YIELD_REMAINDER_MS,
    ]);
  });

  it("a remainder yield marks its files not past their estimate (row 011-112)", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 100 * S });
    const decided = decideYields(T, null, view(context, ledger, [tier]));
    expect(decided?.tiers[0]?.decision).toBe("yield");
    expect([...(decided?.marks.values() ?? [])].map(({ past }) => past)).toEqual([false]);
  });

  it("a tier whose files have all ended has no bound and never yields past its estimate", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 5 * S, ended: true });
    const decided = decideYields(T + 10 * YIELD_REMAINDER_MS, null, view(context, ledger, [tier]));
    expect(decided?.tiers[0]?.bound).toBeNull();
    expect(typeof decided?.tiers[0]?.decision).not.toBe("string");
  });

  it("a later tier reads the marks an earlier one set: a file the first cut makes the second stand cut", () => {
    const { context, ledger } = setup();
    const first = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 100 * S });
    // The same file at the same key, in a second tier in flight.
    const second = { ...first, runId: "run-b", cancel: new AbortController() } as Tier;
    const decided = decideYields(T, null, view(context, ledger, [first, second]));
    expect(decided?.tiers.map(({ decision }) => decision)).toEqual(["yield", { kind: "cut" }]);
    const alone = decideYields(T, null, view(context, ledger, [second]));
    expect(alone?.tiers[0]?.decision).toBe("yield");
  });

  it("a mark whose key moved is dropped; one that holds is kept", () => {
    const { context, ledger } = setup();
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts", "test/b.test.ts"], { ms: 1 });
    const [a, b] = tier.files;
    if (a === undefined || b === undefined) throw new Error("no files");
    const marks = new Map<string, Cut>([
      [a.file.id, { key: a.key, applied: 0, past: true }],
      [b.file.id, { key: "moved".padEnd(64, "0") as CheckKey, applied: 0, past: true }],
    ]);
    const decided = decideYields(T, null, view(context, ledger, [], { marks }));
    expect([...(decided?.marks.keys() ?? [])]).toEqual([a.file.id]);
  });

  it("a slow tier and a focused tier yield to nothing; a cancelled one stands yields; a re-keyed one is superseded", () => {
    const { context, ledger } = setup();
    const slow = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 100 * S, kind: "slow" });
    const focused = tierOf(ledger, "run-b", ["test/b.test.ts"], { ms: 100 * S, kind: "focused" });
    const cancelled = tierOf(ledger, "run-c", ["test/c.test.ts"], { ms: 100 * S });
    cancelled.cancel?.abort("yield");
    const rekeyed = tierOf(ledger, "run-d", ["test/d.test.ts"], { ms: 100 * S, changed: true });
    const decided = decideYields(
      T,
      null,
      view(context, ledger, [slow, focused, cancelled, rekeyed]),
    );
    expect(decided?.tiers.map(({ decision }) => decision)).toEqual([
      null,
      null,
      { kind: "yields" },
      "supersession",
    ]);
  });

  it("with nothing waiting a tier decides nothing and its standing goes", () => {
    const { context, ledger } = setup(false);
    const tier = tierOf(ledger, "run-a", ["test/a.test.ts"], { ms: 100 * S });
    const standing = new Map([[tier.runId, { kind: "named" as const }]]);
    const decided = decideYields(T, null, view(context, ledger, [tier], { standing }));
    expect(decided?.tiers).toEqual([{ tier, decision: null, bound: null, yielded: null }]);
    expect(decided?.standing.size).toBe(0);
    expect(decided?.changed).toBe(true);
    const again = decideYields(T, null, view(context, ledger, [tier]));
    expect(again?.changed).toBe(false);
  });
});

describe("yieldReach: which scheduler events reach the yield check (row 011-354)", () => {
  const revision = { number: 2, changes: [] } as unknown as Revision;
  const changed = { runId: "run-changed", changes: new Set(["src/a.ts"]) } as unknown as Tier;
  const named = { runId: "run-named", changes: new Set() } as unknown as Tier;
  const plain = { runId: "run-plain", changes: new Set() } as unknown as Tier;
  const inFlight = new Map([changed, named, plain].map((tier) => [tier.runId, tier]));
  const reachView = {
    tier: (runId: string) => inFlight.get(runId),
    standsNamed: (tier: Tier) => tier === named,
  };
  const check: YieldReach = { reach: "check", trigger: null };
  const adopt: YieldReach = { reach: "adopt-then-check" };
  const none: YieldReach = { reach: "none" };

  const ROWS: readonly (readonly [string, SchedulerEvent, YieldReach])[] = [
    [
      "a stored revision: a check after it",
      { kind: "revision", revision },
      { reach: "check", trigger: revision },
    ],
    ["runner work applied", { kind: "runner-work-applied" }, check],
    ["a promotion or focus request taken", { kind: "request-taken" }, check],
    [
      "a tier started beside the batch's (row 011-269)",
      { kind: "tier-started", runId: "x", beside: true },
      check,
    ],
    ["any other tier start", { kind: "tier-started", runId: "x", beside: false }, none],
    [
      "a file end of a tier a revision changed (row 011-54)",
      { kind: "file-ended", runId: changed.runId },
      adopt,
    ],
    [
      "R398 (review 0.1.296 B1): a file end of a tier that stands named",
      { kind: "file-ended", runId: named.runId },
      adopt,
    ],
    [
      "a file end of a tier neither changed nor named",
      { kind: "file-ended", runId: plain.runId },
      none,
    ],
    ["a file end of a tier no longer in flight", { kind: "file-ended", runId: "gone" }, none],
    [
      "the yield bound's wake: adopt stored results first (rows 011-107, 011-123)",
      { kind: "wake", reason: "yield-bound" },
      adopt,
    ],
    ["the claims wake ends only the pump's wait", { kind: "wake", reason: "claims" }, none],
    ["a command hold's wake", { kind: "wake", reason: "command-hold" }, none],
    ["the pump's wake", { kind: "wake", reason: "pump" }, none],
    ["the pump asked for", { kind: "asked" }, none],
    ["a slot ran", { kind: "slot-ran", runId: "x" }, none],
    ["a tier ended", { kind: "tier-ended", runId: "x" }, none],
    ["runner work drained", { kind: "runner-work-drained" }, none],
    ["a stall", { kind: "stalled" }, none],
    ["the close", { kind: "closing" }, none],
  ];

  it.each(ROWS)("%s", (_name, event, reach) => {
    expect(yieldReach(event, reachView)).toEqual(reach);
  });
});
