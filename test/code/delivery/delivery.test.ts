import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import type { CodeSource } from "../../../src/core/delivery/code-source.js";
import { codeSource } from "../../../src/core/delivery/code-source.js";
import {
  createDelivery,
  formatDelta,
  formatRegistration,
} from "../../../src/core/delivery/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import type { Consumer, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { check, freshStore, result, setKey, WT } from "../../state/helpers.js";
import { commonDir } from "../helpers.js";
import {
  type CodeRepo,
  codeRepo,
  codeState,
  codeTransition,
  fn,
  fnCheck,
  putFile,
  putRecount,
  TIERS,
  writePolicy,
} from "./helpers.js";

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const SELECT = fnCheck("selectTier");
const PLAN = fnCheck("planTier");

let main: Store;
let repo: CodeRepo;
let clock: number;

beforeEach(() => {
  main = freshStore();
  repo = codeRepo();
  clock = 10_000;
  setKey(main, "k1");
});

function delivery(source: CodeSource | undefined = repo.source) {
  return createDelivery(main, {
    status: fixedStatus(),
    now: () => clock,
    ...(source === undefined ? {} : { code: source }),
  });
}

/** `selectTier` at line 120 and `planTier` at line 40 of tiers.ts, counted at these CCs. */
function counted(select: number, plan = 5) {
  putFile(repo.store, WT, TIERS, [fn("planTier", plan, 40), fn("selectTier", select, 120)]);
  repo.store.states.upsertMany([codeState(WT, PLAN, plan), codeState(WT, SELECT, select)]);
}

/** The pass after an edit: `selectTier` is now `to`, with the transition it records. */
function edited(to: number, kind: Parameters<typeof codeTransition>[2], from: number | null) {
  clock += 1_000;
  counted(to);
  repo.store.transitions.append([codeTransition(WT, SELECT, kind, { from, to, at: clock })]);
}

