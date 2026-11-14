import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { openDaemonKeying } from "../../src/core/scheduler/daemon-keying.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import type { ProjectName, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { recordCovered } from "../runners/vitest/ci-coverage-kit.js";
import { openRepoStore } from "../scheduler/repo.js";
import {
  adapterOptions,
  daemonExport,
  type ParityOptions,
  partsExport,
  policyOf,
  SQUEAL,
} from "./export-harness.js";
import { cloneOf, committed, scratch } from "./fixture.js";

/*
 * Spec 022 D2 with 018 D9 and row 020-51 (review of 0.1.493 B1): a test
 * file that imports a module by a name built at runtime loads it with no
 * edge in the transform graph. With coverage on, the daemon's key holds it
 * through the file's loaded list; `ci record` carries the same list into
 * the part and `ci export` joins it as the daemon does, so the daemon, the
 * gate's stores lookup and the export give one key. The project's setup
 * file, and what it imports, is in every list and joins no closure: the
 * environment hash holds it. With policy `observe.runtimeInputs` off no
 * list joins either key.
 */

const REF: TestFileRef = { project: "" as ProjectName, path: "test/a.test.ts" as RelativePath };

function fixture(dir: string, observe: boolean): string {
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-loaded-fixture", private: true, type: "module" }),
    "squeal.config.json": JSON.stringify({ observe: { runtimeInputs: observe } }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"] } });\n`,
    "src/lazy.ts": "export const value = 1;\n",
    "src/env.ts": "export const env = 2;\n",
    "test/setup.ts": 'import "../src/env.js";\n',
    "test/a.test.ts": [
      'import { expect, it } from "vitest";',
      'it("loads a module named at runtime", async () => {',
      '  const p = ["..", "src", ["la", "zy.ts"].join("")].join("/");',
      "  const m = await import(/* @vite-ignore */ p);",
      "  expect(m.value).toBe(1);",
      "});",
      "",
    ].join("\n"),
  });
}

/** The key the gate's stores lookup gives `REF` in a clone of `origin`, from the daemon's observed rows. */
async function gateKey(origin: string, daemon: Store, options: ParityOptions): Promise<string> {
  const root = cloneOf(origin, "gate");
  const adapter = await createVitestAdapter(adapterOptions(root, options));
  try {
    const keying = await openDaemonKeying({
      root,
      worktreeId: worktreeIdFor(root),
      store: openRepoStore(join(scratch("ci-gate-store"), "common")),
      policy: policyOf(options),
      squealVersion: SQUEAL,
      env: process.env,
      adapters: [adapter],
      observedFrom: daemon,
    });
    await keying.keyFiles([REF]);
    return keying.keys.index.key(REF) ?? "(no key)";
  } finally {
    await adapter.close();
  }
}

/** The one file of `bundle`: its key and closure. */
function only(bundle: ResultsBundle): { key: string; paths: readonly string[] } {
  expect(bundle.testFiles.map((f) => f.path)).toEqual([REF.path]);
  const [file] = bundle.testFiles;
  return { key: file?.key ?? "", paths: file?.closure?.paths ?? [] };
}

async function keysOf(observe: boolean) {
  const options = { observe, coverage: true };
  const origin = fixture(scratch("ci-export-loaded"), observe);
  const out = join(dirname(origin), "parts");
  // From the sources no records' worker sits beside the CLI: the sources' own (`TS_WORKER`).
  const recorded = await recordCovered(origin, out, [], undefined, { ...process.env, CI: "true" });
  expect(recorded.code, recorded.said).toBe(0);
  expect(recorded.parts.map((p) => p.header.coverage)).toEqual([
    expect.objectContaining({ provider: "squeal" }),
  ]);

  const daemon = await daemonExport(origin, options);
  const job = await partsExport(origin, out, options);
  if (!("bundle" in job)) throw new Error(job.refused.text);
  expect(job.counts.testFiles, JSON.stringify(job.uncertified)).toBe(1);
  // The export carries no loaded list (spec 022 D3: CI export and import carry none).
  expect(Object.keys(job.bundle)).toEqual(Object.keys(daemon.bundle));
  // The same files, closures, keys and observed entries as the daemon's export.
  const files = (bundle: ResultsBundle) =>
    bundle.testFiles.map(({ keyParts: _parts, ...file }) => file);
  expect(files(job.bundle)).toEqual(files(daemon.bundle));
  return {
    daemon: only(daemon.bundle),
    ci: only(job.bundle),
    gate: await gateKey(origin, daemon.store, options),
  };
}

describe("ci export of a file that loads a module at runtime (spec 022 D2, review of 0.1.493 B1)", () => {
  it("keys it as the daemon and the gate do, the setup file in neither closure", {
    timeout: 300_000,
  }, async () => {
    const { daemon, ci, gate } = await keysOf(true);
    expect(daemon.paths).toContain("src/lazy.ts");
    for (const environment of ["test/setup.ts", "src/env.ts"]) {
      expect(daemon.paths).not.toContain(environment);
    }
    expect(ci.paths).toEqual(daemon.paths);
    expect(ci.key).toBe(daemon.key);
    expect(gate).toBe(daemon.key);
  });

  it("joins no loaded module with policy observe.runtimeInputs off", {
    timeout: 300_000,
  }, async () => {
    const { daemon, ci, gate } = await keysOf(false);
    expect(daemon.paths).not.toContain("src/lazy.ts");
    expect(ci.paths).toEqual(daemon.paths);
    expect(ci.key).toBe(daemon.key);
    expect(gate).toBe(daemon.key);
  });
});
