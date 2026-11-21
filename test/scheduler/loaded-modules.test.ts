import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageProvider } from "../../src/core/code/coverage/runtime.js";
import type { VitestCoverageOptions } from "../../src/core/code/coverage/types.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { hasLoadedModulesTable } from "../../src/core/store/loaded-modules.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { onCleanUp, SLOW } from "./cleanup.js";
import { createRepo, openRepoStore, ref } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Spec 022 D1 to D3 (rows 022-03, 022-05), through the scheduler over a
 * real Vitest with Squeal's provider: a module a file loads only at run
 * time joins its key, less the setup files the environment holds and the
 * paths its closure holds. No list is stored (D3 amended 2026-11-21).
 */

const RUNTIME = "test/runtime.test.ts";
const PLAIN = "test/plain.test.ts";
const LAZY = "src/lazy.ts";
const SETUP = ["src/setup-helper.ts", "test/setup.ts"];

function coverage(): VitestCoverageOptions {
  const provider = coverageProvider();
  if (provider === null) throw new Error("no coverage provider beside the sources");
  const tempDir = mkdtempSync(join(tmpdir(), "sq-loaded-"));
  onCleanUp(() => rmSync(tempDir, { recursive: true, force: true }));
  return { enabled: () => true, provider, tempDir, collected: () => {} };
}

async function started(observe: boolean): Promise<Harness> {
  const repo = createRepo("loaded");
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    observe: true,
    coverage: coverage(),
    policy: { ...RUN_MISSING, observe: { ...DEFAULT_POLICY.observe, runtimeInputs: observe } },
  });
  await h.scheduler.start();
  await h.quiet();
  return h;
}

const closureOf = (h: Harness, path: string) =>
  h.store.testFiles.get(ref(path))?.closure.paths ?? [];

describe("scheduler: loaded modules (spec 022, row 022-03)", SLOW, () => {
  it("stores no list, and the file's results are at its key", async () => {
    const h = await started(true);
    const key = h.keyOf(RUNTIME);
    expect(key).not.toBeNull();
    expect(h.store.results.byKey(key ?? "").length).toBeGreaterThan(0);
    expect(hasLoadedModulesTable(connectionOf(h.store))).toBe(false);
  });

  it("joins a module loaded only at run time to the key: an edit to it re-runs the file", async () => {
    const h = await started(true);
    expect(closureOf(h, RUNTIME)).toContain(LAZY);
    const before = h.keyOf(RUNTIME);
    const runtimeRuns = h.runsOf(RUNTIME).length;
    const plainRuns = h.runsOf(PLAIN).length;
    h.write(LAZY, "export const value = 1;\n// edited\n");
    await h.batch(LAZY);
    await h.quiet();
    expect(h.keyOf(RUNTIME)).not.toBe(before);
    expect(h.runsOf(RUNTIME).length).toBe(runtimeRuns + 1);
    expect(h.runsOf(PLAIN).length).toBe(plainRuns);
  });

  it("adds no setup file through a list, and nothing for a file whose list is in its closure", async () => {
    const h = await started(true);
    for (const path of SETUP) {
      expect(closureOf(h, RUNTIME)).not.toContain(path);
      expect(closureOf(h, PLAIN)).not.toContain(path);
    }
    // Plain's list is its closure and the setup files: nothing observed, its key as without lists.
    expect(closureOf(h, PLAIN)).toContain("src/math.ts");
    const observed = JSON.parse(h.store.meta.get(observedMetaKey("")) ?? "{}") as object;
    expect(Object.keys(observed)).not.toContain(PLAIN);
    expect(closureOf(h, PLAIN)).not.toContain(LAZY);
  });

  it("joins nothing with policy observe.runtimeInputs off", async () => {
    const h = await started(false);
    expect(closureOf(h, RUNTIME)).not.toContain(LAZY);
    expect(hasLoadedModulesTable(connectionOf(h.store))).toBe(false);
  });
});
