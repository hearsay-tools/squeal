import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPACITY_RECHECK_MS,
  TierCapacity,
  WAIT_FOR_CAPACITY,
} from "../../../src/core/scheduler/capacity.js";
import { FakeProvider, history, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/*
 * Row 017-37 (gh-238): a quiet file the revisions since its first or config
 * keying changed lints as an edit's part, outside the background ceiling,
 * while the pool refuses every backlog lease. The backlog keeps waiting.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** The scheduler's pool, with `refuse` making every backlog look a refusal; `asked` logs each call. */
function refusing(worktreeId: string) {
  const dir = mkdtempSync(join(tmpdir(), "squeal-lint-edited-"));
  const capacity = new TierCapacity(
    { dir, hostSlots: 4, host: null, cpus: 64 },
    worktreeId,
    () => {},
  );
  cleanups.push(() => {
    capacity.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const state = { refuse: false, asked: [] as string[] };
  const spy = {
    take: (...args: Parameters<TierCapacity["take"]>) => {
      state.asked.push("take");
      return state.refuse ? WAIT_FOR_CAPACITY : capacity.take(...args);
    },
    running: (workers: number) => {
      state.asked.push(`running ${workers}`);
      return capacity.running(workers);
    },
  };
  return { spy, state };
}

const FILES = Array.from({ length: 20 }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);
const NEW_CONFIG = "export default [{ rules: { semi: 'off' } }];\n";

/** A worktree whose 20 files linted once, then a config change that leaves them all pending. */
async function configKeyed(alsoEdit: string | null) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const tree = lintTree();
  for (const path of FILES) tree.write(path, "ok\n");
  tree.revise();
  const { spy, state } = refusing(tree.id);
  const provider = new FakeProvider();
  const { pass } = lintPass(tree, provider, { capacity: () => spy });
  pass.nudge();
  await pass.idle();
  expect(provider.calls.flat()).toHaveLength(FILES.length);
  state.refuse = true;
  state.asked.length = 0;
  provider.calls.length = 0;
  tree.write("eslint.config.js", NEW_CONFIG);
  if (alsoEdit !== null) tree.write(alsoEdit, "bad no-undef\n");
  tree.revise();
  pass.nudge();
  await pass.idle();
  return { tree, provider, pass, state };
}

function pendingOthers(tree: ReturnType<typeof lintTree>, but: string): string[] {
  const all = outcomes(storeOf(tree), tree);
  return Object.entries(all)
    .filter(([path, outcome]) => path !== but && outcome !== "pending")
    .map(([path]) => path);
}

describe("a gate's own changed files lint outside the backlog lease (row 017-37)", () => {
  it("an edit after a config keying reaches fail while the backlog stays pending", async () => {
    const { tree, provider, pass, state } = await configKeyed(null);
    expect(provider.calls).toEqual([]);
    expect(Object.values(outcomes(storeOf(tree), tree))).toEqual(FILES.map(() => "pending"));

    tree.write("src/f07.js", "bad no-undef\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toEqual([["src/f07.js"]]);
    expect(outcomes(storeOf(tree), tree)["src/f07.js"]).toBe("fail");
    // Still the keying's: a quiet file records no transition (D2's last row).
    expect(history(storeOf(tree), tree, "src/f07.js")).toEqual([]);
    expect(pendingOthers(tree, "src/f07.js")).toEqual([]);
    expect(state.asked).toEqual(["take", "running 1", "take"]);

    // The backlog parts still wait while refused, and look again.
    state.asked.length = 0;
    await vi.advanceTimersByTimeAsync(CAPACITY_RECHECK_MS);
    await pass.idle();
    expect(state.asked).toEqual(["take"]);
    expect(provider.calls).toHaveLength(1);
    expect(pendingOthers(tree, "src/f07.js")).toEqual([]);

    state.refuse = false;
    await vi.advanceTimersByTimeAsync(CAPACITY_RECHECK_MS);
    await pass.idle();
    expect(provider.calls.flat()).toHaveLength(FILES.length);
    await pass.close();
  });

  it("a file the config keying's own revisions changed lints at once, and not again", async () => {
    const { tree, provider, pass, state } = await configKeyed("src/f12.js");
    expect(provider.calls).toEqual([["src/f12.js"]]);
    expect(outcomes(storeOf(tree), tree)["src/f12.js"]).toBe("fail");
    expect(pendingOthers(tree, "src/f12.js")).toEqual([]);
    expect(state.asked).toEqual(["running 1", "take"]);
    await pass.close();
  });

  it("an edited file a part left for the next pass stays an edit's there", async () => {
    const { tree, provider, pass, state } = await configKeyed(null);
    let open = () => {};
    provider.gate = new Promise((resolve) => {
      open = resolve;
    });
    // 17 edited files: one part holds 16, the 17th waits for the next pass.
    const edited = FILES.slice(0, 17);
    for (const path of edited) tree.write(path, "bad no-undef\n");
    tree.revise();
    pass.nudge();
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    // A nudge with no revision ends the pass after its part; the next one keys nothing.
    pass.nudge();
    provider.gate = null;
    state.asked.length = 0;
    open();
    await pass.idle();
    expect(provider.calls.map((c) => c.length)).toEqual([16, 1]);
    expect(state.asked).toEqual(["running 1", "take"]);
    const all = outcomes(storeOf(tree), tree);
    expect(edited.filter((p) => all[p] !== "fail")).toEqual([]);
    expect(FILES.slice(17).map((p) => all[p])).toEqual(["pending", "pending", "pending"]);
    await pass.close();
  });
});
