import { describe, expect, it, vi } from "vitest";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 025 D7.2, live: Vitest's workers in both pools, and what a test
 * spawns, get no NODE_COMPILE_CACHE from Squeal's launchers; a user's
 * reaches them.
 */

const TEST = `import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const read = "process.stdout.write((process.env.NODE_COMPILE_CACHE ?? 'none') + ' ' + (process.env.SQUEAL_OWN_COMPILE_CACHE ?? 'none'))";
it("sees the cache it is meant to", () => {
  const child = spawnSync(process.execPath, ["-e", read], { encoding: "utf8" }).stdout;
  const own = (process.env.NODE_COMPILE_CACHE ?? "none") + " " + (process.env.SQUEAL_OWN_COMPILE_CACHE ?? "none");
  expect({ own, child }).toEqual({ own: process.env.EXPECTED_CACHE, child: process.env.EXPECTED_CACHE });
});
`;

async function runs(expected: string): Promise<string[]> {
  vi.stubEnv("EXPECTED_CACHE", expected);
  const fx = await openFixture("observed", { "test/cache.test.ts": TEST });
  const out: string[] = [];
  for (const pool of ["forks", "threads"]) {
    const report = await fx.adapter.run([ref("test/cache.test.ts", pool)], fx.runOptions());
    out.push(`${pool}: ${report.results.map((r) => r.outcome).join(",")}`);
  }
  return out;
}

describe("vitest adapter: the compile cache (spec 025 D7.2)", SLOW, () => {
  it("keeps Squeal's own out of both pools' workers and their children", async () => {
    vi.stubEnv("NODE_COMPILE_CACHE", "/nonexistent/squeal-compile-cache");
    vi.stubEnv("SQUEAL_OWN_COMPILE_CACHE", "1");
    try {
      expect(await runs("none none")).toEqual(["forks: pass", "threads: pass"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands a user's cache to both pools' workers and their children", async () => {
    vi.stubEnv("NODE_COMPILE_CACHE", "/nonexistent/my-compile-cache");
    vi.stubEnv("SQUEAL_OWN_COMPILE_CACHE", undefined);
    try {
      expect(await runs("/nonexistent/my-compile-cache none")).toEqual([
        "forks: pass",
        "threads: pass",
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
