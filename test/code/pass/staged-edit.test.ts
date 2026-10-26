import { DatabaseSync } from "node:sqlite";
import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { stagedId } from "../../../src/core/code/store/index.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import type { CodeKnownState } from "../../../src/core/types/code.js";
import { check, open } from "../helpers.js";
import { fakeCounter, pass, policyOn, worktree } from "./helpers.js";

/*
 * Row 015-55: an edit pass over more than one part reads, judges and stages
 * in parts, its moves matched over every file first, and one transaction
 * switches to it. Its states, transitions, edits, views and meta equal the
 * one-transaction pass's.
 */

const POLICY = policyOn({ maxFileBytes: 200 });
const SESSION = { worktreeId: "w1", sessionId: "s1", agentId: "main" };

/** Before: each file's text. `ren`, `mover`, `gone` and the two `dup` fail. */
const BEFORE: Record<string, string> = {
  "src/a.ts": "keep 3 A1\nren 25 A2\n",
  "src/b.ts": "mover 30 B1\nstay 2 B2\n",
  "src/c.ts": "c1 4 C1\n",
  "src/d.ts": "edit 10 D1\nflip 25 D2\n",
  "src/e.ts": "gone 30 E1\nlive 3 E2\n",
  "src/f.ts": "x 40 F1\n",
  "src/h.ts": "dup 26 SAME\n",
  "src/i.ts": "dup 26 SAME\n",
  "src/k.ts": "k 30 K1\n",
  "src/l.ts": "pulled 5 L1\n",
  "src/n.ts": "n 30 N1\n",
};

/**
 * After: `ren` renamed in its file and `mover` moved to another, both with
 * their bodies; `edit` crosses over and `flip` under, with new bodies;
 * `gone` and `src/f.ts` go; a new file with a first-seen failure; one
 * `dup` taken by a new file, by body; `src/k.ts` over `maxFileBytes`;
 * `src/l.ts` crosses over in a commit, so no edit is marked there.
 */
const AFTER: Record<string, string | null> = {
  "src/a.ts": "keep 3 A1\nrenamed 25 A2\n",
  "src/b.ts": "stay 2 B2\n",
  "src/c.ts": "c1 4 C1\nmoved 30 B1\n",
  "src/d.ts": "edit 21 D3\nflip 4 D4\n",
  "src/e.ts": "live 3 E2\n",
  "src/f.ts": null,
  "src/g.ts": "newf 22 G1\n",
  "src/h.ts": null,
  "src/i.ts": null,
  "src/j.ts": "taken 26 SAME\n",
  "src/k.ts": `k 30 K1\n${"// padding\n".repeat(20)}`,
  "src/l.ts": "pulled 24 L2\n",
};

/**
 * A worktree through `BEFORE`, D9's failures and a view; then `AFTER`, one
 * pass due. A runner lists `src/n.ts` now, so it leaves quietly, and
 * `src/m.ts` is a symlink. With `held`, `src/o.ts` is new and its revision
 * is not listed yet: it waits, and the removals wait with it (row 015-52).
 */
async function scenario({ held = false } = {}) {
  const tree = worktree("w1");
  const store = open(tree.commonDir);
  for (const [path, text] of Object.entries(BEFORE)) tree.write(path, text);
  tree.commit();
  tree.revise();
  await pass(tree, store, fakeCounter(), { policy: POLICY });
  const coverage = (path: string, name: string, measure: "crap" | "uncovered") => ({
    ...(store.states
      .list("w1", { paths: [path] })
      .find((s) => s.check.qualifiedName === name) as CodeKnownState),
    measure,
    value: measure === "crap" ? 900 : null,
  });
  store.states.upsertMany([
    coverage("src/b.ts", "mover", "crap"),
    coverage("src/e.ts", "gone", "crap"),
    coverage("src/f.ts", "x", "uncovered"),
  ]);
  store.views.writeMany(SESSION, [
    {
      check: { ...check("mover"), path: "src/b.ts" },
      measure: "complexity",
      outcome: "fail",
      threshold: 20,
      told: "full",
      toldAt: 500,
    },
  ]);
  for (const [path, text] of Object.entries(AFTER)) {
    if (text === null) tree.remove(path);
    else tree.write(path, text);
  }
  tree.link("src/m.ts", "c.ts");
  tree.testFiles.push("src/n.ts");
  if (held) {
    tree.write("src/o.ts", "o 30 O1\n");
    tree.listed = tree.source.latestRevision();
  }
  tree.commit("src/l.ts");
  tree.revise();
  return { tree, store };
}

