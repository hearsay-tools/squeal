import { DatabaseSync } from "node:sqlite";
import { describe, expect, expectTypeOf, it } from "vitest";
import { lintFingerprint } from "../../src/core/lint/fingerprint.js";
import { lintStorePath } from "../../src/core/lint/store/index.js";
import type { CodeCheckId } from "../../src/core/types/code.js";
import type { CheckId, Consumer } from "../../src/core/types/index.js";
import type {
  LintCheckId,
  LintKnownState,
  LintResult,
  LintTransition,
  LintViewEntry,
} from "../../src/core/types/lint.js";
import { check, commonDir, finding, open } from "./helpers.js";

/* Spec 017 D6: results shared by key; states, transitions and views per worktree. */

const unused = finding("no-unused-vars", "'count' is assigned a value but never used.", 4);
const warning = {
  ...finding("no-console", "Unexpected console statement.", 9),
  severity: "warning" as const,
};
const parse = finding(null, "Parsing error: Unexpected token )", 12);
const findings = [unused, warning, parse];

function result(key: string, path = "src/a.ts"): LintResult {
  return {
    check: check(path),
    key,
    outcome: "fail",
    findings,
    fingerprint: lintFingerprint(findings),
    toolVersion: "10.13.0",
    lintedAt: 1_000,
  };
}

function state(worktreeId: string, path: string, over: Partial<LintKnownState> = {}) {
  return {
    worktreeId,
    check: check(path),
    outcome: "fail",
    judged: { key: "k1", outcome: "fail", fingerprint: "f1", blob: "b1", revision: 3 },
    stale: false,
    reason: null,
    changedAt: 3,
    ...over,
  } satisfies LintKnownState;
}

describe("lint check identity (017 D2)", () => {
  it("is neither a test CheckId nor a CodeCheckId", () => {
    expectTypeOf<LintCheckId>().not.toExtend<CheckId>();
    expectTypeOf<LintCheckId>().not.toExtend<CodeCheckId>();
    expectTypeOf<Extract<CheckId | CodeCheckId, { kind: "lint" }>>().toBeNever();
    expect(check()).toEqual({ kind: "lint", path: "src/a.ts", tool: "eslint" });
  });
});