describe("code delivery (015 D6, goals 3, 4 and 7)", () => {
  it("registers with the number over the threshold and the command, never the list (goal 4)", async () => {
    counted(23);
    const registration = await delivery().register(C1);
    expect(registration.code).toEqual({ v: 1, threshold: 20, over: 1 });
    const text = formatRegistration(registration);
    expect(text).toContain("\nComplexity: 1 function over 20; squeal code lists them.");
    expect(text).not.toContain("selectTier");
    // Goal 7: never in Known failures.
    expect(text).toContain("\nKnown failures: 0;");
    // The failing function is seeded told by count, the passing one not at all: nothing to deliver after.
    expect(repo.store.views.list(C1).map((v) => [v.check.qualifiedName, v.told])).toEqual([
      ["selectTier", "count"],
    ]);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });

  it("says the first count is running, from the files not counted yet", async () => {
    counted(23);
    repo.store.files.upsertMany(WT, [
      {
        path: "src/b.ts",
        blob: "b9",
        language: "typescript",
        counterVersion: 1,
        size: 9,
        revision: 1,
      },
    ]);
    const registration = await delivery().register(C1);
    expect(formatRegistration(registration)).toContain("\nComplexity: counting, 1 of 2 files.");
  });

  it.each([
    [
      "pass-to-fail",
      18,
      23,
      "FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23, over 20 (ESLint rule)",
    ],
    [
      "fail-to-pass",
      23,
      18,
      "PASS complexity: selectTier (src/core/scheduler/tiers.ts:120) is 18, at or under 20",
    ],
  ] as const)("delivers %s once, in the spec's line (goal 3)", async (kind, from, to, line) => {
    counted(from);
    await delivery().register(C1);
    edited(to, kind, from);
    const delta = await delivery().onToolBoundary(C1);
    expect(delta?.code?.entries.map((e) => e.kind)).toEqual([kind]);
    const text = formatDelta(delta ?? expect.fail("no delta"));
    expect(text.split("\n")).toContain(line);
    expect(text.startsWith("SQUEAL · 1 complexity change at revision")).toBe(true);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });

  it("delivers a new function over the threshold as a failure (D5)", async () => {
    counted(5);
    await delivery().register(C1);
    clock += 1_000;
    const fresh = fnCheck("rankTier");
    putFile(repo.store, WT, TIERS, [fn("planTier", 5, 40), fn("rankTier", 31, 200)]);
    repo.store.states.upsertMany([codeState(WT, fresh, 31)]);
    repo.store.transitions.append([
      codeTransition(WT, fresh, "first-seen-fail", { from: null, to: 31, at: clock }),
    ]);
    const text = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    expect(text).toContain(
      "FAIL complexity: rankTier (src/core/scheduler/tiers.ts:200) is 31, over 20",
    );
  });

  it("tells a removed failing function once, then forgets it (D2)", async () => {
    counted(23);
    await delivery().register(C1);
    clock += 1_000;
    repo.store.states.removeMany(WT, [SELECT]);
    repo.store.transitions.append([
      codeTransition(WT, SELECT, "removed", { from: 23, to: null, at: clock }),
    ]);
    const text = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    expect(text).toContain(
      "RESOLVED complexity: selectTier (src/core/scheduler/tiers.ts) is no longer in the code",
    );
    expect(repo.store.views.list(C1)).toEqual([]);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });

  it("is quiet while a function stays over and its count changes (D5)", async () => {
    counted(23);
    await delivery().register(C1);
    clock += 1_000;
    counted(31);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });

  it("writes a change no transition explains silently, by count", async () => {
    counted(18);
    await delivery().register(C1);
    clock += 1_000;
    counted(23);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
    const told = repo.store.views.list(C1).find((v) => v.check.qualifiedName === "selectTier");
    expect(told).toMatchObject({ outcome: "fail", told: "count" });
  });

  it("drops a crossing that returned before the next delivery", async () => {
    counted(18);
    await delivery().register(C1);
    edited(23, "pass-to-fail", 18);
    edited(18, "fail-to-pass", 23);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });

  it("tells at most 5 changes in full and the rest by number", async () => {
    const names = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"];
    putFile(
      repo.store,
      WT,
      TIERS,
      names.map((n, i) => fn(n, 5, i * 20 + 1)),
    );
    repo.store.states.upsertMany(names.map((n) => codeState(WT, fnCheck(n), 5)));
    await delivery().register(C1);
    clock += 1_000;
    putFile(
      repo.store,
      WT,
      TIERS,
      names.map((n, i) => fn(n, 25, i * 20 + 1)),
    );
    repo.store.states.upsertMany(names.map((n) => codeState(WT, fnCheck(n), 25)));
    repo.store.transitions.append(
      names.map((n) =>
        codeTransition(WT, fnCheck(n), "pass-to-fail", { from: 5, to: 25, at: clock }),
      ),
    );
    const delta = (await delivery().onToolBoundary(C1)) ?? expect.fail("no delta");
    const lines = formatDelta(delta).split("\n");
    expect(lines.filter((l) => l.startsWith("FAIL complexity:"))).toHaveLength(5);
    expect(lines).toContain("and 2 more complexity changes; squeal code --changed lists them.");
    expect(lines[0]).toBe("SQUEAL · 7 complexity changes at revision 0");
    const told = repo.store.views.list(C1).map((v) => [v.check.qualifiedName, v.told]);
    expect(told.filter(([, t]) => t === "full")).toHaveLength(5);
    expect(told.filter(([, t]) => t === "count")).toHaveLength(2);
  });

  it("lists every test failure before a code change", async () => {
    counted(18);
    await delivery().register(C1);
    edited(23, "pass-to-fail", 18);
    createStateSink(main, { now: () => clock }).applyResults(WT, 1, [result(check("a"), "fail")], {
      checkpointId: null,
    });
    const text = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    const test = text.indexOf("FAIL  src/a.test.ts > a");
    const code = text.indexOf("FAIL complexity:");
    expect(test).toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(test);
    expect(text.indexOf("Full output: squeal why")).toBeLessThan(code);
  });

  it("tells a recount in one line and seeds the view again by count (D6)", async () => {
    counted(18);
    await delivery().register(C1);
    clock += 1_000;
    repo.store.states.upsertMany([
      codeState(WT, PLAN, 5, { threshold: 4 }),
      codeState(WT, SELECT, 18, { threshold: 4 }),
    ]);
    putRecount(repo.store, WT, { revision: 3, at: clock, reason: "threshold", threshold: 4 });
    const delta = (await delivery().onToolBoundary(C1)) ?? expect.fail("no delta");
    expect(formatDelta(delta).split("\n")).toContain(
      "Complexity threshold is now 4: 2 functions over; squeal code lists them.",
    );
    expect(delta.code?.entries).toEqual([]);
    expect(repo.store.views.list(C1).every((v) => v.told === "count" && v.threshold === 4)).toBe(
      true,
    );
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });

  it("holds code news at a Stop with nothing else to say, so Stop is not kept going (D7)", async () => {
    counted(18);
    await delivery().register(C1);
    edited(23, "pass-to-fail", 18);
    expect(await delivery().onToolBoundary(C1, { stop: true })).toBeNull();
    expect((await delivery().onToolBoundary(C1))?.code?.entries).toHaveLength(1);
  });

  it("never denies: a peek for regressions carries no code (D7)", async () => {
    counted(18);
    await delivery().register(C1);
    edited(23, "pass-to-fail", 18);
    expect(await delivery().peek(C1, { kinds: ["pass-to-fail", "first-seen-fail"] })).toBeNull();
    expect((await delivery().onToolBoundary(C1))?.code?.entries).toHaveLength(1);
  });

  it("tells a file too big to count once, after an edit changed it (D6)", async () => {
    counted(18);
    await delivery().register(C1);
    // The pass marks the file too big (015-06's `tooBig`), at a revision after the registration.
    repo.store.files.upsertMany(WT, [
      {
        path: "src/big.ts",
        blob: "big",
        language: "typescript",
        counterVersion: 1,
        size: 614_400,
        revision: 2,
      },
    ]);
    const source = tooBigSource(repo.source, "src/big.ts");
    const delta = (await delivery(source).onToolBoundary(C1)) ?? expect.fail("no delta");
    expect(formatDelta(delta).split("\n")).toContain(
      "src/big.ts is 600 KiB, over the 512 KiB limit; its functions are not counted.",
    );
    expect(await delivery(source).onToolBoundary(C1)).toBeNull();
  });
});

