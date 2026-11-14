import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageProvider } from "../../src/core/code/coverage/runtime.js";
import type { VitestCoverageOptions } from "../../src/core/code/coverage/types.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { LOADED_MODULES_TABLE, type LoadedModule } from "../../src/core/store/loaded-modules.js";
import { connectionOf } from "../../src/core/store/store.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { onCleanUp, SLOW } from "./cleanup.js";
import { createRepo, openRepoStore, ref } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Spec 022 D1 to D3 (row 022-03), through the scheduler over a real Vitest
 * with Squeal's provider: each completed file's loaded list is stored at its
 * result key, and a module it loads only at run time joins its key, less
 * the setup files the environment holds and the paths its closure holds.
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
  await h.scheduler.idle();
  return h;
}

/** The stored lists of `path`: each key and its modules' paths. */
function listsOf(store: Store, path: string): { key: string; paths: string[] }[] {
  const conn = connectionOf(store);
  return conn
    .all(`SELECT key, modules FROM ${LOADED_MODULES_TABLE} WHERE project = '' AND path = ?`, path)
    .map((row) => ({
      key: String(row.key),
      paths: (JSON.parse(String(row.modules)) as LoadedModule[]).map((m) => m.path),
    }));
}

const closureOf = (h: Harness, path: string) =>
  h.store.testFiles.get(ref(path))?.closure.paths ?? [];

describe("scheduler: loaded modules (spec 022, row 022-03)", SLOW, () => {
  it("stores each file's list at its result key, setup files and runtime loads among them", async () => {
    const h = await started(true);
    const key = h.keyOf(RUNTIME);
    expect(key).not.toBeNull();
    const [list, ...more] = listsOf(h.store, RUNTIME);
    expect(more).toEqual([]);
    expect(list?.key).toBe(key);
    expect(list?.paths).toEqual([LAZY, ...SETUP, RUNTIME].sort());
    expect(h.store.results.byKey(key ?? "").length).toBeGreaterThan(0);
    // Each module with its blob id at the run.
    const conn = connectionOf(h.store);
    const row = conn.get(`SELECT modules FROM ${LOADED_MODULES_TABLE} WHERE path = ?`, RUNTIME);
    for (const module of JSON.parse(String(row?.modules)) as LoadedModule[]) {
      expect(module.hash).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("joins a module loaded only at run time to the key: an edit to it re-runs the file", async () => {
    const h = await started(true);
    expect(closureOf(h, RUNTIME)).toContain(LAZY);
    const before = h.keyOf(RUNTIME);
    const runtimeRuns = h.runsOf(RUNTIME).length;
    const plainRuns = h.runsOf(PLAIN).length;
    h.write(LAZY, "export const value = 1;\n// edited\n");
    await h.batch(LAZY);
    await h.scheduler.idle();
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
    expect(listsOf(h.store, PLAIN)[0]?.paths).toEqual(["src/math.ts", ...SETUP, PLAIN].sort());
    const observed = JSON.parse(h.store.meta.get(observedMetaKey("")) ?? "{}") as object;
    expect(Object.keys(observed)).not.toContain(PLAIN);
    expect(closureOf(h, PLAIN)).not.toContain(LAZY);
  });

  it("joins nothing with policy observe.runtimeInputs off, and stores the lists all the same", async () => {
    const h = await started(false);
    expect(closureOf(h, RUNTIME)).not.toContain(LAZY);
    expect(listsOf(h.store, RUNTIME)[0]?.paths).toContain(LAZY);
    expect(listsOf(h.store, RUNTIME)[0]?.key).toBe(h.keyOf(RUNTIME));
  });
});
