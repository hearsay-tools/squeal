import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { readTurn } from "../../src/core/delivery/turn.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY, type SlowTrigger } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D2 trigger (a) as amended 2026-10-18 (004-79, row 004-80): under
 * `slow.trigger: "continuous"` a slow file starts once the revision's fast
 * work is done and the revision is `slow.quietMs` old, with the consumer in
 * a turn, and its result reaches the agent at the next tool call. The
 * harness keeps the default `SLOW_RECHECK_MS` (15 s), so a start within a
 * few seconds came from the quiet window's own timer. `"idle"` keeps the
 * file pending while the consumer is in a turn.
 */

const STRINGS = "test/strings.test.ts";
const UPPER = "test/upper.test.ts";
const QUIET_MS = 1_500;

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A started harness with one slow file, its consumer in a turn, the start's work done. */
async function inTurn(trigger: SlowTrigger) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-80-slot-"));
  slotDirs.push(slotDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: {
      ...RUN_MISSING,
      slow: { ...DEFAULT_POLICY.slow, include: [STRINGS], trigger, quietMs: QUIET_MS },
    },
    slow: { slotDir, load: () => [0], cpus: () => 1 },
  });
  const starts = new Map<string, number[]>();
  const run = h.runner.run.bind(h.runner);
  h.runner.run = (files, options) => {
    for (const file of files) starts.set(file.path, [...(starts.get(file.path) ?? []), Date.now()]);
    return run(files, options);
  };
  const { delivery, consumer } = await h.consumer();
  await delivery.startTurn(consumer);
  await h.scheduler.start();
  await waitFor(() => h.runsOf(UPPER).length > 0, 60_000);
  if (trigger === "continuous") await waitFor(() => h.runsOf(STRINGS).length === 1, 60_000);
  await h.scheduler.idle();
  return { h, store, delivery, consumer, starts };
}

describe("a continuous slow lane (spec 004 D2 as amended 2026-10-18)", SLOW, () => {
  it("starts the slow file quietMs after the edit's revision, its fast tier done, the consumer in a turn", async () => {
    const { h, store, consumer, starts } = await inTurn("continuous");
    h.write("src/strings.ts", "export const upper = (s: string): string => s.toUpperCase();\n");
    await h.batch("src/strings.ts");
    const revisedAt = store.revisions.latest(h.worktreeId)?.createdAt ?? 0;
    // Well inside the 15 s recheck: the quiet window's expiry pumped.
    await waitFor(() => h.runsOf(STRINGS).length === 2, 8_000);
    const slowAt = starts.get(STRINGS)?.[1] ?? 0;
    const fastAt = starts.get(UPPER)?.at(-1) ?? Number.POSITIVE_INFINITY;
    expect(fastAt).toBeLessThan(slowAt);
    expect(slowAt - revisedAt).toBeGreaterThanOrEqual(QUIET_MS);
    expect(readTurn(store, consumer).turn).toBe("in-turn");
  });

  it("delivers a slow failure at the next tool call of the same turn", async () => {
    const { h, delivery, consumer } = await inTurn("continuous");
    await delivery.onToolBoundary(consumer);
    h.write(
      STRINGS,
      'import { expect, it } from "vitest";\n\nit("uppercases", () => {\n  expect("a").toBe("B");\n});\n',
    );
    await h.batch(STRINGS);
    await waitFor(() => h.runsOf(STRINGS).length === 2, 8_000);
    await h.scheduler.idle();
    const delta = await delivery.onToolBoundary(consumer);
    if (delta === null) throw new Error("no delivery at the tool call");
    expect(formatDelta(delta)).toContain(STRINGS);
    const failed = delta?.entries.filter((e) => "to" in e && e.to === "fail") ?? [];
    expect(failed.map((e) => e.check.testPath)).toContain(STRINGS);
  });

  it('keeps the slow file pending while the consumer is in a turn under "idle"', async () => {
    const { h, store } = await inTurn("idle");
    await delay(QUIET_MS + 1_000);
    expect(h.runsOf(STRINGS)).toHaveLength(0);
    expect(readSlowActivity(store, h.worktreeId)).toEqual({ kind: "waiting", for: "idle" });
  });
});