describe("lint results (017 D5, D6)", () => {
  it("round-trip with their findings, and a second worktree's connection reads them by key", () => {
    const dir = commonDir();
    open(dir).results.put(result("k1"), 2_000);
    const other = open(dir);
    expect(other.read(() => other.results.get(check(), "k1"))).toEqual(result("k1"));
    expect(other.results.get(check(), "k2")).toBeNull();
    // Keyed by check and key: another path at the same key has no result.
    expect(other.results.get(check("src/b.ts"), "k1")).toBeNull();
  });

  it("store a pass with no findings and no fingerprint", () => {
    const store = open(commonDir());
    const pass = { ...result("k1"), outcome: "pass", findings: [], fingerprint: null } as const;
    store.results.put(pass, 2_000);
    expect(store.results.get(check(), "k1")).toEqual(pass);
  });

  it("replace a result at its check and key, and mark one used by a lookup", () => {
    const dir = commonDir();
    const store = open(dir);
    store.results.put(result("k1"), 2_000);
    store.results.put({ ...result("k1"), toolVersion: "10.14.0", lintedAt: 3_000 }, 3_000);
    expect(store.results.get(check(), "k1")?.toolVersion).toBe("10.14.0");
    store.results.use(check(), "k1", 9_000);
    store.results.use(check("src/never.ts"), "k1", 9_000);
    const db = new DatabaseSync(lintStorePath(dir), { readOnly: true });
    try {
      expect(db.prepare("SELECT used_at, linted_at FROM results").all()).toEqual([
        { used_at: 9_000, linted_at: 3_000 },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("lint states (017 D6)", () => {
  it("round-trip per worktree, with the judged result kept through pending, stale and unknown", () => {
    const store = open(commonDir());
    const states = [
      state("w1", "src/a.ts"),
      state("w1", "src/b.ts", { outcome: "pending" }),
      state("w1", "src/c.ts", { stale: true }),
      state("w1", "src/d.ts", { outcome: "unknown", reason: "timed out" }),
      state("w1", "src/e.ts", { outcome: "pending", judged: null, changedAt: 4 }),
    ];
    store.states.upsertMany([...states, state("w2", "src/a.ts", { outcome: "pass" })]);
    expect(store.states.list("w1")).toEqual(states);
    expect(store.states.list("w2").map((s) => s.outcome)).toEqual(["pass"]);
    expect(store.states.list("w3")).toEqual([]);
  });

  it("narrow by paths and outcome, update in place and remove per worktree", () => {
    const store = open(commonDir());
    store.states.upsertMany([
      state("w1", "src/a.ts"),
      state("w1", "src/b.ts", { outcome: "pass" }),
      state("w2", "src/a.ts"),
    ]);
    const paths = ["src/b.ts", "src/none.ts"];
    expect(store.states.list("w1", { paths }).map((s) => s.check.path)).toEqual(["src/b.ts"]);
    expect(store.states.list("w1", { outcome: "fail" }).map((s) => s.check.path)).toEqual([
      "src/a.ts",
    ]);
    store.states.upsertMany([state("w1", "src/a.ts", { outcome: "pass", changedAt: 7 })]);
    expect(store.states.list("w1", { paths: ["src/a.ts"] })).toEqual([
      state("w1", "src/a.ts", { outcome: "pass", changedAt: 7 }),
    ]);
    store.states.removeMany("w1", [check("src/a.ts"), check("src/none.ts")]);
    expect(store.states.list("w1").map((s) => s.check.path)).toEqual(["src/b.ts"]);
    expect(store.states.list("w2")).toEqual([state("w2", "src/a.ts")]);
  });
});

describe("lint transitions (017 D2)", () => {
  it("keep each worktree's history oldest first, with the findings added and removed", () => {
    const store = open(commonDir());
    const at = (
      worktreeId: string,
      revision: number,
      over: Partial<LintTransition> = {},
    ): LintTransition => ({
      worktreeId,
      check: check(),
      kind: "fail-changed",
      added: [unused],
      removed: [warning],
      revision,
      at: revision * 1_000,
      ...over,
    });
    const first = at("w1", 1, { kind: "first-seen-fail", added: findings, removed: [] });
    const later = [at("w1", 2), at("w1", 3, { kind: "removed", added: [], removed: findings })];
    store.transitions.append([first, at("w2", 1, { kind: "pass-to-fail" })]);
    store.transitions.append(later);
    const w1 = [first, ...later];
    expect(store.transitions.history("w1", check())).toEqual(w1);
    expect(store.transitions.history("w2", check()).map((t) => t.kind)).toEqual(["pass-to-fail"]);
    expect(store.transitions.history("w1", check("src/none.ts"))).toEqual([]);
  });
});

describe("lint views (017 D8)", () => {
  const consumer = (worktreeId: string, sessionId = "s1"): Consumer => ({
    worktreeId,
    sessionId,
    agentId: "main",
  });
  const entry = (path: string, over: Partial<LintViewEntry> = {}): LintViewEntry => ({
    check: check(path),
    outcome: "fail",
    fingerprint: "f1",
    told: "full",
    toldAt: 5_000,
    ...over,
  });

  it("keep what each consumer was told, per worktree, and list no pass", () => {
    const store = open(commonDir());
    store.views.writeMany(consumer("w1"), [
      entry("src/a.ts"),
      entry("src/b.ts", { outcome: "pass", fingerprint: null }),
      entry("src/c.ts", { told: "count" }),
    ]);
    store.views.writeMany(consumer("w2"), [entry("src/a.ts", { fingerprint: "f2" })]);
    expect(store.views.list(consumer("w1"))).toEqual([
      entry("src/a.ts"),
      entry("src/c.ts", { told: "count" }),
    ]);
    expect(store.views.list(consumer("w2"))).toEqual([entry("src/a.ts", { fingerprint: "f2" })]);
    expect(store.views.list(consumer("w1", "s2"))).toEqual([]);
  });

  it("update in place, remove by check and clear one consumer only", () => {
    const store = open(commonDir());
    store.views.writeMany(consumer("w1"), [entry("src/a.ts"), entry("src/c.ts")]);
    store.views.writeMany(consumer("w1", "s2"), [entry("src/a.ts")]);
    store.views.writeMany(consumer("w1"), [entry("src/a.ts", { fingerprint: "f3", toldAt: 6 })]);
    expect(store.views.list(consumer("w1"))[0]).toEqual(
      entry("src/a.ts", { fingerprint: "f3", toldAt: 6 }),
    );
    store.views.removeMany(consumer("w1"), [check("src/c.ts"), check("src/none.ts")]);
    expect(store.views.list(consumer("w1")).map((e) => e.check.path)).toEqual(["src/a.ts"]);
    store.views.clear(consumer("w1"));
    expect(store.views.list(consumer("w1"))).toEqual([]);
    expect(store.views.list(consumer("w1", "s2"))).toEqual([entry("src/a.ts")]);
  });
});

describe("lint meta", () => {
  it("sets, replaces and deletes a fact", () => {
    const store = open(commonDir());
    expect(store.meta.get("config")).toBeNull();
    store.meta.set("config", "a");
    store.meta.set("config", "b");
    expect(store.meta.get("config")).toBe("b");
    store.meta.delete("config");
    expect(store.meta.get("config")).toBeNull();
  });
});
