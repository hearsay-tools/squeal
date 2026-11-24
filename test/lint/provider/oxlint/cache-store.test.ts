import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CacheEntry,
  OxlintCache,
  storeBacking,
} from "../../../../src/core/lint/provider/oxlint/cache.js";
import { LINT_SCHEMA_VERSION } from "../../../../src/core/lint/store/schema.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { open } from "../../helpers.js";
import { scratch } from "../../oxlint/helpers.js";

/*
 * Spec 026 D3: the config cache's backing a short-lived daemon finds again
 * is the worktree's `lint.sqlite`, its `meta` table, so the lint store's
 * schema version does not move. With no store, or outside git, memory only.
 */

const ENTRY: CacheEntry = {
  key: "k1",
  config: { printed: { typeAware: false, importPlugin: true, javascript: false }, held: [] },
  linted: { "src/a.js": true, "src/gen.js": false },
};

function repository(): AbsolutePath {
  const root = realpathSync(scratch()) as AbsolutePath;
  execFileSync("git", ["init", "-q", "."], { cwd: root, env: { PATH: process.env.PATH } });
  return root;
}

describe("spec 026 D3: the config cache in lint.sqlite", () => {
  it("keeps an entry across caches in the worktree's lint store, at the same schema version", async () => {
    const root = repository();
    const store = open(join(root, ".git"));
    const first = new OxlintCache(storeBacking);
    await first.write(root, ENTRY);
    await first.close();

    const second = new OxlintCache(storeBacking);
    expect(await second.read(root)).toEqual(ENTRY);
    await second.close();
    expect(store.schemaVersion).toBe(LINT_SCHEMA_VERSION);
    expect(store.meta.get(`oxlint.cache:${root}`)).toBe(JSON.stringify(ENTRY));
  });

  it("makes no lint store where the daemon made none, and keeps the entry in memory", async () => {
    const root = repository();
    expect(await storeBacking(root)).toBeNull();
    const cache = new OxlintCache(storeBacking);
    await cache.write(root, ENTRY);
    expect(await cache.read(root)).toEqual(ENTRY);
    expect(await new OxlintCache(storeBacking).read(root)).toBeNull();
  });

  it("reads nothing outside git", async () => {
    const cache = new OxlintCache(storeBacking);
    expect(await cache.read(scratch() as AbsolutePath)).toBeNull();
  });

  it("reads a damaged entry as none", async () => {
    const root = repository();
    const store = open(join(root, ".git"));
    store.meta.set(`oxlint.cache:${root}`, "{ not json");
    expect(await new OxlintCache(storeBacking).read(root)).toBeNull();
  });
});
