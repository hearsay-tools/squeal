import { describe, expect, it } from "vitest";
import { mergeHoldMetaKey } from "../../src/core/scheduler/hold-rows.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 011-73 (011 C6 as amended 2026-10-21; `tasks/011-61/design.md` R2,
 * test 5): Stop's wait does not wait while the worktree is on hold, since no
 * tier starts then; without the hold it waits for the pending check. A hold
 * that starts just before a Stop is said once (C8; review 0.1.269, B2): at
 * the next tool boundary, since at Stop it waits for one (row 011-215).
 */

const deps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  env: {},
  ensureDaemon: async () => "alive",
  ...overrides,
});

/** The live daemon's merge hold, as it publishes it (row 011-72). */
function holdMerge(r: SquealRepo): void {
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  const row = { v: 1, since: Date.now(), revision, paths: ["src/math.ts"], count: 1 };
  r.store.meta.set(mergeHoldMetaKey(r.worktreeId), JSON.stringify(row));
}

/** A registered session with `src/math.test.ts` queued under a new key, and Stop's wait at 1 s. */
async function pending(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), deps());
  r.queue("k2");
  r.policy({ stop: { waitMs: 1_000 } });
  return r;
}

async function stopMs(r: SquealRepo): Promise<number> {
  const started = performance.now();
  await runHook("stop", recorded("stop", r.root), deps());
  return performance.now() - started;
}

describe("Stop's wait on hold (row 011-73)", () => {
  it("5: returns at once while the worktree is on hold", async () => {
    const r = await pending();
    holdMerge(r);
    expect(await stopMs(r)).toBeLessThan(500);
  });

  it("B2, row 011-215: a hold first seen at Stop waits for the next tool boundary, which says it once", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    holdMerge(r);
    const stop = await runHook("stop", recorded("stop", r.root), deps());
    expect(stop.stdout).toBe("");
    const next = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(
      next.stdout.match(/SQUEAL · validation on hold at revision \d+: git lists 1 unmerged path/g),
    ).toHaveLength(1);
    const again = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
    expect(again.stdout).not.toContain("on hold");
  });

  it("5: without a hold, waits for the pending check", async () => {
    const r = await pending();
    expect(await stopMs(r)).toBeGreaterThanOrEqual(900);
  });
});
