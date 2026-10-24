import type { Counter, PassReport } from "../../../src/core/code/pass/index.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { dropCode } from "../../../src/core/delivery/code-deliver.js";
import { type CodeSource, codeSource } from "../../../src/core/delivery/code-source.js";
import {
  createDelivery,
  formatDelta,
  formatRegistration,
} from "../../../src/core/delivery/index.js";
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
  /**
   * One pass over the revisions stored since the last; `counter` a new one
   * makes a recount, and so does `policy`, the rig's complexity with these keys.
   */
  pass(counter?: Counter, policy?: Partial<Policy["complexity"]>): Promise<PassReport | null>;
  /** Writes these files, stores one revision of them, and runs the pass. */
  edit(files: Record<string, string>): Promise<PassReport | null>;
  /** As `edit`, with the files committed first, so the revision moves `HEAD` as a pull does (015-19). */
  pull(files: Record<string, string>): Promise<PassReport | null>;
  /** Registers `consumer` and gives its registration's text. */
  register(consumer: Consumer): Promise<string>;
  /** SessionEnd: unregisters `consumer` and drops its code views, as the hook's sweep does. */
  end(consumer: Consumer): Promise<void>;
  /** The code lines told to `consumer` at its next tool boundary; `[]` when nothing is. */
  told(consumer: Consumer): Promise<string[]>;
  /** Every line of the delivery to `consumer` at its next tool boundary; `[]` when nothing is told. */
  delivered(consumer: Consumer): Promise<string[]>;
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
    pass(counter = fakeCounter(), policy = {}) {
      const at = tick();
      return pass(tree, store, counter, {
        policy: policyOn({ ...over, ...policy }),
        retry,
        now: () => at,
      });
    },
    edit(files) {
      for (const [path, text] of Object.entries(files)) tree.write(path, text);
      tree.revise();
      return self.pass();
    },
    pull(files) {
      for (const [path, text] of Object.entries(files)) tree.write(path, text);
      tree.commit(...Object.keys(files));
      tree.revise();
      return self.pass();
    },
    async register(c) {
      tick();
      return formatRegistration(await delivery().register(c));
    },
    async end(c) {
      tick();
      await delivery().unregister(c);
      dropCode(source, [c], { worktrees: [c.worktreeId], registered: [] });
    },
    async told(c) {
      return (await self.delivered(c)).filter((line) => line.includes(" complexity: "));
    },
    async delivered(c) {
      tick();
      const delta = await delivery().onToolBoundary(c);
      return delta === null ? [] : formatDelta(delta).split("\n");
    },
  };
  return self;
}
