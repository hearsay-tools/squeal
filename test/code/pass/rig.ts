import type { PassReport } from "../../../src/core/code/pass/index.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { type CodeSource, codeSource } from "../../../src/core/delivery/code-source.js";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import type { Consumer, Policy, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, setKey, WT } from "../../state/helpers.js";
import { writePolicy } from "../delivery/helpers.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, policyOn, worktree } from "./helpers.js";

/**
 * The daemon's pass over a fake counter and the delivery that reads its
 * code store as a hook does, on one clock that each step moves.
 */
export interface Rig {
  readonly dir: string;
  readonly tree: FakeWorktree;
  readonly store: CodeStore;
  readonly main: Store;
  readonly source: CodeSource;
  readonly complexity: Policy["complexity"];
  /** Paths to read again, shared by every pass as the daemon's. */
  readonly retry: Set<string>;
  /** One pass over the revisions stored since the last. */
  pass(): Promise<PassReport | null>;
  /** Writes these files, stores one revision of them, and runs the pass. */
  edit(files: Record<string, string>): Promise<PassReport | null>;
  register(consumer: Consumer): Promise<void>;
  /** The code lines told to `consumer` at its next tool boundary; `[]` when nothing is. */
  told(consumer: Consumer): Promise<string[]>;
}

export const consumer = (sessionId: string): Consumer => ({
  worktreeId: WT,
  sessionId,
  agentId: "main",
});

export function rig(over: Partial<Policy["complexity"]> = {}): Rig {
  const dir = commonDir();
  const main = freshStore();
  setKey(main, "k1");
  const tree = worktree(WT, dir);
  const store = open(dir);
  const source = codeSource(dir, tree.root);
  const { complexity } = policyOn(over);
  writePolicy(tree.root, { ...over, enabled: true });
  const retry = new Set<string>();
  let clock = 10_000;
  const tick = () => {
    clock += 1_000;
    return clock;
  };
  const delivery = () =>
    createDelivery(main, { status: fixedStatus(), now: () => clock, code: source });
  const self: Rig = {
    dir,
    tree,
    store,
    main,
    source,
    complexity,
    retry,
    pass() {
      const at = tick();
      return pass(tree, store, fakeCounter(), { policy: policyOn(over), retry, now: () => at });
    },
    edit(files) {
      for (const [path, text] of Object.entries(files)) tree.write(path, text);
      tree.revise();
      return self.pass();
    },
    async register(c) {
      tick();
      await delivery().register(c);
    },
    async told(c) {
      tick();
      const delta = await delivery().onToolBoundary(c);
      if (delta === null) return [];
      return formatDelta(delta)
        .split("\n")
        .filter((line) => line.includes(" complexity: "));
    },
  };
  return self;
}
