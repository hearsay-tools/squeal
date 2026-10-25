import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedStartupMetaKey } from "../../src/core/keys/index.js";
import { SLOW } from "./helpers.js";
import { CONTROL_TEST, keyOf, open, PRELOADED, twoWorktrees } from "./preload-worktrees.js";

/*
 * 007 review wave 2.5, R1: the observed-paths refinement (`refreshObserved`)
 * asks the runner with no changed path, so it must still hear the preload
 * set another worktree grew. Wave 2.5's guard returned before both, so the
 * key stayed current without a newly known environment input. Since spec
 * 016 D4 the core keeps the set (`observedStartup.<project>`) and the
 * refinement joins its growth to the environments.
 */

describe("a runner-only refinement still hears shared preload growth (007 R1)", () => {
  it("re-keys a node:test project when another worktree grew its preloads", SLOW, async () => {
    const { repo, store } = await twoWorktrees(true);
    writeFileSync(join(repo.main, "nt/src/newly_observed.cjs"), "globalThis.extraValue = 1;\n");
    const a = await open(repo.main, store, repo.commonDir, undefined, PRELOADED);
    await a.scheduler.start();
    await a.scheduler.idle();
    const before = keyOf(store, repo.main, CONTROL_TEST);
    expect(before).toBeTruthy();

    // What another worktree's run publishes, transactionally, in the shared key.
    const meta = observedStartupMetaKey(PRELOADED.name);
    const prior = JSON.parse(store.meta.get(meta) ?? "[]") as string[];
    store.meta.set(meta, JSON.stringify([...prior, "nt/src/newly_observed.cjs"]));
    a.scheduler.refreshObserved();
    await a.scheduler.idle();

    expect(keyOf(store, repo.main, CONTROL_TEST)).not.toBe(before);
  });
});