/** Every row of the code store a hook reads, ids left out, transitions in id order. */
function dump(store: CodeStore) {
  const db = new DatabaseSync(store.path, { readOnly: true });
  const rows = (sql: string) => db.prepare(sql).all();
  const check = "c.path, c.qualified_name, c.occurrence";
  const out = {
    states: rows(`SELECT s.worktree_id, ${check}, s.measure, s.outcome, s.value, s.threshold,
      s.counted_at, s.blob, s.changed_at, s.edited_revision, s.edited_at
      FROM states s JOIN checks c ON c.id = s.check_id ORDER BY 1, 2, 3, 4, 5`),
    transitions: rows(`SELECT t.worktree_id, ${check}, t.measure, t.kind, t.from_outcome,
      t.to_outcome, t.from_value, t.to_value, t.threshold, t.revision, t.at
      FROM transitions t JOIN checks c ON c.id = t.check_id ORDER BY t.id`),
    views: rows(`SELECT v.worktree_id, v.session_id, ${check}, v.measure, v.outcome, v.told
      FROM views v JOIN checks c ON c.id = v.check_id ORDER BY 1, 2, 3, 4, 5`),
    meta: rows("SELECT key, value FROM meta ORDER BY key"),
    files: rows("SELECT * FROM files ORDER BY worktree_id, path"),
  };
  db.close();
  return out;
}

/** `dump` with the clock's times left out: a ticking clock reads them at other points. */
const timeless = (store: CodeStore) => {
  const { states, transitions, ...rest } = dump(store);
  return {
    states: states.map((s) => ({ ...s, edited_at: s.edited_at === null ? null : "t" })),
    transitions: transitions.map((t) => ({ ...t, at: "t" })),
    ...rest,
  };
};

/** What a hook of the worktree reads of the pass: its states, transitions and views. */
const read = (store: CodeStore) => {
  const own = (rows: readonly Record<string, unknown>[]) =>
    rows.filter((r) => r.worktree_id === "w1");
  const { states, transitions, views } = timeless(store);
  return JSON.stringify({ states: own(states), transitions: own(transitions), views });
};

/** A clock each read moves 10 ms, so each part spends its budget at once. */
const ticking = () => {
  let clock = 1_000;
  return () => (clock += 10);
};

/** The pass in parts of 2 files, with a hook reading on each turn until it ends; what it read. */
async function watched(
  tree: ReturnType<typeof worktree>,
  store: CodeStore,
  onTurn: (hook: CodeStore) => void = () => {},
) {
  const hook = open(tree.commonDir);
  let over = false;
  const run = pass(tree, store, fakeCounter(), {
    policy: POLICY,
    partFiles: 2,
    now: ticking(),
  }).finally(() => {
    over = true;
  });
  const seen: { read: string; staged: number }[] = [];
  while (!over) {
    seen.push(
      hook.read(() => ({ read: read(hook), staged: hook.states.list(stagedId("w1")).length })),
    );
    onTurn(hook);
    await nextTurn();
  }
  return { report: await run, seen };
}

/** The one-transaction pass's result, and the store before it. */
async function expected() {
  const { tree, store } = await scenario();
  const old = read(store);
  await pass(tree, store, fakeCounter(), { policy: POLICY, now: ticking() });
  return { old, now: read(store), dump: timeless(store) };
}

/** The scenario's pass in one transaction and in parts of 2 files: its report and rows, each way. */
async function bothWays(options: { held?: boolean } = {}) {
  const run = async (partFiles?: number) => {
    const { tree, store } = await scenario(options);
    const adopt = vi.spyOn(store.transitions, "adopt");
    const report = await pass(tree, store, fakeCounter(), {
      policy: POLICY,
      ...(partFiles === undefined ? {} : { partFiles }),
    });
    expect(adopt).toHaveBeenCalledTimes(partFiles === undefined ? 0 : 1);
    return { report, rows: dump(store) };
  };
  const whole = await run();
  const parted = await run(2);
  expect(parted.rows.states.filter((s) => s.worktree_id !== "w1")).toEqual([]);
  return { whole, parted };
}

