import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll } from "vitest";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import {
  DEFAULT_POLICY,
  type RunnerAdapter,
  type RunOptions,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createVitestAdapter, VITEST_ADAPTER_VERSION } from "../../src/runners/vitest/index.js";
import { git } from "../hash/git-repo.js";
import type { Harness, HarnessOptions } from "../scheduler/helpers.js";

/*
 * Fixture repositories for the source-stamp regressions (tasks 001-146,
 * 001-151, 001-154, 001-157): `src/mod.ts` holds `OLD` on disk, and each
 * test expects `NEW`, so the bytes on disk fail and a transient rewrite
 * passes.
 */

/** Inside the repository, so the fixture resolves `vitest` from its `node_modules`. Git-ignored. */
const scratch = join(
  resolve(import.meta.dirname, "../fixtures/vitest/.tmp"),
  `stamps-${randomUUID()}`,
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

export const NEW = 'export const which = "new";\n';
export const OLD = 'export const which = "old";\n';

/** A test file that imports `which` from `specifier` and expects the transient bytes. */
export const readsNew = (specifier: string) =>
  [
    'import { expect, it } from "vitest";',
    `import { which } from "${specifier}";`,
    'it("restored bytes", () => expect(which).toBe("new"));',
    "",
  ].join("\n");

export const BASE: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "stamps", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"] } });\n`,
  "src/mod.ts": OLD,
};

export function createRepo(files: Readonly<Record<string, string>>): {
  main: string;
  commonDir: string;
} {
  const main = join(scratch, randomUUID());
  for (const [path, text] of Object.entries(files)) {
    if (text === "") continue;
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  return { main: realpathSync(main), commonDir: realpathSync(join(main, ".git")) };
}

/** `refs` run once under a fresh adapter on the bytes on disk: each result's project and outcome. */
export async function freshOutcomes(root: string, refs: readonly TestFileRef[]) {
  const adapter = await createVitestAdapter({ root });
  try {
    const report = await adapter.run(refs, {
      runId: randomUUID(),
      logDir: join(root, ".squeal-logs"),
      timeoutMs: null,
    });
    return report.results.map((r) => [r.check.project, r.check.testPath, r.outcome]).sort();
  } finally {
    await adapter.close();
  }
}

/** Each stored `test` check: project, path, validity and outcome. */
export const stored = (h: Harness) =>
  h.sink
    .states()
    .filter((s) => s.check.kind === "test")
    .map((s) => [s.check.project, s.check.testPath, s.validity, s.outcome])
    .sort();

/** Options for a run of the adapter outside the scheduler, as a warm-up. */
export const warmOptions = (root: string): RunOptions => ({
  runId: randomUUID(),
  logDir: join(root, ".squeal-logs"),
  timeoutMs: null,
});

/** Harness options that send `slow` to the slow lane, in a slot directory of its own. */
export function slowOptions(slow: readonly string[]): HarnessOptions & { slotDir: string } {
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-stamps-slot-"));
  return {
    slotDir,
    tierSize: 4,
    policy: { slow: { ...DEFAULT_POLICY.slow, include: [...slow] } },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  };
}

/**
 * Spec 004 D2 (task 004-18): slow files run in a Vitest instance of their
 * own, made per pass, as the daemon composes it. `prepare` gets each slow
 * adapter before the scheduler's first slow run does, so a test can plant a
 * transform in that instance's own cache. Returns how many were made.
 */
export function withSlowLanes(
  h: Harness,
  root: string,
  slotDir: string,
  prepare: (adapter: RunnerAdapter) => Promise<void>,
): { made: () => number } {
  let made = 0;
  const lanes = withSlowInstance({ ...h.runner }, () =>
    createRecoveringRunner({
      name: "vitest",
      adapterVersion: VITEST_ADAPTER_VERSION,
      create: async () => {
        made += 1;
        const adapter = await createVitestAdapter({ root });
        await prepare(adapter);
        return adapter;
      },
      onFailure: (text) => h.errors.push(new Error(text)),
    }),
  );
  h.runner.run = lanes.run;
  h.runner.invalidate = lanes.invalidate;
  h.runner.releaseLane = (lane) => lanes.releaseLane?.(lane) ?? Promise.resolve();
  h.runner.close = async () => {
    await lanes.close();
    rmSync(slotDir, { recursive: true, force: true });
  };
  return { made: () => made };
}
