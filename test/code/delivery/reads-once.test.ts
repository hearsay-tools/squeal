import { beforeEach, describe, expect, it } from "vitest";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { registerCode, tellCode } from "../../../src/core/delivery/code-deliver.js";
import { type CodeSource, codeSource } from "../../../src/core/delivery/code-source.js";
import type { Consumer } from "../../../src/core/types/delivery.js";
import { WT } from "../../state/helpers.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, worktree } from "../pass/helpers.js";
import { writePolicy } from "./helpers.js";

/*
 * Row 015-127: a tool boundary's complexity news reads the failing states
 * and the edited states once in each transaction, and gives them to every
 * step there: the delta, the summary and the functions told over. A
 * boundary with nothing to write makes one read transaction; one with news
 * reads again in its write transaction, which may see other states.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };

let tree: FakeWorktree;
let store: CodeStore;
let source: CodeSource;
let clock: number;
let reads: string[];

/** `inner` with each `states.list` and `states.edits` call recorded in `reads`. */
function counting(inner: CodeSource): CodeSource {
  return {
    ...inner,
    open() {
      const access = inner.open();
      if (access === null || access === "missing") return access;
      const states = access.store.states;
      return {
        ...access,
        store: {
          ...access.store,
          states: {
            ...states,
            list(worktreeId, filter) {
              reads.push(`list ${filter?.measure ?? "*"} ${filter?.outcome ?? "*"}`);
              return states.list(worktreeId, filter);
            },
            edits(worktreeId, measure, paths) {
              reads.push(`edits ${measure}`);
              return states.edits(worktreeId, measure, paths);
            },
          },
        },
      };
    },
  };
}

beforeEach(async () => {
  const dir = commonDir();
  tree = worktree(WT, dir);
  store = open(dir);
  source = counting(codeSource(dir, tree.root));
  writePolicy(tree.root, { enabled: true });
  clock = 10_000;
  reads = [];
  await write("settle 23 B1\npay 3 B2\n");
});

async function write(text: string): Promise<void> {
  clock += 1_000;
  tree.write("src/a.ts", text).revise();
  await pass(tree, store, fakeCounter(), { now: () => clock });
}

/** A tool boundary with test news: changes and the functions told over; `reads` holds its reads. */
function boundary() {
  clock += 1_000;
  reads = [];
  return tellCode(source, C1, clock, () => ({ since: 1, gaps: [] }), { toldOver: true });
}

const ONCE = ["edits complexity", "list complexity fail"];
const sorted = () => [...reads].sort();

describe("a boundary's code reads (row 015-127)", () => {
  it("reads each set once with nothing to tell, and once per transaction with news", async () => {
    clock += 1_000;
    expect(registerCode(source, C1, clock)?.over).toBe(1);
    expect(boundary()).toBeNull();
    expect(sorted()).toEqual(ONCE);
    await write("settle 25 B9\npay 3 B2\n");
    // News: the read-only transaction, then the write transaction's own reads.
    expect(boundary()?.entries.map((e) => [e.check.qualifiedName, e.kind])).toEqual([
      ["settle", "edited"],
    ]);
    expect(sorted()).toEqual([ONCE[0], ONCE[0], ONCE[1], ONCE[1]]);
    // Told in full, so the told-over count reads the failing states: the step's read serves it.
    expect(boundary()).toBeNull();
    expect(sorted()).toEqual(ONCE);
  });
});
