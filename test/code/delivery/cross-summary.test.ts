import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { type CodeSource, codeSource } from "../../../src/core/delivery/code-source.js";
import {
  createDelivery,
  formatDelta,
  formatRegistration,
  MESSAGE_CAP_CHARS,
} from "../../../src/core/delivery/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import type { Consumer, Delta, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { check, freshStore, result, setKey, WT } from "../../state/helpers.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, worktree } from "../pass/helpers.js";
import { writePolicy } from "./helpers.js";

/*
 * Row 015-27 (the human, 2026-10-24): a delivery with news of one kind ends
 * with at most one line about the other kind, only while that kind has
 * something standing for the session. The daemon's pass over a fake
 * counter, and test results through the state sink, as a hook reads them.
 */

const consumer = (sessionId: string): Consumer => ({ worktreeId: WT, sessionId, agentId: "main" });
const C1 = consumer("s1");
const C2 = consumer("s2");
const A = check("a");
const B = check("b");
const C = check("c");

/** Test news's last line while functions told in full are still over. */
const toldLine = (n: number) =>
  `Complexity: ${n} ${n === 1 ? "function" : "functions"} over 20 that this session was told about; squeal code --told lists them.`;
/** Complexity news's last line while tests have known failures. */
const testsLine = (n: number) =>
  `Tests: ${n} known ${n === 1 ? "failure" : "failures"}; squeal status lists them.`;

let main: Store;
let sink: ReturnType<typeof createStateSink>;
let tree: FakeWorktree;
let dir: string;
let store: CodeStore;
let source: CodeSource;
let clock: number;
let run: number;

beforeEach(async () => {
  dir = commonDir();
  main = freshStore();
  setKey(main, "k1");
  sink = createStateSink(main, { now: () => clock });
  tree = worktree(WT, dir);
  store = open(dir);
  source = codeSource(dir, tree.root);
  writePolicy(tree.root, { enabled: true });
  clock = 10_000;
  run = 0;
  // `settle` is over at the session's start: told by count, never in full.
  await write("settle 23 B1\npay 3 B2\n");
});

/** `src/a.ts` with this text, as the daemon's pass after the edit counts it. */
async function write(text: string): Promise<void> {
  clock += 1_000;
  tree.write("src/a.ts", text).revise();
  await pass(tree, store, fakeCounter(), { now: () => clock });
}

/** Test results of one run, as the scheduler stores them. */
function tests(...results: [typeof A, "pass" | "fail"][]): void {
  run += 1;
  sink.applyResults(
    WT,
    run,
    results.map(([c, outcome]) => result(c, outcome)),
    { checkpointId: null },
  );
}

function delivery(code: CodeSource | undefined = source) {
  return createDelivery(main, {
    status: fixedStatus(),
    now: () => clock,
    ...(code === undefined ? {} : { code }),
  });
}

async function register(c: Consumer): Promise<void> {
  clock += 1_000;
  await delivery().register(c);
}

/** The delta `c` gets at its next tool boundary. */
async function boundary(c: Consumer): Promise<Delta> {
  clock += 1_000;
  return (await delivery().onToolBoundary(c)) ?? expect.fail("no delta");
}

/** The last line of the text `c` gets at its next tool boundary. */
async function lastLine(c: Consumer): Promise<string> {
  return (
    formatDelta(await boundary(c))
      .split("\n")
      .at(-1) ?? ""
  );
}

describe("test news ends with the functions told about still over (row 015-27)", () => {
  it("ends a recovery with the line while a told FAIL is over, and not once it passes", async () => {
    tests([A, "fail"]);
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    await boundary(C1);
    tests([A, "pass"]);
    const text = formatDelta(await boundary(C1));
    expect(text).toContain("PASS  src/a.test.ts > a");
    // `settle` was over at the start and never told in full: it stays out.
    expect(text.endsWith(`\n\n${toldLine(1)}`)).toBe(true);
    await write("settle 23 B1\npay 18 B4\n");
    await boundary(C1);
    tests([A, "fail"]);
    expect(await lastLine(C1)).not.toContain("Complexity:");
  });

  it("adds nothing while only functions over since the start stand", async () => {
    tests([A, "fail"]);
    await register(C1);
    tests([A, "pass"]);
    expect(formatDelta(await boundary(C1))).not.toContain("Complexity:");
  });

  it("counts a STILL FAIL as told", async () => {
    await register(C1);
    await write("settle 25 B9\npay 3 B2\n");
    await boundary(C1);
    tests([A, "fail"]);
    expect(await lastLine(C1)).toBe(toldLine(1));
  });

  it("counts the FAIL told in the same delivery, after its code lines", async () => {
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    await write("settle 25 B9\npay 23 B3\n");
    tests([A, "fail"]);
    const text = formatDelta(await boundary(C1));
    expect(text).toContain("\nFAIL complexity: pay (src/a.ts:2) is 23, over 20 (ESLint rule)");
    expect(text.endsWith(`\n\n${toldLine(2)}`)).toBe(true);
    expect(text).not.toContain("Tests:");
  });

  it("leaves out what another session was told", async () => {
    await register(C1);
    await register(C2);
    await write("settle 23 B1\npay 23 B3\n");
    await boundary(C1);
    tests([A, "fail"]);
    expect(await lastLine(C1)).toBe(toldLine(1));
    const forC2 = formatDelta(await boundary(C2));
    expect(forC2).toContain("FAIL complexity: pay");
    tests([A, "pass"]);
    expect(await lastLine(C2)).toBe(toldLine(1));
    await write("settle 23 B1\npay 18 B4\n");
    await boundary(C2);
    tests([A, "fail"]);
    expect(await lastLine(C2)).not.toContain("Complexity:");
  });

  it("ends a waiter's recovery with the line too", async () => {
    tests([A, "fail"]);
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    await boundary(C1);
    setKey(main, "k1", { pending: "queued" });
    await delivery().endTurn(C1);
    tests([A, "pass"]);
    setKey(main, "k1");
    const delta = await delivery().waitForDelta(C1, { timeoutMs: 40 });
    const text = formatDelta(delta ?? expect.fail("no delta"));
    expect(text).toContain("PASS  src/a.test.ts > a");
    expect(text.endsWith(`\n\n${toldLine(1)}`)).toBe(true);
  });
});