describe("a busy code store (015 D4, 011 C7)", () => {
  it("costs the delivery its code part, never an error, and the change arrives later", async () => {
    counted(18);
    await delivery().register(C1);
    edited(23, "pass-to-fail", 18);
    // The daemon's pass holds the write lock.
    const writer = new DatabaseSync(codeStorePath(repo.dir));
    writer.exec("PRAGMA busy_timeout = 0");
    writer.exec("BEGIN IMMEDIATE");
    const hook = delivery(codeSource(repo.dir, repo.root, { busyTimeoutMs: 20 }));
    expect(await hook.onToolBoundary(C1)).toBeNull();
    writer.exec("COMMIT");
    writer.close();
    expect((await hook.onToolBoundary(C1))?.code?.entries).toHaveLength(1);
  });
});

describe("with the policy off (015 goal 1)", () => {
  /** One scenario of test news, delivered by `deliver`. */
  async function scenario(deliver: ReturnType<typeof delivery>) {
    const sink = createStateSink(main, { now: () => clock });
    sink.applyResults(WT, 1, [result(check("a"), "pass")], { checkpointId: null });
    const registration = await deliver.register(C1);
    sink.applyResults(WT, 2, [result(check("a"), "fail")], { checkpointId: null });
    const delta = await deliver.onToolBoundary(C1);
    return {
      registration,
      delta,
      texts: [
        formatRegistration(registration, undefined, "squeal", 0),
        formatDelta(delta ?? expect.fail("no delta")),
      ],
    };
  }

  it("delivers and registers byte-identically, and makes no code store", async () => {
    const dir = commonDir();
    const off = codeSource(dir, repo.root);
    writePolicy(repo.root, { enabled: false });
    const withOff = await scenario(delivery(off));
    main = freshStore();
    setKey(main, "k1");
    const without = await scenario(delivery(undefined));
    expect(withOff).toEqual(without);
    expect("code" in withOff.registration).toBe(false);
    expect(withOff.delta === null ? false : "code" in withOff.delta).toBe(false);
    expect(existsSync(codeStorePath(dir))).toBe(false);
  });

  it("delivers nothing of the code while the store has rows and the policy is off", async () => {
    counted(23);
    writePolicy(repo.root, { enabled: false });
    expect("code" in (await delivery().register(C1))).toBe(false);
    edited(18, "fail-to-pass", 23);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
  });
});

/** `source` with `path` marked too big, as 015-06's pass marks it. */
function tooBigSource(source: CodeSource, path: string): CodeSource {
  return {
    policy: () => source.policy(),
    open() {
      const access = source.open();
      if (access === null || access === "missing") return access;
      const { store } = access;
      const files = {
        ...store.files,
        list: (...args: Parameters<typeof store.files.list>) =>
          store.files.list(...args).map((f) => (f.path === path ? { ...f, tooBig: true } : f)),
      };
      return { ...access, store: { ...store, files } };
    },
  };
}
