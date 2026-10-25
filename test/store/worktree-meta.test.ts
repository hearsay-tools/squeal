import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { observedDirectMetaKey, observedMetaKey } from "../../src/core/keys/observed.js";
import { observedStartupMetaKey } from "../../src/core/keys/startup.js";
import {
  ASKED_KEYS_META_KEY,
  RETRIES_META_KEY,
  RUN_LOADS_META_KEY,
} from "../../src/core/retry/index.js";
import { slowTokensMetaKey } from "../../src/core/slow/rank-store.js";
import { FLAKY_META_KEY } from "../../src/core/state/flaky.js";
import { RERUN_FIRST_META_KEY } from "../../src/core/state/rerun-first.js";
import { META_FULL_CHECK, META_STORE_RECOVERED } from "../../src/core/store/open.js";
import {
  WORKTREE_META_ROWS,
  type WorktreeMetaRow,
  worktreeMetaKey,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open, worktree } from "./helpers.js";

/*
 * Task 001-254: every `meta` row of one worktree is named in
 * `WORKTREE_META_ROWS`, and `WorktreeRepo.remove` drops each of them by its
 * exact name.
 */

const ROWS = Object.keys(WORKTREE_META_ROWS) as WorktreeMetaRow[];
const SRC = join(import.meta.dirname, "../../src");

/** `meta` key functions of rows shared across worktrees, keyed by project. */
const SHARED_KEY_FUNCTIONS = [
  "observedMetaKey",
  "observedDirectMetaKey",
  "observedStartupMetaKey",
  "slowTokensMetaKey",
];
/** `meta` key constants of rows shared across worktrees. */
const SHARED_KEY_CONSTANTS = [
  "ASKED_KEYS_META_KEY",
  "FLAKY_META_KEY",
  "META_FULL_CHECK",
  "META_STORE_RECOVERED",
  "RERUN_FIRST_META_KEY",
  "RETRIES_META_KEY",
  "RUN_LOADS_META_KEY",
];

function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name))
    .map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));
}

const SOURCES = sources(SRC);

describe("worktree removal and its meta rows (task 001-254, review wave 13u S1)", () => {
  it("drops every row of the removed worktree, and keeps a live one's and shared ones", () => {
    const store = open(fakeCommonDir());
    const ids = ["gone", "stay", "still-gone"];
    for (const id of ids) {
      store.worktrees.upsert(worktree(id, `/${id}`));
      for (const row of ROWS) store.meta.set(worktreeMetaKey(row, id), row);
    }
    // Shared, and named with the removed worktree's id as a suffix: never matched.
    const shared = [
      ASKED_KEYS_META_KEY,
      FLAKY_META_KEY,
      META_FULL_CHECK,
      META_STORE_RECOVERED,
      RERUN_FIRST_META_KEY,
      RETRIES_META_KEY,
      RUN_LOADS_META_KEY,
      observedMetaKey("gone"),
      observedDirectMetaKey("gone"),
      observedStartupMetaKey("gone"),
      slowTokensMetaKey("gone"),
      "unlisted:gone",
    ];
    for (const key of shared) store.meta.set(key, "{}");

    store.worktrees.remove("gone");

    for (const row of ROWS) {
      expect(store.meta.get(worktreeMetaKey(row, "gone")), row).toBeNull();
      expect(store.meta.get(worktreeMetaKey(row, "stay")), row).toBe(row);
      expect(store.meta.get(worktreeMetaKey(row, "still-gone")), row).toBe(row);
    }
    for (const key of shared) expect(store.meta.get(key), key).toBe("{}");
  });

  it("gives no two rows a key in common", () => {
    for (const a of ROWS) {
      for (const b of ROWS) {
        if (a === b) continue;
        expect(WORKTREE_META_ROWS[b].prefix.startsWith(WORKTREE_META_ROWS[a].prefix), b).toBe(
          false,
        );
      }
    }
  });
});

describe("every meta key the code writes is in the registry (task 001-254)", () => {
  it("builds each row's key in its owner", () => {
    for (const row of ROWS) {
      const call = `worktreeMetaKey("${row}", `;
      const builders = SOURCES.filter((s) => s.text.includes(call)).map((s) => s.path);
      expect(builders, row).toContain(`core/${WORKTREE_META_ROWS[row].owner}.ts`);
    }
  });

  it("writes each prefix literal once, in the registry", () => {
    for (const row of ROWS) {
      const { prefix } = WORKTREE_META_ROWS[row];
      const holders = SOURCES.filter((s) =>
        s.text.match(new RegExp(`["'\`]${escapeRegExp(prefix)}`)),
      );
      expect(
        holders.map((s) => s.path),
        prefix,
      ).toEqual(["core/types/store.ts"]);
    }
    expect(SOURCES.filter((s) => s.text.includes("edit-keys")).map((s) => s.path)).toEqual([]);
  });

  it("builds every meta key function from the registry, except the shared ones", () => {
    const found: string[] = [];
    for (const { path, text } of SOURCES) {
      for (const m of text.matchAll(/(?:function|const) (\w*[mM]etaKey)\b[^{]*\{?([^}]*)/g)) {
        const [, name = "", body = ""] = m;
        if (name === "worktreeMetaKey") continue;
        found.push(name);
        if (SHARED_KEY_FUNCTIONS.includes(name)) continue;
        expect(body, `${path}: ${name}`).toMatch(/worktreeMetaKey\("\w+", worktreeId\)/);
      }
    }
    expect(found).toEqual(expect.arrayContaining(SHARED_KEY_FUNCTIONS));
    expect(found.length).toBeGreaterThanOrEqual(ROWS.length);
  });

  it("reads and writes meta only through a key function, a shared constant or a variable bound to one", () => {
    for (const { path, text } of SOURCES) {
      for (const m of text.matchAll(/\.meta\.(?:get|set|delete)\(\s*([^,)]+)/g)) {
        const arg = (m[1] ?? "").trim();
        const where = `${path}: ${arg}`;
        if (/^\w+MetaKey\(/.test(arg)) continue;
        if (/^[A-Z_]+$/.test(arg)) {
          expect(SHARED_KEY_CONSTANTS, where).toContain(arg);
          continue;
        }
        expect(arg, where).toMatch(/^\w+$/);
        const bound = new RegExp(
          `(?:const|let) ${arg} = \\w+MetaKey\\(|\\b${arg}: string\\b|\\(${arg}\\) =>`,
        );
        expect(text, where).toMatch(bound);
      }
    }
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
