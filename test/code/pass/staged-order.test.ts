import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { byCheck, byCodePoint } from "../../../src/core/code/pass/order.js";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import type { CodeKnownState } from "../../../src/core/types/code.js";
import { check, open } from "../helpers.js";
import { fakeCounter, pass, policyOn, worktree } from "./helpers.js";

/*
 * Review 0.1.330 B1: an edit pass in parts met its gone checks in the
 * plan's UTF-16 order of paths, the one-transaction pass in SQLite's
 * `BINARY` order. `src/.ts` and `src/\u{10000}.ts` are in one order
 * one way and in the other the other way, so a duplicate body took another
 * move source, and with it another CRAP state and a `removed` transition.
 */

const POLICY = policyOn();
const SESSION = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
const BMP = "src/.ts";
const ASTRAL = "src/\u{10000}.ts";
/** Two more gone failures, one of each kind of path, with no body to move to. */
const LONE = { "src/.ts": "g 26 G\n", "src/\u{10001}.ts": "h 27 H\n" };
const OTHERS = Array.from({ length: 30 }, (_, i) => `src/a${i}.ts`);

/**
 * The review's 33 changed paths: both Unicode paths go with one body, a new
 * file takes it, 30 more files are edited. Only `BMP`'s function fails
 * CRAP, and a session was told of it. With `lone`, two more failing files
 * go, each with a CRAP failure: 35 paths.
 */
async function scenario(partFiles: number | undefined, { lone = false } = {}) {
  const tree = worktree("w1");
  const store = open(tree.commonDir);
  const gone: Record<string, string> = { [BMP]: "f 25 SAME\n", [ASTRAL]: "f 25 SAME\n" };
  if (lone) Object.assign(gone, LONE);
  for (const [path, text] of Object.entries(gone)) tree.write(path, text);
  for (const [i, path] of OTHERS.entries()) tree.write(path, `f 3 old${i}\n`);
  tree.commit();
  tree.revise();
  await pass(tree, store, fakeCounter(), { policy: POLICY });
  const crap = lone ? [BMP, ...Object.keys(LONE)] : [BMP];
  store.states.upsertMany(
    crap.map((path) => ({
      ...(store.states.list("w1", { paths: [path] })[0] as CodeKnownState),
      measure: "crap" as const,
      outcome: "fail" as const,
      value: 900,
      threshold: 30,
    })),
  );
  store.views.writeMany(SESSION, [
    {
      check: { ...check("f"), path: BMP },
      measure: "complexity",
      outcome: "fail",
      threshold: 20,
      told: "full",
      toldAt: 500,
    },
  ]);
  for (const path of Object.keys(gone)) tree.remove(path);
  tree.write("src/new.ts", "moved 25 SAME\n");
  for (const [i, path] of OTHERS.entries()) tree.write(path, `f 3 new${i}\n`);
  tree.revise();
  const report = await pass(tree, store, fakeCounter(), {
    policy: POLICY,
    ...(partFiles === undefined ? {} : { partFiles }),
  });
  return { report, rows: dump(store) };
}

/** The rows a hook reads, ids left out, transitions in id order. */
function dump(store: CodeStore) {
  const db = new DatabaseSync(store.path, { readOnly: true });
  const rows = (sql: string) => db.prepare(sql).all();
  const check = "c.path, c.qualified_name, c.occurrence";
  const out = {
    states: rows(`SELECT s.worktree_id, ${check}, s.measure, s.outcome, s.value, s.threshold,
      s.counted_at, s.blob, s.changed_at, s.edited_revision, s.edited_at
      FROM states s JOIN checks c ON c.id = s.check_id ORDER BY 1, 2, 3, 4, 5`),
    transitions: rows(`SELECT t.worktree_id, ${check}, t.measure, t.kind, t.from_outcome,
      t.to_outcome, t.revision FROM transitions t JOIN checks c ON c.id = t.check_id ORDER BY t.id`),
    views: rows(`SELECT v.worktree_id, ${check}, v.measure, v.outcome, v.told
      FROM views v JOIN checks c ON c.id = v.check_id ORDER BY 1, 2, 3, 4`),
  };
  db.close();
  return out;
}

const brief = (rows: ReturnType<typeof dump>["transitions"]) =>
  rows.map((t) => `${t.path} ${t.measure} ${t.kind}`);

describe("an edit pass in parts meets its gone checks in the one-transaction order (review 0.1.330 B1)", () => {
  it("moves a duplicate body from the same function, with its CRAP state and view", async () => {
    const whole = await scenario(1000);
    const parted = await scenario(undefined);

    expect(whole.report).toMatchObject({ mode: "edit", moved: 1 });
    expect(whole.report?.moves).toMatchObject([
      { from: { path: BMP, qualifiedName: "f" }, to: { path: "src/new.ts" } },
    ]);
    expect(whole.rows.states).toContainEqual(
      expect.objectContaining({ path: "src/new.ts", measure: "crap", outcome: "fail", value: 900 }),
    );
    expect(whole.rows.views).toMatchObject([{ path: "src/new.ts", qualified_name: "moved" }]);
    expect(brief(whole.rows.transitions)).toEqual([`${ASTRAL} complexity removed`]);
    expect(parted).toEqual(whole);
  });

  it("tells the removals across parts in that order", async () => {
    const whole = await scenario(1000, { lone: true });
    const parted = await scenario(undefined, { lone: true });

    expect(brief(whole.rows.transitions)).toEqual([
      "src/.ts crap removed",
      "src/\u{10001}.ts crap removed",
      "src/.ts complexity removed",
      `${ASTRAL} complexity removed`,
      "src/\u{10001}.ts complexity removed",
    ]);
    expect(parted).toEqual(whole);
  });
});

describe("the gone checks' order", () => {
  it("is SQLite's BINARY order: UTF-8 bytes, not UTF-16 units", () => {
    const paths = ["src/\u{10000}.ts", "src/￿.ts", "src/a.ts", "src/.ts", "src/"];
    const bytes = [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    expect([...paths].sort(byCodePoint)).toEqual(bytes);
    expect(bytes).toEqual(["src/", "src/a.ts", "src/.ts", "src/￿.ts", "src/\u{10000}.ts"]);
  });

  it("orders checks by path, then qualified name, then occurrence", () => {
    const at = (path: string, qualifiedName: string, occurrence: number) => ({
      kind: "code" as const,
      path,
      qualifiedName,
      occurrence,
    });
    const checks = [at("b", "f", 0), at("a", "g", 0), at("a", "f", 10), at("a", "f", 2)];
    expect(checks.sort(byCheck)).toEqual([
      at("a", "f", 2),
      at("a", "f", 10),
      at("a", "g", 0),
      at("b", "f", 0),
    ]);
  });
});
