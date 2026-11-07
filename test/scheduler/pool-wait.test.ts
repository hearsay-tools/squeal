import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMark, type PoolMark, writeMark } from "../../src/core/capacity/index.js";
import { StatCache } from "../../src/core/hash/index.js";
import { TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { POOL_WAIT_REFRESH_MS, PoolWaits } from "../../src/core/scheduler/pool-wait.js";
import { Priority } from "../../src/core/scheduler/queue.js";
import { NONE_CUT } from "../../src/core/scheduler/sharing.js";
import { selectTier } from "../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type AbsolutePath,
  type CheckKey,
  DEFAULT_POLICY,
  type PoolGate,
  type PoolWait,
  type Store,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { liveDaemon } from "../delivery/fakes.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-309 (spec 011 C10 Capacity as amended 2026-11-07, "a pool wait is
 * told"; `tasks/011-308/design.md` D2): a lane whose tier the pool refused
 * waits for CPU from its first refusal to a grant in that lane. The daemon
 * logs one line at its start and one, with its seconds, at its grant, none
 * per recheck, and publishes since when and what the pool read for status.
 * A batch's tier, which goes on without a permit (row 011-308), names no
 * lane: nothing waits.
 */

const GATE: PoolGate = { busyCores: 21.4, cpus: 24, hostSlots: 12, grants: 7 };

/** A `PoolWaits` on a clock the test moves, its log lines and its writes. */
function waits() {
  const at = { now: 1_000_000 };
  const lines: string[] = [];
  const rows: { lanes: Map<string, PoolWait>; at: number }[] = [];
  const pool = new PoolWaits({
    now: () => at.now,
    log: (line) => lines.push(line),
    publish: (lanes, written) => rows.push({ lanes: new Map(lanes), at: written }),
  });
  return { pool, at, lines, rows };
}

describe("a lane's wait for the pool (row 011-309)", () => {
  it("logs its start once and its grant with its seconds, none per recheck", () => {
    const { pool, at, lines } = waits();
    pool.refused("vitest", GATE);
    for (let s = 2; s <= 62; s += 2) {
      at.now += 2_000;
      pool.refused("vitest", { ...GATE, busyCores: 20 + (s % 3) });
    }
    at.now += 1_000;
    pool.granted("vitest");

    expect(lines).toEqual([
      "the pool refused the vitest lane's tier: it waits for CPU (21 of 24 cores in use; Squeal's daemons hold 7 of 12 test slots); the daemon asks again every 2 s",
      "the pool granted the vitest lane's tier after 63 s of waiting for CPU",
    ]);
    // A grant with no wait open logs nothing.
    pool.granted("vitest");
    expect(lines).toHaveLength(2);
  });

  it("writes since when at its start, the pool's latest reading every 10 s, and no row once granted", () => {
    const { pool, at, rows } = waits();
    const start = at.now;
    pool.refused("vitest", GATE);
    at.now += 2_000;
    pool.refused("vitest", { ...GATE, grants: 8 });
    expect(rows).toHaveLength(1);
    at.now += POOL_WAIT_REFRESH_MS;
    pool.refused("vitest", { ...GATE, grants: 9 });

    expect(rows.map((r) => r.at)).toEqual([start, at.now]);
    expect(rows[1]?.lanes.get("vitest")).toEqual({ ...GATE, grants: 9, since: start });
    pool.granted("vitest");
    expect(rows.at(-1)?.lanes.size).toBe(0);
  });

  it("refusals more than 30 s apart are two waits; a lane that stops looking leaves the row", () => {
    const { pool, at, lines, rows } = waits();
    pool.refused("vitest", GATE);
    at.now += 31_000;
    pool.refused("node", GATE);
    expect(rows.at(-1)?.lanes.has("vitest")).toBe(false);
    pool.refused("vitest", GATE);
    expect(rows.at(-1)?.lanes.get("vitest")?.since).toBe(at.now);
    expect(lines.filter((l) => l.startsWith("the pool refused the vitest"))).toHaveLength(2);
  });

  it("drops its row when the scheduler closes, and writes none when it held no wait", () => {
    const quiet = waits();
    quiet.pool.close();
    expect(quiet.rows).toEqual([]);

    const { pool, rows } = waits();
    pool.refused("vitest", GATE);
    pool.close();
    expect(rows.at(-1)?.lanes.size).toBe(0);
  });
});

describe("TierCapacity tells a lane's wait what the pool read (row 011-309)", () => {
  let root: string;
  let dir: AbsolutePath;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "squeal-pool-wait-test-"));
    dir = join(root, "squeal-uid") as AbsolutePath;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("a refused tier that names its lane starts its wait, and a grant there ends it", () => {
    // Two other daemons hold 7 of 12 permits on 13 cores: the gate refuses (row 011-98).
    const others: PoolMark[] = [
      { id: "other-0", want: 3, grant: 3, since: null, cores: 6 },
      { id: "other-1", want: 4, grant: 4, since: null, cores: 7 },
    ];
    for (const mark of others) writeMark(dir, mark);
    const { pool, at, lines, rows } = waits();
    const capacity = new TierCapacity(
      { dir, hostSlots: 12, host: null },
      "wt-011-309" as WorktreeId,
      () => {},
      pool,
    );
    try {
      expect(capacity.take(4, "fast", 1, "backlog")).toBe(WAIT_FOR_CAPACITY);
      expect(lines).toEqual([]);
      expect(capacity.take(4, "fast", 1, "backlog", "vitest")).toBe(WAIT_FOR_CAPACITY);
      expect(rows.at(-1)?.lanes.get("vitest")).toEqual({
        since: at.now,
        busyCores: 13,
        cpus: availableParallelism(),
        hostSlots: 12,
        grants: 7,
      });

      for (const mark of others) clearMark(dir, mark.id as WorktreeId);
      at.now += 5_000;
      const lease = capacity.take(4, "fast", 1, "backlog", "vitest");
      expect(lease).not.toBe(WAIT_FOR_CAPACITY);
      if (lease !== WAIT_FOR_CAPACITY) lease?.release();
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe("the pool granted the vitest lane's tier after 5 s of waiting for CPU");
      expect(rows.at(-1)?.lanes.size).toBe(0);
    } finally {
      capacity.close();
    }
  });
});

