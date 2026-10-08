import { describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import type { AbsolutePath } from "../../../src/core/types/index.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { SourceStamps } from "../../../src/runners/vitest/sources.js";
import { openFixture, outcomes, readsTest, ref, SLOW } from "./helpers.js";

/*
 * Task 001-146: a transform holds the bytes on disk when Vite read them. A
 * revert and its restore inside one watcher batch leave the file's hash as
 * it was, so no revision names it and the adapter is never told to
 * invalidate it; a transform read in between kept the reverted bytes, and
 * every later run executed them under a key naming the restored ones.
 */

const NEW = 'export const which = "new";\n';
const OLD = 'export const which = "old";\n';

/** Reverts `src/mod.ts`, imports it by a specifier Vite cannot see, restores it. */
const reverting = [
  'import { readFileSync, writeFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'it("loads the module while it is reverted", async () => {',
  '  const file = new URL("../src/mod.ts", import.meta.url);',
  '  const restored = readFileSync(file, "utf8");',
  `  writeFileSync(file, ${JSON.stringify(OLD)});`,
  '  const target = "../src/mod" + ".ts";',
  "  const { which } = await import(/* @vite-ignore */ target);",
  "  writeFileSync(file, restored);",
  '  expect(which).toBe("old");',
  "});",
  "",
].join("\n");

describe("vitest adapter: a module whose bytes moved after Vite read them (001-146)", SLOW, () => {
  it("runs the restored bytes after a transform read the reverted ones", async () => {
    const fx = await openFixture("basic", {
      "src/mod.ts": NEW,
      "test/mod.test.ts": readsTest("../src/mod.ts", "new"),
    });
    const mod = ref("test/mod.test.ts");
    expect(outcomes(await fx.adapter.run([mod], fx.runOptions()))).toEqual(["pass"]);

    // An earlier revision changed the module; nothing transformed it since.
    await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);
    // A closure is read while the file is reverted, and the file is restored
    // before the watcher's batch closes: no revision, no invalidate.
    fx.write("src/mod.ts", OLD);
    await fx.adapter.closure(mod);
    fx.write("src/mod.ts", NEW);

    const report = await fx.adapter.run([mod], fx.runOptions());
    expect(report.completedFiles).toEqual([mod]);
    expect(outcomes(report)).toEqual(["pass"]);
  });

  it("runs the restored bytes in each project of a projects config", async () => {
    const fx = await openFixture("projects", {
      "src/mod.ts": NEW,
      "test/mod.unit.test.ts": readsTest("../src/mod.ts", "new"),
    });
    const mod = ref("test/mod.unit.test.ts", "unit");
    expect(outcomes(await fx.adapter.run([mod], fx.runOptions()))).toEqual(["pass"]);
    await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);
    fx.write("src/mod.ts", OLD);
    await fx.adapter.closure(mod);
    fx.write("src/mod.ts", NEW);
    expect(outcomes(await fx.adapter.run([mod], fx.runOptions()))).toEqual(["pass"]);
  });

  // Review wave-13 B2: a project with its own config file has its own Vite
  // server, which plugins passed to `createVitest` never reach.
  it.each([
    { disk: OLD, transient: NEW, expected: "fail" },
    { disk: NEW, transient: OLD, expected: "pass" },
  ])("runs the bytes on disk in a project with its own config file ($expected)", async (c) => {
    const fx = await openFixture("basic", {
      "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { projects: ["./vitest.unit.config.ts"] } });\n`,
      "vitest.unit.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { name: "unit", include: ["test/mod.test.ts"] } });\n`,
      "src/mod.ts": c.disk,
      "test/mod.test.ts": readsTest("../src/mod.ts", "new"),
    });
    const mod = ref("test/mod.test.ts", "unit");
    expect(outcomes(await fx.adapter.run([mod], fx.runOptions()))).toEqual([c.expected]);
    await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);
    fx.write("src/mod.ts", c.transient);
    await fx.adapter.closure(mod);
    fx.write("src/mod.ts", c.disk);
    expect(outcomes(await fx.adapter.run([mod], fx.runOptions()))).toEqual([c.expected]);
  });

  it("counts what a project server cached before it was attached as stale", async () => {
    const fx = await openFixture("basic", { "src/mod.ts": NEW });
    const root = fx.root as AbsolutePath;
    const vitest = await createVitest("test", { root, watch: false, reporters: [] });
    try {
      const file = `${root}/src/mod.ts` as AbsolutePath;
      await vitest.projects[0]?.vite.environments.ssr?.transformRequest(file);
      const stamps = new SourceStamps(new WorktreePaths(root));
      expect(await stamps.stale(vitest)).toEqual([file]);
      vitest.invalidateFile(file);
      // Attached now: the next load is stamped, and its bytes are those on disk.
      await vitest.projects[0]?.vite.environments.ssr?.transformRequest(file);
      expect(await stamps.stale(vitest)).toEqual([]);
    } finally {
      await vitest.close();
    }
  });

  it("does not complete a file whose run loaded bytes no longer on disk", async () => {
    const fx = await openFixture("basic", {
      "src/mod.ts": NEW,
      "test/reverting.test.ts": reverting,
      "test/mod.test.ts": readsTest("../src/mod.ts", "new"),
    });
    const reverted = ref("test/reverting.test.ts");
    const report = await fx.adapter.run([reverted], fx.runOptions());
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.failure).toMatch(/src\/mod\.ts changed on disk after this run loaded it/);
    expect(report.failure).not.toContain(fx.root);

    // The reverted transform is not served to the next run.
    const after = await fx.adapter.run([ref("test/mod.test.ts")], fx.runOptions());
    expect(outcomes(after)).toEqual(["pass"]);
  });

  it("completes a run whose module was only touched while it ran", async () => {
    const fx = await openFixture("basic", {
      "src/mod.ts": NEW,
      "test/touching.test.ts": [
        'import { utimesSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        'import { which } from "../src/mod.ts";',
        'it("touches the module", () => {',
        '  utimesSync(new URL("../src/mod.ts", import.meta.url), new Date(), new Date());',
        '  expect(which).toBe("new");',
        "});",
        "",
      ].join("\n"),
    });
    const touching = ref("test/touching.test.ts");
    const report = await fx.adapter.run([touching], fx.runOptions());
    expect(report.completedFiles).toEqual([touching]);
    expect(outcomes(report)).toEqual(["pass"]);
  });
});
