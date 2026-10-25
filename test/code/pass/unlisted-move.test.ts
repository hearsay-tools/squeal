import { describe, expect, it } from "vitest";
import type { PassReport } from "../../../src/core/code/pass/index.js";
import { open } from "../helpers.js";
import { fakeCounter, pass, policyOn, worktree } from "./helpers.js";
import { consumer, type Rig, rig } from "./rig.js";

/*
 * Review 0.1.315 B1 (repair R11): a move whose new path waits for its
 * listing (row 015-52) is still one move by body hash, with nothing told
 * (D2). No origin is resolved before the listing that settles the move,
 * for a deleted file and for a function removed from a file that stays.
 */

const summary = (r: PassReport | null) => ({
  moved: r?.moved ?? 0,
  transitions: r?.transitions ?? 0,
  removed: (r?.removed ?? []).map((c) => `${c.path}:${c.qualifiedName}`),
});

/** Two passes over a move at revision 2, the first while revision 2 is not listed yet. */
async function moved(before: Record<string, string>, after: Record<string, string | null>) {
  const tree = worktree();
  const store = open(tree.commonDir);
  const counter = fakeCounter();
  for (const [path, text] of Object.entries(before)) tree.write(path, text);
  tree.revise();
  await pass(tree, store, counter);
  tree.listed = 1;
  for (const [path, text] of Object.entries(after)) {
    if (text === null) tree.remove(path);
    else tree.write(path, text);
  }
  tree.revise();
  const held = await pass(tree, store, counter);
  tree.listed = null;
  const released = await pass(tree, store, counter);
  const states = store.states
    .list(tree.id, { measure: "complexity" })
    .map((s) => `${s.check.path}:${s.check.qualifiedName} ${s.outcome} since ${s.changedAt}`);
  return { passes: { held: summary(held), released: summary(released) }, states, store, tree };
}

const ONE_MOVE = {
  held: { moved: 0, transitions: 0, removed: [] },
  released: { moved: 1, transitions: 0, removed: [] },
};

describe("a move while its new path waits for the listing (D2; review 0.1.315 B1)", () => {
  it("keeps a renamed file's function one move with no transition", async () => {
    const run = await moved(
      { "src/old.ts": "moved 25 same-body\n" },
      { "src/old.ts": null, "src/new.ts": "moved 25 same-body\n" },
    );
    expect(run.passes).toEqual(ONE_MOVE);
    expect(run.states).toEqual(["src/new.ts:moved fail since 1"]);
  });

  it("keeps a function moved out of a file that stays one move with no transition", async () => {
    const run = await moved(
      { "src/a.ts": "keep 3 k1\nmoved 25 same-body\n" },
      { "src/a.ts": "keep 3 k1\n", "src/b.ts": "moved 25 same-body\n" },
    );
    expect(run.passes).toEqual(ONE_MOVE);
    expect(run.states).toEqual(["src/a.ts:keep pass since 1", "src/b.ts:moved fail since 1"]);
  });

  it("resolves the origin when the new path is listed as a test file", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    const counter = fakeCounter();
    tree.write("src/old.ts", "moved 25 same-body\n").revise();
    await pass(tree, store, counter);
    tree.listed = 1;
    tree.remove("src/old.ts").write("test/old.test.ts", "moved 25 same-body\n").revise();
    expect(summary(await pass(tree, store, counter))).toEqual(ONE_MOVE.held);
    tree.testFiles.push("test/old.test.ts");
    tree.listed = null;
    expect(summary(await pass(tree, store, counter))).toEqual({
      moved: 0,
      transitions: 1,
      removed: ["src/old.ts:moved"],
    });
    expect(store.files.list(tree.id).map((f) => f.path)).toEqual([]);
  });

  it("waits with a recount while a file waits, then removes its states with no transition", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    const counter = fakeCounter();
    tree.write("src/old/a.ts", "gone 25 g1\n").revise();
    await pass(tree, store, counter);
    tree.listed = 1;
    tree.write("src/new.ts", "fresh 3 f1\n").revise();
    const policy = policyOn({ exclude: ["src/old/**"] });
    expect(await pass(tree, store, counter, { policy })).toBeNull();
    tree.listed = null;
    expect((await pass(tree, store, counter, { policy }))?.mode).toBe("include");
    const states = store.states.list(tree.id, { measure: "complexity" });
    expect(states.map((s) => `${s.check.path}:${s.check.qualifiedName}`)).toEqual([
      "src/new.ts:fresh",
    ]);
    const history = store.transitions.history(tree.id, {
      kind: "code",
      path: "src/old/a.ts",
      qualifiedName: "gone",
      occurrence: 0,
    });
    // Removed with its history, and no `removed` transition tells it.
    expect(history.map((t) => t.kind)).toEqual([]);
  });
});

const S1 = consumer("s1");

/** `f` over 2 at `src/a.ts` from revision 2, with S1 registered at revision 1; `tell` delivers its FAIL. */
async function crossed(tell: boolean): Promise<{ r: Rig; first: string[] }> {
  const r = rig({ threshold: 2 });
  await r.edit({ "src/a.ts": "f 1 b0\n" });
  await r.register(S1);
  await r.edit({ "src/a.ts": "f 3 b1\n" });
  return { r, first: tell ? await r.told(S1) : [] };
}

/** Renames `src/a.ts` to `src/b.ts`, body unchanged; with `lag`, the pass runs before and after its listing. */
async function rename(r: Rig, lag: boolean): Promise<string[]> {
  if (lag) r.tree.listed = r.tree.source.latestRevision();
  r.tree.remove("src/a.ts").write("src/b.ts", "f 3 b1\n").revise();
  await r.pass();
  r.tree.listed = null;
  await r.pass();
  return r.told(S1);
}

/** The complexity states, and every code transition with its revision, for Stop and status. */
function record(r: Rig) {
  return {
    states: r.store.states
      .list(r.tree.id, { measure: "complexity" })
      .map((s) => `${s.check.path}:${s.check.qualifiedName} ${s.outcome} since ${s.changedAt}`),
    transitions: ["src/a.ts", "src/b.ts"].flatMap((path) =>
      r.store.transitions
        .history(r.tree.id, { kind: "code", path, qualifiedName: "f", occurrence: 0 })
        .map((t) => `${path} ${t.kind} at ${t.revision}`),
    ),
  };
}

describe("a move while its listing lags, through the delivery (review 0.1.315 B1)", () => {
  it("tells nothing for a told crossing's rename, and keeps it told", async () => {
    const { r, first } = await crossed(true);
    expect(first).toEqual(["FAIL complexity: f (src/a.ts:1) is 3, over 2 (ESLint rule)"]);
    expect(await rename(r, true)).toEqual([]);
    expect(r.store.views.list(S1).map((v) => `${v.check.path} ${v.told}`)).toEqual([
      "src/b.ts full",
    ]);
  });

  it("tells a crossing not yet told, and keeps its state and history, as with no lag", async () => {
    const plain = await crossed(false);
    const lagged = await crossed(false);
    const told = await rename(plain.r, false);
    expect(told.length).toBeGreaterThan(0);
    expect(await rename(lagged.r, true)).toEqual(told);
    expect(record(lagged.r)).toEqual(record(plain.r));
  });
});
