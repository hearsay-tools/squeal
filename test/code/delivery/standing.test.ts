import { beforeEach, describe, expect, it } from "vitest";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { type CodeSource, codeSource } from "../../../src/core/delivery/code-source.js";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import type { Consumer, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, setKey, WT } from "../../state/helpers.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, worktree } from "../pass/helpers.js";
import {
  codeRepo,
  codeState,
  codeTransition,
  fn,
  fnCheck,
  putFile,
  TIERS,
  writePolicy,
} from "./helpers.js";

/*
 * Spec 015 D6, its last rule (goal 5): the daemon's pass (015-06) over a
 * fake counter, read by the delivery as a hook reads it.
 */

const consumer = (sessionId: string): Consumer => ({ worktreeId: WT, sessionId, agentId: "main" });
const C1 = consumer("s1");
const C2 = consumer("s2");
/** 015-21: every STILL FAIL line ends so, so the agent knows the next line comes at a flip. */
const quiet = (path: string) =>
  `Squeal stays quiet about it until it is at or under 20, and squeal code ${path} shows its count.`;
const SETTLE = `STILL FAIL complexity: settle (src/a.ts:1) is 25 after the edit; it was already over 20 before it (ESLint rule); ${quiet("src/a.ts")}`;
/** The STILL FAIL after a FAIL told in this session (015-21, lessons round 1 P3). */
const payStill = (cc: number) =>
  `STILL FAIL complexity: pay (src/a.ts:2) is ${cc} after the edit, over 20 (ESLint rule); ${quiet("src/a.ts")}`;
const payFail = (cc: number) => `FAIL complexity: pay (src/a.ts:2) is ${cc}, over 20 (ESLint rule)`;
const payPass = (cc: number) => `PASS complexity: pay (src/a.ts:2) is ${cc}, at or under 20`;

let main: Store;
let tree: FakeWorktree;
let store: CodeStore;
let source: CodeSource;
let clock: number;

beforeEach(async () => {
  const dir = commonDir();
  main = freshStore();
  setKey(main, "k1");
  tree = worktree(WT, dir);
  store = open(dir);
  source = codeSource(dir, tree.root);
  writePolicy(tree.root, { enabled: true });
  clock = 10_000;
  await write("settle 23 B1\npay 3 B2\n");
});

/** `src/a.ts` with this text, as the daemon's pass after the edit counts it. */
async function write(text: string): Promise<void> {
  clock += 1_000;
  tree.write("src/a.ts", text).revise();
  await pass(tree, store, fakeCounter(), { now: () => clock });
}

/** A hook whose clock reads `now`: by default the test's clock. */
function delivery(now = () => clock) {
  return createDelivery(main, { status: fixedStatus(), now, code: source });
}

async function register(c: Consumer): Promise<void> {
  clock += 1_000;
  await delivery().register(c);
}

/** The code lines told to `c` at its next tool boundary; `[]` when nothing is. */
async function told(c: Consumer): Promise<string[]> {
  clock += 1_000;
  const delta = await delivery().onToolBoundary(c);
  if (delta === null) return [];
  return formatDelta(delta)
    .split("\n")
    .filter((line) => line.includes(" complexity: "));
}

