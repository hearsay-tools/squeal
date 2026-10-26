import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { lintStorePath } from "../../../src/core/lint/store/index.js";
import {
  acknowledgeLint,
  dropLint,
  readLintNews,
  registerLint,
  tellLint,
} from "../../../src/core/lint/surface/deliver.js";
import {
  lintChanged,
  lintDetails,
  lintStatus,
  lintStop,
} from "../../../src/core/lint/surface/report.js";
import {
  type LintStoreSource,
  lintStoreSource,
  withLint,
} from "../../../src/core/lint/surface/source.js";
import { storePaths } from "../../../src/core/store/index.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { LINT_ON } from "../helpers.js";
import { lintTree } from "../pass/helpers.js";
import { consumer, lintRig, ownAfter, sourceOf } from "./helpers.js";

/* Spec 017 goal 1, D6, D8: with lint off nothing is opened; a missing or unreadable store is said so. */

const session = { ...ownAfter(0), scope: "session" } as const;
const BLOCKING = { ...LINT_ON, lint: { ...LINT_ON.lint, blocking: true } };

/** Every surface's answer for `tree` through `source`. */
function everything(source: ReturnType<typeof sourceOf>, tree: ReturnType<typeof lintTree>) {
  const me = consumer(tree);
  return {
    register: registerLint(source, me, 5_000),
    tell: tellLint(source, me, 5_000, () => ownAfter(0)),
    read: readLintNews(source, me, 5_000, () => ownAfter(0)),
    status: lintStatus(source, tree.id, session),
    details: lintDetails(source, tree.id, ["src/a.js"]),
    changed: lintChanged(source, tree.id, session),
    stop: lintStop(source, tree.id, ownAfter(0)),
  };
}

describe("the lint surfaces' store (017 goal 1, D6)", () => {
  it("with lint off, answers nothing and opens nothing, even when the store exists", () => {
    const tree = lintTree();
    const off = sourceOf(tree, () => DEFAULT_POLICY);
    expect(everything(off, tree)).toEqual({
      register: undefined,
      tell: null,
      read: null,
      status: undefined,
      details: undefined,
      changed: undefined,
      stop: null,
    });
    dropLint(off, [consumer(tree)]);
    acknowledgeLint(off, consumer(tree), {
      reseed: true,
      writes: [],
      removals: [],
      mark: { transition: 0, keying: 0, deferred: [], failed: null, off: null },
    });
    expect(existsSync(lintStorePath(tree.commonDir))).toBe(false);
    expect(readdirSync(tree.commonDir)).toEqual([]);
    expect(withLint(undefined, () => 1)).toEqual({ closed: "off" });
  });

  it("from the worktree's squeal.config.json, off by default", () => {
    const tree = lintTree();
    expect(lintStoreSource(tree.commonDir, tree.root).policy()).toBeNull();
    expect(lintStoreSource(tree.commonDir, tree.root).open()).toBeNull();
    tree.write("squeal.config.json", JSON.stringify({ lint: { enabled: true } }));
    const on = lintStoreSource(tree.commonDir, tree.root);
    expect(on.policy()).toMatchObject({ enabled: true, blocking: false });
    expect(on.open()).toBe("missing");
    expect(existsSync(lintStorePath(tree.commonDir))).toBe(false);
  });

  it("with lint on and no store yet, says linting has not started and creates none", () => {
    const tree = lintTree();
    const source = sourceOf(tree, () => BLOCKING);
    expect(everything(source, tree)).toEqual({
      register: { v: 1, failing: 0, stale: 0, linting: { done: 0, total: 0 } },
      tell: null,
      read: null,
      status: {
        v: 1,
        files: 0,
        failing: 0,
        sinceRegistration: 0,
        since: "session",
        pending: 0,
        stale: 0,
        unknown: 0,
        reasons: [],
        linting: { done: 0, total: 0 },
      },
      details: {
        v: 1,
        files: [],
        notLinted: ["src/a.js"],
        pending: 0,
        stale: 0,
        unknown: 0,
        linting: { done: 0, total: 0 },
      },
      changed: { v: 1, since: "session", entries: [] },
      stop: null,
    });
    expect(existsSync(lintStorePath(tree.commonDir))).toBe(false);
  });

  it("with a store a newer Squeal made, says it cannot be read and changes nothing", () => {
    const tree = lintTree();
    mkdirSync(storePaths(tree.commonDir).dir, { recursive: true });
    const db = new DatabaseSync(lintStorePath(tree.commonDir));
    db.exec("PRAGMA user_version = 99");
    db.close();
    const unreadable = "a newer Squeal made it (schema 99; this one reads 1)";
    const all = everything(
      sourceOf(tree, () => BLOCKING),
      tree,
    );
    expect(all.register).toEqual({ v: 1, failing: 0, stale: 0, unreadable });
    expect(all.status).toMatchObject({ files: 0, unreadable });
    expect(all.status).not.toHaveProperty("linting");
    expect(all.details).toMatchObject({ files: [], unreadable });
    expect(all.changed).toEqual({ v: 1, since: "session", entries: [], unreadable });
    expect([all.tell, all.read, all.stop]).toEqual([null, null, null]);
  });

  it("loses only the lint part when the store fails mid-read: nothing throws to the caller", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n" });
    let closed = 0;
    const failing: LintStoreSource = {
      policy: () => BLOCKING.lint,
      open() {
        const access = rig.source.open();
        if (access === null || access === "missing" || !("store" in access)) return access;
        const busy = () => {
          throw new Error("database is locked");
        };
        const close = () => {
          closed++;
          access.store.close();
        };
        return {
          ...access,
          store: { ...access.store, read: busy, transaction: busy, close },
        };
      },
    };
    expect(everything(failing, rig.tree)).toEqual({
      register: undefined,
      tell: null,
      read: null,
      status: undefined,
      details: undefined,
      changed: undefined,
      stop: null,
    });
    expect(closed).toBe(7);
  });
});