describe("selectTier names the lane of a refused tier, not a batch's (row 011-309)", () => {
  const stores: Store[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  function setup() {
    const store = freshStore();
    stores.push(store);
    const wt = "wt-011-309" as WorktreeId;
    liveDaemon(store, wt);
    const asked: (string | null)[] = [];
    const capacity = {
      offer: () => 0,
      take: (_w: number, _l: string, _least: number, _k: string, waitsIn: string | null = null) => {
        asked.push(waitsIn);
        return WAIT_FOR_CAPACITY;
      },
      running: () => () => {},
      refused: () => true,
    } as unknown as TierCapacity;
    const context = {
      root: "/repo/wt-011-309",
      store,
      sink: createStateSink(store),
      worktreeId: wt,
      policy: DEFAULT_POLICY,
      now: () => 1_000_000,
      note: () => {},
      runsDir: "/repo/.git/squeal/runs",
      hostLoad: () => ({ oneMinute: null, cpus: 1 }),
      capacity,
      runner: { lane: () => "vitest" },
      keys: {
        runnerOf: () => undefined,
        runtimeIdentity: () => "",
        writeRuntimeApplications: () => {},
        index: { key: () => null, keysReadAsOne: () => null },
        cache: new StatCache(),
        stabilityPaths: () => [],
        beginRun: () => 1,
        endRun: () => {},
      },
    } as unknown as SchedulerContext;
    const ledger = new Ledger(context);
    const queue = (path: string) => {
      const ref = { project: "", path };
      const file = ledger.addFile(ref);
      file.key = Buffer.from(path).toString("hex").padEnd(64, "0") as CheckKey;
      ledger.enqueue(file, Priority.transitive, false, false);
      return ref;
    };
    return { context, ledger, asked, queue };
  }

  it("a refused backlog tier waits in its lane; a refused batch's goes on and names none", () => {
    const backlog = setup();
    backlog.queue("test/b.test.ts");
    expect(selectTier(backlog.context, backlog.ledger, new Set(), NONE_CUT)).toBeNull();
    expect(backlog.asked).toEqual(["vitest"]);

    const batch = setup();
    batch.ledger.queue.promote([batch.queue("test/w.test.ts")], 1_060_000);
    expect(selectTier(batch.context, batch.ledger, new Set(), NONE_CUT)?.promoted).toBe(true);
    expect(batch.asked).toEqual([null]);
  });
});