describe("the first edit to a standing failure (015 D6, goal 5)", () => {
  it("tells the first edit that leaves the function over once, in full, as no new failure", async () => {
    await register(C1);
    await write("settle 25 B9\npay 3 B2\n");
    clock += 1_000;
    const delta = (await delivery().onToolBoundary(C1)) ?? expect.fail("no delta");
    expect(delta.code?.entries).toEqual([
      {
        check: fnCheck("settle", "src/a.ts"),
        measure: "complexity",
        kind: "edited",
        value: 25,
        threshold: 20,
        line: 1,
        revision: 2,
      },
    ]);
    const lines = formatDelta(delta).split("\n");
    expect(lines).toContain(SETTLE);
    expect(lines.filter((l) => l.startsWith("FAIL "))).toEqual([]);
    expect(store.views.list(C1).find((v) => v.check.qualifiedName === "settle")?.told).toBe(
      "still",
    );
  });

  it("is quiet at the second edit in the same session", async () => {
    await register(C1);
    await write("settle 25 B9\npay 3 B2\n");
    expect(await told(C1)).toEqual([SETTLE]);
    await write("settle 27 B8\npay 3 B2\n");
    expect(await told(C1)).toEqual([]);
  });

  it("gives another session its own one line", async () => {
    await register(C1);
    await write("settle 25 B9\npay 3 B2\n");
    expect(await told(C1)).toEqual([SETTLE]);
    await register(C2);
    // An edit before C2 registered is not C2's to hear.
    expect(await told(C2)).toEqual([]);
    await write("settle 25 B7\npay 3 B2\n");
    expect(await told(C2)).toEqual([SETTLE]);
    expect(await told(C1)).toEqual([]);
  });

  it("tells nothing of a move with the same body, and the moved function's first edit once", async () => {
    await register(C1);
    clock += 1_000;
    tree.write("src/a.ts", "pay 3 B2\n").write("src/b.ts", "settle 23 B1\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => clock });
    expect(await told(C1)).toEqual([]);
    clock += 1_000;
    tree.write("src/b.ts", "settle 25 B9\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => clock });
    expect(await told(C1)).toEqual([SETTLE.replaceAll("src/a.ts", "src/b.ts")]);
  });
});

describe("a failed fix attempt (015-21, lessons round 1 P3)", () => {
  it("tells the first edit after a FAIL that leaves the function over once, then PASS", async () => {
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    expect(await told(C1)).toEqual([payFail(23)]);
    await write("settle 23 B1\npay 22 B4\n");
    clock += 1_000;
    const still = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    // Not a change of state, so the title counts it as a function still over.
    const [title, ...rest] = still.split("\n");
    expect(title).toMatch(
      /^SQUEAL · 1 function still over the complexity threshold at revision \d+$/,
    );
    expect(rest.filter((l) => l.includes(" complexity: "))).toEqual([payStill(22)]);
    await write("settle 23 B1\npay 21 B5\n");
    expect(await told(C1)).toEqual([]);
    await write("settle 23 B1\npay 20 B6\n");
    expect(await told(C1)).toEqual([payPass(20)]);
  });

  it("tells one again once the function has passed and failed again", async () => {
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    await write("settle 23 B1\npay 22 B4\n");
    expect(await told(C1)).toEqual([payFail(22)]);
    await write("settle 23 B1\npay 21 B5\n");
    expect(await told(C1)).toEqual([payStill(21)]);
    await write("settle 23 B1\npay 4 B6\n");
    expect(await told(C1)).toEqual([payPass(4)]);
    await write("settle 23 B1\npay 24 B7\n");
    expect(await told(C1)).toEqual([payFail(24)]);
    await write("settle 23 B1\npay 22 B8\n");
    expect(await told(C1)).toEqual([payStill(22)]);
  });

  it("is each session's own", async () => {
    await register(C1);
    await register(C2);
    await write("settle 23 B1\npay 23 B3\n");
    expect(await told(C1)).toEqual([payFail(23)]);
    await write("settle 23 B1\npay 22 B4\n");
    expect(await told(C1)).toEqual([payStill(22)]);
    // C2 hears the failure as it is now, and the edit before it is not news to C2.
    expect(await told(C2)).toEqual([payFail(22)]);
    await write("settle 23 B1\npay 21 B5\n");
    expect(await told(C2)).toEqual([payStill(21)]);
    expect(await told(C1)).toEqual([]);
  });

  it("tells no STILL FAIL for the edit a FAIL told, when the pass counted it after the hook's clock", async () => {
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    // The hook read its clock before the pass committed: its time is before the pass's.
    const early = (await delivery(() => clock - 500).onToolBoundary(C1)) ?? expect.fail("no delta");
    expect(formatDelta(early)).toContain(payFail(23));
    expect(await told(C1)).toEqual([]);
    await write("settle 23 B1\npay 22 B4\n");
    expect(await told(C1)).toEqual([payStill(22)]);
  });
});

describe("the first edit to a standing failure past the 5-line limit (D6)", () => {
  it("stays out of the number and is told at the function's next edit", async () => {
    const repo = codeRepo();
    const names = ["f1", "f2", "f3", "f4", "f5"];
    const at = (n: number) => () => n;
    putFile(repo.store, WT, TIERS, [
      ...names.map((n, i) => fn(n, 5, i * 20 + 1)),
      fn("g", 30, 200),
    ]);
    repo.store.states.upsertMany([
      ...names.map((n) => codeState(WT, fnCheck(n), 5)),
      codeState(WT, fnCheck("g"), 30),
    ]);
    const hook = (now: number) =>
      createDelivery(main, { status: fixedStatus(), now: at(now), code: repo.source });
    await hook(1_000).register(C1);
    putFile(repo.store, WT, TIERS, [
      ...names.map((n, i) => fn(n, 25, i * 20 + 1)),
      fn("g", 31, 200),
    ]);
    repo.store.states.upsertMany([
      ...names.map((n) => codeState(WT, fnCheck(n), 25, { revision: 2 })),
      codeState(WT, fnCheck("g"), 31, { revision: 2 }),
    ]);
    repo.store.transitions.append(
      names.map((n) =>
        codeTransition(WT, fnCheck(n), "pass-to-fail", { from: 5, to: 25, at: 2_000 }),
      ),
    );
    repo.store.states.markEdited(WT, [
      { check: fnCheck("g"), measure: "complexity", revision: 2, at: 2_000 },
    ]);
    const lines = formatDelta((await hook(3_000).onToolBoundary(C1)) ?? expect.fail("no delta"));
    expect(lines.split("\n").filter((l) => l.startsWith("FAIL complexity:"))).toHaveLength(5);
    expect(lines).not.toContain("STILL FAIL");
    expect(lines).not.toContain("more complexity");
    repo.store.states.markEdited(WT, [
      { check: fnCheck("g"), measure: "complexity", revision: 3, at: 4_000 },
    ]);
    const next = (await hook(5_000).onToolBoundary(C1))?.code?.entries ?? [];
    expect(next.map((e) => [e.check.qualifiedName, e.kind])).toEqual([["g", "edited"]]);
  });
});
