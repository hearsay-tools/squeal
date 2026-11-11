import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openStored, type StoredOptions } from "../../../src/core/code/gate/stored.js";
import { codeStorePath, openCodeStore } from "../../../src/core/code/store/open.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import { ON } from "../helpers.js";
import { ownTmpdir } from "./collect-fixture.js";

/*
 * Spec 020 D11.7 (row 020-07c): the gate reads the stores only when both
 * are there at this Squeal's schema, and a failure while keying costs only
 * the runs it would have saved: every selected file runs, told once. With a
 * store missing it reads none and still keys, so its runs can be kept and
 * the store created then (D17.3, row 020-17c); a store it cannot read is
 * neither read nor written. The keys a daemon gives are
 * `test/cli/code-gate-stored.test.ts`'s, the writes `code-gate-keep.test.ts`'s.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(made);
  return made;
}

/** A common directory with the stores `which` names, empty and at this Squeal's schema. */
function commonDir(which: { main?: boolean; code?: boolean } = { main: true, code: true }) {
  const common = dir("squeal-stored-");
  if (which.main === true) {
    const store = openStore(common);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    store.close();
  }
  if (which.code === true) {
    const store = openCodeStore(common, ON);
    if ("reason" in store) throw new Error(store.reason);
    store.close();
  }
  return common;
}

function options(common: string, extra: Partial<StoredOptions> = {}): StoredOptions {
  return {
    root: dir("squeal-stored-root-"),
    commonDir: common,
    policy: DEFAULT_POLICY,
    squealVersion: "0.0.0-test",
    env: {},
    adapters: () => Promise.reject(new Error("no adapter here")),
    ...extra,
  };
}

const REF = { project: "", path: "test/a.test.ts" };

describe("openStored: which stores it reads (spec 020 D11.7)", () => {
  it.each<[string, { main?: boolean }]>([
    ["the repository has no store", {}],
    ["the code store is missing", { main: true }],
  ])("reads none, and creates none on a lookup, when %s", async (_, which) => {
    const common = commonDir(which);
    const stored = openStored(options(common, { adapters: async () => [] }));
    expect(stored).not.toBeNull();
    expect(await stored?.stored("vitest", [REF])).toEqual(new Map());
    await stored?.close();
    expect(existsSync(storePaths(common).database)).toBe(which.main === true);
    expect(existsSync(codeStorePath(common))).toBe(false);
  });

  it("reads none when a store has another schema version", () => {
    const common = commonDir();
    const db = new DatabaseSync(codeStorePath(common));
    db.exec("PRAGMA user_version = 99");
    db.close();
    expect(openStored(options(common))).toBeNull();
  });

  it("reads both stores of this Squeal's schema", async () => {
    const stored = openStored(options(commonDir()));
    expect(stored).not.toBeNull();
    await stored?.close();
  });
});

describe("openStored: a failure while keying (spec 020 D11.7)", () => {
  it("gives no stored file, tells why once, and leaves no scratch store", async () => {
    const notes: string[] = [];
    const given = options(commonDir(), { note: (text) => notes.push(text) });
    const leftInTmp = ownTmpdir();
    const stored = openStored(given);
    expect(await stored?.stored("vitest", [REF])).toEqual(new Map());
    expect(await stored?.stored("node-test", [REF])).toEqual(new Map());
    await stored?.close();
    expect(notes).toEqual([
      "the stores were not read, so every selected file runs: no adapter here",
    ]);
    expect(leftInTmp()).toEqual([]);
  });
});