describe("an edit pass in parts (row 015-55)", () => {
  it("writes what the one-transaction pass writes: states, transitions, edits, views and meta", async () => {
    const { whole, parted } = await bothWays();
    expect(whole.report).toMatchObject({ mode: "edit", moved: 3, transitions: 8 });
    expect(whole.report?.edited.map((c) => c.qualifiedName)).toEqual(["edit", "flip"]);
    expect(whole.rows.transitions.map((t) => `${t.qualified_name} ${t.measure} ${t.kind}`)).toEqual(
      [
        "gone crap removed",
        "x uncovered removed",
        "edit complexity pass-to-fail",
        "flip complexity fail-to-pass",
        "newf complexity first-seen-fail",
        "pulled complexity pass-to-fail",
        "gone complexity removed",
        "x complexity removed",
        "dup complexity removed",
        "k complexity removed",
      ],
    );
    // The view and the D9 state follow `mover` to `src/c.ts` (D2); `n` leaves with nothing told.
    expect(whole.rows.views).toMatchObject([{ path: "src/c.ts", qualified_name: "moved" }]);
    expect(whole.rows.states).toContainEqual(
      expect.objectContaining({ path: "src/c.ts", qualified_name: "moved", measure: "crap" }),
    );
    expect(whole.rows.states).not.toContainEqual(expect.objectContaining({ path: "src/n.ts" }));
    expect(parted).toEqual(whole);
  });

  it("holds the removals with a file that waits for its listing, as the one-transaction pass does", async () => {
    const { whole, parted } = await bothWays({ held: true });
    // `src/g.ts` and `src/j.ts` are new too, so they wait with `src/o.ts`.
    expect(whole.report).toMatchObject({ mode: "edit", moved: 2, transitions: 3 });
    expect(whole.rows.transitions.map((t) => t.kind)).not.toContain("removed");
    expect(whole.rows.states).toContainEqual(
      expect.objectContaining({ path: "src/e.ts", qualified_name: "gone" }),
    );
    expect(parted).toEqual(whole);
  });

  it("shows a hook the old pass or the new one, never a mix, and the old one while it stages", async () => {
    const { old, now } = await expected();
    const { tree, store } = await scenario();
    const { seen } = await watched(tree, store);

    for (const turn of seen) expect([old, now]).toContain(turn.read);
    expect(seen.some((turn) => turn.staged > 0 && turn.read === old)).toBe(true);
    expect(read(store)).toBe(now);
  });

  it("never adopts the states and transitions an earlier pass left staged", async () => {
    const { dump: want } = await expected();
    const { tree, store } = await scenario();
    const left = store.states.list("w1", { paths: ["src/a.ts"] });
    store.states.upsertMany(left.map((s) => ({ ...s, worktreeId: stagedId("w1"), value: 99 })));
    store.transitions.append([
      {
        worktreeId: stagedId("w1"),
        check: check("keep"),
        measure: "complexity",
        kind: "pass-to-fail",
        from: "pass",
        to: "fail",
        fromValue: 3,
        toValue: 99,
        threshold: 20,
        revision: 1,
        at: 1,
      },
    ]);

    await pass(tree, store, fakeCounter(), { policy: POLICY, partFiles: 2, now: ticking() });
    expect(timeless(store)).toEqual(want);
  });

  it("writes the whole set when a prune took staged rows between two parts", async () => {
    const { old, now, dump: want } = await expected();
    const { tree, store } = await scenario();
    let pruned = false;
    const { seen } = await watched(tree, store, (hook) => {
      if (pruned || hook.states.list(stagedId("w1")).length === 0) return;
      // The staged id is no live worktree's: a prune takes its rows.
      hook.prune({ now: Date.now(), retentionDays: 30, worktrees: ["w1"], consumers: [SESSION] });
      pruned = true;
    });

    expect(pruned).toBe(true);
    for (const turn of seen) expect([old, now]).toContain(turn.read);
    expect(timeless(store)).toEqual(want);
  });
});
