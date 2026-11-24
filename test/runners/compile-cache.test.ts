import { describe, expect, it } from "vitest";
import { dropOwnCompileCache, withoutOwnCompileCache } from "../../src/core/env/compile-cache.js";

/*
 * Spec 025 D7.2: Squeal's own compile cache, the one its launchers set and
 * mark with SQUEAL_OWN_COMPILE_CACHE=1, leaves a test process's environment;
 * a user's stays.
 */

const OWN = { PATH: "/bin", NODE_COMPILE_CACHE: "/c/squeal", SQUEAL_OWN_COMPILE_CACHE: "1" };

describe("Squeal's own compile cache (spec 025 D7.2)", () => {
  it("leaves a copy of the environment, which stays as it was", () => {
    const env = { ...OWN };
    expect(withoutOwnCompileCache(env)).toEqual({ PATH: "/bin" });
    expect(env).toEqual(OWN);
  });

  it.each([
    { name: "a user's cache", env: { PATH: "/bin", NODE_COMPILE_CACHE: "/mine" } },
    { name: "a mark other than 1", env: { ...OWN, SQUEAL_OWN_COMPILE_CACHE: "0" } },
    { name: "no cache", env: { PATH: "/bin" } },
  ])("keeps $name", ({ env }) => {
    expect(withoutOwnCompileCache(env)).toBe(env);
    const kept = { ...env };
    dropOwnCompileCache(kept);
    expect(kept).toEqual(env);
  });

  it("drops it in place for a process whose children spread its env", () => {
    const env: NodeJS.ProcessEnv = { ...OWN };
    dropOwnCompileCache(env);
    expect(env).toEqual({ PATH: "/bin" });
  });
});
