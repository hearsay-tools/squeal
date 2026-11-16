import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheCheckoutsDir,
  cacheHome,
  deviceOf,
  gitCheckoutsDir,
  locateCheckouts,
} from "../../src/core/checkout/location.js";

/* Row 023-05 (spec 023 D4.2, human 2026-11-16): the cache folder on the store's filesystem, else the git folder. */

let base: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-location-")));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the checkout location", () => {
  it("follows XDG_CACHE_HOME, else the platform's cache folder under HOME", () => {
    expect(cacheHome({ XDG_CACHE_HOME: "/x/cache", HOME: "/h" }, "linux")).toBe("/x/cache");
    expect(cacheHome({ XDG_CACHE_HOME: "relative", HOME: "/h" }, "linux")).toBe("/h/.cache");
    expect(cacheHome({ HOME: "/h" }, "darwin")).toBe("/h/Library/Caches");
  });

  it("is the cache when the cache and the store share a filesystem, even before either exists", () => {
    const cacheRoot = join(base, "cache", "squeal", "checkouts");
    const located = locateCheckouts({
      commonDir: join(base, "repo", ".git"),
      cacheRoot,
      store: join(base, "store", "v11"),
      root: join(base, "repo"),
    });
    expect(located).toEqual({
      dir: cacheCheckoutsDir(cacheRoot, join(base, "repo", ".git")),
      warning: null,
    });
    expect(located.dir.startsWith(`${cacheRoot}/`)).toBe(true);
  });

  it.skipIf(process.platform !== "linux")(
    "is the git folder, with one warning line, when the store lies on another filesystem",
    () => {
      expect(deviceOf("/proc")).not.toBe(deviceOf(base));
      const commonDir = join(base, "repo", ".git");
      const located = locateCheckouts({
        commonDir,
        cacheRoot: join(base, "cache"),
        store: "/proc/self",
        root: join(base, "repo"),
      });
      expect(located.dir).toBe(gitCheckoutsDir(commonDir));
      expect(located.warning).toMatch(/packages in its parent folders can load$/);
      expect(located.warning?.split("\n")).toHaveLength(1);
    },
  );

  it("compares against the user's tree when the store is unknown", () => {
    const located = locateCheckouts({
      commonDir: join(base, "repo", ".git"),
      cacheRoot: join(base, "cache"),
      store: null,
      root: base,
    });
    expect(located.warning).toBeNull();
  });
});
