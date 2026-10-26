import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type CoverageRun, coverageProvider } from "../../../src/core/code/coverage/index.js";
import type { RunnerAdapter } from "../../../src/core/types/index.js";
import { createVitestAdapter, type VitestCoverage } from "../../../src/runners/vitest/index.js";
import { openFixture, outcomes, ref, SLOW } from "./helpers.js";

/*
 * Row 015-70 (gh-102): a provider that fails to load in a test worker costs
 * coverage, never a verdict. The forced failure is the one gh-102 met: a
 * client environment loads no file outside `server.fs.allow`, and this
 * provider imports a sibling Squeal does not allow, so each worker fails
 * "Failed to load custom CoverageProviderModule", caused by
 * ERR_MODULE_NOT_FOUND, while the main process loads it. The provider file
 * itself is allowed (row 013-08).
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Failing {
  readonly coverage: VitestCoverage;
  readonly sibling: string;
  readonly notes: string[];
  readonly runs: CoverageRun[];
  readonly create: (root: string, variant?: string) => Promise<RunnerAdapter>;
}

function failing(): Failing {
  const provider = coverageProvider();
  if (provider === null) throw new Error("no coverage provider beside the sources");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-own-provider-failed-")));
  temps.push(dir);
  const sibling = join(dir, "sibling.mjs");
  writeFileSync(
    sibling,
    `export { default } from ${JSON.stringify(pathToFileURL(provider).href)};\n`,
  );
  // Computed, so Vite's import analysis adds no safe path for it (a static import would), and
  // not `new URL(..., import.meta.url)`, which Vite's client transform rewrites to `self`. A
  // worker given a variant imports `sibling-<variant>.mjs`, which does not exist: its own cause.
  writeFileSync(
    join(dir, "provider.mjs"),
    [
      "const variant = process.env.SQUEAL_TEST_VARIANT;",
      'const name = variant === undefined ? "sibling.mjs" : "sibling-" + variant + ".mjs";',
      "const sibling = import.meta.url.replace(/provider\\.mjs$/, name);",
      "const { default: provider } = await import(/* @vite-ignore */ sibling);",
      "export default provider;",
      "",
    ].join("\n"),
  );
  const notes: string[] = [];
  const runs: CoverageRun[] = [];
  const coverage: VitestCoverage = {
    enabled: () => true,
    provider: join(dir, "provider.mjs"),
    tempDir: join(dir, "temp"),
    collected: (run) => runs.push(run),
  };
  const create = (root: string, variant?: string) =>
    createVitestAdapter({
      root,
      note: (text) => notes.push(text),
      coverage,
      ...(variant === undefined ? {} : { childEnv: { SQUEAL_TEST_VARIANT: variant } }),
    });
  return { coverage, sibling, notes, runs, create };
}

const fixture = (path: string) =>
  readFileSync(
    join(resolve(import.meta.dirname, "../../fixtures/vitest/client-env"), path),
    "utf8",
  );

/** The client project in a config of its own, as Cezar's `packages/web` is. */
const SEPARATE_PROJECT: Readonly<Record<string, string>> = {
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    'export default defineConfig({ test: { projects: ["./web/vitest.config.ts"] } });',
    "",
  ].join("\n"),
  "web/vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    "export default defineConfig({",
    '  test: { name: "web", include: ["test/**/*.test.ts"], environment: "./client-env.ts" },',
    "});",
    "",
  ].join("\n"),
  "web/client-env.ts": fixture("client-env.ts"),
  "web/test/plain.test.ts": fixture("test/plain.test.ts"),
};

const ROOT = { name: "the root project", files: {}, test: ref("test/plain.test.ts") };
const SEPARATE = {
  name: "a project of its own config",
  files: SEPARATE_PROJECT,
  test: ref("web/test/plain.test.ts", "web"),
};