describe("complexity news ends with the known test failures (row 015-27)", () => {
  it("ends with the test line while tests fail, and not with none", async () => {
    tests([A, "fail"], [B, "fail"], [C, "fail"]);
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    const text = formatDelta(await boundary(C1));
    expect(text.startsWith("SQUEAL · 1 complexity change at revision")).toBe(true);
    expect(text.endsWith(`(ESLint rule)\n\n${testsLine(3)}`)).toBe(true);
    tests([A, "pass"], [B, "pass"], [C, "pass"]);
    await boundary(C1);
    await write("settle 23 B1\npay 18 B4\n");
    const after = formatDelta(await boundary(C1));
    expect(after).toContain("PASS complexity: pay");
    expect(after).not.toContain("Tests:");
  });

  it("counts the failures status counts: a failure pending a rerun is not one", async () => {
    tests([A, "fail"]);
    await register(C1);
    setKey(main, "k2", { pending: "queued" });
    sink.refresh(WT, run, { checkpointId: null });
    expect(main.knownStates.list(WT).map((s) => [s.outcome, s.validity])).toEqual([
      ["fail", "pending"],
    ]);
    await write("settle 23 B1\npay 23 B3\n");
    expect(formatDelta(await boundary(C1))).not.toContain("Tests:");
  });

  it("leaves the test line out of Stop's full form, which ends with Known failures", async () => {
    tests([A, "fail"]);
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    const delta = await boundary(C1);
    expect(formatDelta(delta)).toContain(testsLine(1));
    expect(formatDelta(delta, "squeal", MESSAGE_CAP_CHARS, "full")).not.toContain("Tests:");
  });
});

describe("what adds no line (row 015-27)", () => {
  it("leaves the registration as it was: it already gives both", async () => {
    tests([A, "fail"]);
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    await boundary(C1);
    const text = formatRegistration(await delivery().register(consumer("s3")));
    expect(text).toContain("\nComplexity: 2 functions over 20; squeal code lists them.");
    expect(text).not.toContain("told about");
    expect(text).not.toContain("Tests:");
  });

  it("delivers nothing when neither kind has news", async () => {
    tests([A, "fail"]);
    await register(C1);
    await write("settle 23 B1\npay 23 B3\n");
    await boundary(C1);
    clock += 1_000;
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });
});

describe("with the policy off (row 015-27, 015 goal 1)", () => {
  /** A failure and its recovery, each at a tool boundary, then one through the waiter. */
  async function scenario(code: CodeSource | undefined) {
    main = freshStore();
    setKey(main, "k1");
    sink = createStateSink(main, { now: () => clock });
    run = 0;
    clock = 50_000;
    const deliver = delivery(code);
    tests([A, "fail"]);
    const registration = await deliver.register(C1);
    tests([A, "pass"], [B, "fail"]);
    const recovered = await deliver.onToolBoundary(C1);
    setKey(main, "k1", { pending: "queued" });
    await deliver.endTurn(C1);
    tests([B, "pass"]);
    setKey(main, "k1");
    const waited = await deliver.waitForDelta(C1, { timeoutMs: 40 });
    const deltas = [recovered, waited].map((d) => d ?? expect.fail("no delta"));
    return {
      registration: formatRegistration(registration, undefined, "squeal", 0),
      deltas,
      texts: deltas.map((d) => formatDelta(d)),
    };
  }

  it("delivers byte-identically, at a boundary and through the waiter, and opens no code store", async () => {
    const bare = commonDir();
    const off = codeSource(bare, tree.root);
    writePolicy(tree.root, { enabled: false });
    const withOff = await scenario(off);
    const without = await scenario(undefined);
    expect(withOff).toEqual(without);
    for (const delta of withOff.deltas) {
      expect("code" in delta).toBe(false);
      expect("knownFailures" in delta).toBe(false);
    }
    expect(existsSync(codeStorePath(bare))).toBe(false);
  });
});
