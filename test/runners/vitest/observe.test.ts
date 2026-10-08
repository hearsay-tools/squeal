import { symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/**
 * The `observed` fixture: runtime.test.ts reads, spawns, starts a Worker and lists (task 001-132),
 * and lists recursively (001-139).
 */
const observing = (root: string) => createVitestAdapter({ root, observe: () => true });

const RUNTIME_READS = [
  "data/grand.txt",
  "data/input.txt",
  "data/worker.txt",
  "scripts/child.mjs",
  "scripts/grandchild.mjs",
  "scripts/worker.mjs",
];

describe("vitest adapter: observed runtime inputs", SLOW, () => {
  it.each(["forks", "threads"])(
    "under %s, sees the data file, an env {} child and grandchild, a Worker and the listings",
    async (pool) => {
      const fx = await openFixture("observed", {}, observing);
      const runtime = ref("test/runtime.test.ts", pool);
      const plain = ref("test/plain.test.ts", pool);
      const report = await fx.adapter.run([runtime, plain], fx.runOptions());

      expect(report.end).toBe("completed");
      expect(report.results.every((r) => r.outcome === "pass")).toBe(true);
      const seen = report.observed?.find((o) => o.testFile.path === runtime.path);
      expect(seen?.testFile).toEqual(runtime);
      for (const path of RUNTIME_READS) expect(seen?.paths).toContain(path);
      expect(seen?.directories).toEqual(["data/listed", "data/tree"]);
      expect(seen?.recursive).toEqual(["data/tree"]);
      const other = report.observed?.find((o) => o.testFile.path === plain.path);
      for (const path of RUNTIME_READS) expect(other?.paths ?? []).not.toContain(path);
    },
  );

  it.each(["forks", "threads"])(
    "under %s, keeps review wave 12d's probes passing and sees what they read (task 001-135)",
    async (pool) => {
      const fx = await openFixture("observed", {}, observing);
      symlinkSync("target.txt", join(fx.root, "data/alias.txt"));
      symlinkSync("real", join(fx.root, "data/linked"));
      const reach = ref("test/reach.test.ts", pool);
      const report = await fx.adapter.run([reach], fx.runOptions());

      expect(report.end).toBe("completed");
      expect(report.results).toHaveLength(4);
      // B6 among them: an invalid spawnSync still throws
      expect.soft(report.results.filter((r) => r.outcome !== "pass")).toEqual([]);
      const seen = report.observed?.find((o) => o.testFile.path === reach.path)?.paths;
      const reads = (b: string, paths: string[]) =>
        expect.soft(seen, b).toEqual(expect.arrayContaining(paths));
      // the link and the bytes read
      reads("B2", [
        "data/alias.txt",
        "data/target.txt",
        "data/linked/inner.txt",
        "data/real/inner.txt",
      ]);
      reads("B3", ["data/rplus.txt", "data/rdwr.txt", "data/handle.txt"]);
      // the SHARE_ENV thread and its child
      reads("B4", [
        "scripts/shared.cjs",
        "data/shared.txt",
        "scripts/descendant.cjs",
        "data/descendant.txt",
      ]);
    },
  );

  it("records a worktree that lies inside the temp directory", async () => {
    // A daemon's TMPDIR is its own directory; a test or session may put the worktree below it.
    const fx = await openFixture("observed");
    const saved = process.env.TMPDIR;
    onTestFinished(() => {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    });
    process.env.TMPDIR = dirname(fx.root);
    const inside = await openFixture("observed", {}, observing);
    const report = await inside.adapter.run(
      [ref("test/runtime.test.ts", "forks")],
      inside.runOptions(),
    );
    expect(report.observed?.[0]?.paths).toContain("data/input.txt");
  });

  it("observes nothing while observation is off, and changes no environment", async () => {
    const off = await openFixture("observed");
    const report = await off.adapter.run([ref("test/runtime.test.ts", "forks")], off.runOptions());
    expect(report.end).toBe("completed");
    expect(report.observed).toBeUndefined();
    const [environment] = await off.adapter.environment();
    expect(environment?.adapterVersion).toBe(off.adapter.adapterVersion);

    const on = await openFixture("observed", {}, observing);
    const [observed] = await on.adapter.environment();
    expect(observed?.adapterVersion).not.toBe(environment?.adapterVersion);
    expect(observed?.resolvedConfig).toBe(environment?.resolvedConfig);
  });

  it("keeps the recorder's per-instance env out of a root project's resolved config", async () => {
    // Vitest copies the `env` option into a root project's config; `observed` uses `projects`.
    const off = await openFixture("basic");
    const first = await openFixture("basic", {}, observing);
    const second = await openFixture("basic", {}, observing);
    const config = async (fx: typeof off) => (await fx.adapter.environment())[0]?.resolvedConfig;
    const expected = await config(off);
    expect(await config(first)).toBe(expected);
    expect(await config(second)).toBe(expected);
  });

  it("follows the policy: switching it on recreates the instance with the recorder", async () => {
    let enabled = false;
    const fx = await openFixture("observed", {}, (root) =>
      createVitestAdapter({ root, observe: () => enabled }),
    );
    const runtime = ref("test/runtime.test.ts", "forks");
    expect((await fx.adapter.run([runtime], fx.runOptions())).observed).toBeUndefined();
    enabled = true;
    const report = await fx.adapter.run([runtime], fx.runOptions());
    expect(report.observed?.[0]?.paths).toContain("data/input.txt");
  });
});