describe("vitest adapter: a coverage provider that fails to load in the workers", SLOW, () => {
  it.each([ROOT, SEPARATE])(
    "turns coverage off once, names the cause, and the next run gives verdicts: $name",
    async ({ files, test }) => {
      const forced = failing();
      const fx = await openFixture("client-env", files, forced.create);
      // The scheduler's keys hold the coverage the instance started with.
      const keyed = await fx.adapter.environment();

      const crashed = await fx.adapter.run([test], fx.runOptions());

      expect(crashed.end).toBe("crashed");
      expect(crashed.results).toEqual([]);
      const cause = `Cannot find module '${pathToFileURL(forced.sibling).href}'`;
      const [first] = crashed.failure?.split("\n") ?? [];
      expect(first).toMatch(/^coverage is off until the daemon restarts: /);
      expect(first).toContain(cause);
      expect(first).toContain("(ERR_MODULE_NOT_FOUND)");
      expect(forced.notes).toEqual([first]);
      // Those keys re-key once: the projects count as recreated, as at a policy change.
      expect((await fx.adapter.recheck?.())?.recreatedProjects).toEqual([test.project]);
      const rekeyed = await fx.adapter.environment();
      expect(rekeyed.map((e) => e.resolvedConfig)).not.toEqual(keyed.map((e) => e.resolvedConfig));
      expect((await fx.adapter.recheck?.())?.recreatedProjects).toEqual([]);

      const again = await fx.adapter.run([test], fx.runOptions());

      expect(again.failure).toBeNull();
      expect(outcomes(again)).toEqual(["pass"]);
      expect(forced.runs).toEqual([]);
      expect(forced.notes).toHaveLength(1);
    },
  );

  it("keeps coverage off in a later adapter on the same coverage, as a slow pass's", async () => {
    const forced = failing();
    const fast = await openFixture("client-env", {}, forced.create);
    await fast.adapter.run([ROOT.test], fast.runOptions());
    expect(forced.notes).toHaveLength(1);

    const slow = await openFixture("client-env", {}, forced.create);
    const report = await slow.adapter.run([ROOT.test], slow.runOptions());

    expect(report.failure).toBeNull();
    expect(outcomes(report)).toEqual(["pass"]);
    expect(forced.notes).toHaveLength(1);
  });

  // Review 0.1.349 S1 (row 015-72): the daemon's fast and slow instances, both open with coverage
  // on, fail at once with different causes.
  it("notes once when two adapters on the same coverage fail at once, each run with its own cause", async () => {
    const forced = failing();
    const fast = await openFixture("client-env", {}, (root) => forced.create(root, "fast"));
    const slow = await forced.create(fast.root, "slow");
    try {
      await Promise.all([fast.adapter.environment(), slow.environment()]);

      const reports = await Promise.all([
        fast.adapter.run([ROOT.test], fast.runOptions()),
        slow.run([ROOT.test], fast.runOptions()),
      ]);

      expect(reports.map((r) => r.end)).toEqual(["crashed", "crashed"]);
      const firsts = reports.map((r) => r.failure?.split("\n")[0] ?? "");
      for (const [i, variant] of ["fast", "slow"].entries()) {
        const sibling = pathToFileURL(join(dirname(forced.sibling), `sibling-${variant}.mjs`));
        expect(firsts[i]).toMatch(/^coverage is off until the daemon restarts: /);
        expect(firsts[i]).toContain(`Cannot find module '${sibling.href}'`);
      }
      expect(forced.notes).toHaveLength(1);
      expect(firsts).toContain(forced.notes[0]);
    } finally {
      await slow.close();
    }
  });

  it("stays off when a config change recreates the instance", async () => {
    const forced = failing();
    const fx = await openFixture("client-env", {}, forced.create);
    await fx.adapter.run([ROOT.test], fx.runOptions());
    fx.write("vitest.config.ts", `${fx.read("vitest.config.ts")}// edited\n`);

    const { recreatedProjects } = await fx.adapter.invalidate([
      { path: "vitest.config.ts", kind: "change" },
    ]);
    const report = await fx.adapter.run([ROOT.test], fx.runOptions());

    expect(recreatedProjects).toEqual([""]);
    expect(report.failure).toBeNull();
    expect(outcomes(report)).toEqual(["pass"]);
    expect(forced.notes).toHaveLength(1);
  });
});
