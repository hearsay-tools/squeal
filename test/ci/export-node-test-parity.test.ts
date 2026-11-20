import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CiExport, ciExport } from "../../src/core/ci/export.js";
import { readPart } from "../../src/core/ci/parts.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { exportResults } from "../../src/core/store/transfer.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY, type NodeTestProject, type Policy } from "../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";
import { headerOf, SQUEAL } from "./export-harness.js";
import { cloneOf, committed, recordVitest, scratch } from "./fixture.js";
import { recordNodeTest } from "./node-test-parts.js";

/*
 * Spec 018 D26 (row 018-48): `ci export` of node:test parts, made in a
 * CI-shaped clone (another path, another temp directory), in a third
 * clone, keys each node:test file as a daemon that ran the same content
 * keys it: the same keys, closures, results and environment as the
 * daemon's `squeal export`. Its import into a developer clone makes every
 * node:test file current there: the daemon runs none of them. Vitest parts
 * beside them export as they do alone. A part of another Node leaves out
 * its entry and names why. The node:test parts are made from a real run of
 * the adapter (`node-test-parts.ts`), as 018-47's recorder writes them.
 */

const UNIT: NodeTestProject = {
  name: "unit",
  argv: [],
  env: { FIXTURE_MODE: "ci" },
  include: ["nt/*.test.mjs"],
};

function fixture(dir: string): string {
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-export-node-test", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    "squeal.config.json": JSON.stringify({ nodeTest: [UNIT] }),
    "src/upper.mjs": "export const upper = (text) => text.toUpperCase();\n",
    "data/b.txt": "b\n",
    "nt/a.test.mjs": `import { test } from "node:test";\nimport assert from "node:assert";\nimport { upper } from "../src/upper.mjs";\ntest("upper", () => assert.equal(upper("a"), "A"));\ntest.skip("waits", () => {});\n`,
    "nt/b.test.mjs": `import { test } from "node:test";\nimport assert from "node:assert";\nimport { readFileSync } from "node:fs";\ntest("reads", () => assert.equal(readFileSync(new URL("../data/b.txt", import.meta.url), "utf8"), "b\\n"));\ntest("sees the mode", () => assert.equal(process.env.FIXTURE_MODE, "ci"));\n`,
    "test/v.test.ts": `import { expect, it } from "vitest";\nimport { upper } from "../src/upper.mjs";\nit("upper", () => expect(upper("v")).toBe("V"));\n`,
  });
}

function policy(): Policy {
  return {
    ...DEFAULT_POLICY,
    observe: { runtimeInputs: true },
    nodeTest: [UNIT],
    baseline: { onStart: "lookup-then-run-missing" },
  };
}

/** A node:test adapter that counts the files it runs. */
async function counted(root: string, ran: string[]): Promise<RunnerAdapter> {
  const adapter = await createNodeTestAdapter(UNIT, { root });
  return {
    ...adapter,
    run: (files: readonly TestFileRef[], options) => {
      ran.push(...files.map((f) => f.path));
      return adapter.run(files, options);
    },
  };
}

/** A daemon in a clone of `origin` named `name`, with `UNIT` beside Vitest; its store's import of `bundle` first, when given. */
async function daemon(origin: string, name: string, bundle?: ResultsBundle) {
  const root = cloneOf(origin, name);
  const common = join(root, ".git");
  const store = openRepoStore(common);
  if (bundle !== undefined) {
    importResults(store, bundle, { importId: "ci", fileHash: "h", now: Date.now() });
  }
  const ran: string[] = [];
  const h = await openHarness(root, store, common, {
    observe: true,
    policy: policy(),
    parts: async () => [await counted(root, ran)],
  });
  return { root, h, ran };
}

/** `ciExport` of the parts in `out` in a fresh clone of `origin`, with the adapters the parts need. */
async function exported(
  origin: string,
  out: string,
  name: string,
  runners: { vitest: boolean; nodeTest: boolean },
): Promise<CiExport> {
  const root = cloneOf(origin, name);
  const parts = readdirSync(out).map((file) => {
    const part = readPart(join(out, file));
    if (typeof part === "string") throw new Error(part);
    return { file, part };
  });
  return ciExport({
    root,
    worktreeId: worktreeIdFor(root),
    store: openRepoStore(join(scratch("ci-export-store"), "common")),
    runners: async () => [
      ...(runners.vitest ? [await createVitestAdapter({ root, observe: () => true })] : []),
      ...(runners.nodeTest ? [await createNodeTestAdapter(UNIT, { root })] : []),
    ],
    policy: policy(),
    squealVersion: SQUEAL,
    env: process.env,
    parts,
    header: await headerOf(root),
    now: Date.now,
  });
}

const bundleOf = (job: CiExport): ResultsBundle => {
  if (!("bundle" in job)) throw new Error(job.refused.text);
  return job.bundle;
};

const files = (bundle: ResultsBundle, project: string) =>
  bundle.testFiles.filter((f) => f.project === project).map(({ keyParts: _p, ...file }) => file);
const results = (bundle: ResultsBundle, project: string) =>
  bundle.results.filter((r) => r.project === project).map(({ durationMs: _ms, ...r }) => r);
const environment = (bundle: ResultsBundle, project: string) =>
  bundle.environments.find((e) => e.project === project)?.hash;

describe("ci export of node:test parts (spec 018 D26)", () => {
  it("keys them as a daemon that ran the same content, beside Vitest's, and an import makes them current", {
    timeout: 300_000,
  }, async () => {
    const origin = fixture(scratch("ci-export-node-test"));
    const base = dirname(origin);
    const out = join(base, "parts");
    const ci = cloneOf(origin, "ci");
    const recorded = await recordVitest(ci, out);
    expect(recorded.code, recorded.said).toBe(0);
    const vitestOnly = join(base, "vitest-parts");
    mkdirSync(vitestOnly);
    for (const name of readdirSync(out)) copyFileSync(join(out, name), join(vitestOnly, name));
    await recordNodeTest(ci, UNIT, out, {});

    const made = await daemon(origin, "daemon");
    await made.h.scheduler.start();
    await made.h.scheduler.requestFullSuite();
    await made.h.quiet();
    expect(made.ran.sort()).toEqual(["nt/a.test.mjs", "nt/b.test.mjs"]);
    const header = await headerOf(made.root);
    const { bundle: daemonBundle } = exportResults(
      made.h.store,
      made.h.worktreeId as WorktreeId,
      header,
    );

    const job = await exported(origin, out, "export", { vitest: true, nodeTest: true });
    const mixed = bundleOf(job);
    if (!("counts" in job)) throw new Error("refused");
    expect(job.nodeTestLines).toEqual([]);
    expect(job.counts).toMatchObject({ testFiles: 3, nodeTestLeftOut: 0, uncertified: 0 });

    expect(files(mixed, "unit").map((f) => f.path)).toEqual(["nt/a.test.mjs", "nt/b.test.mjs"]);
    expect(files(mixed, "unit")).toEqual(files(daemonBundle, "unit"));
    expect(results(mixed, "unit")).toEqual(results(daemonBundle, "unit"));
    expect(environment(mixed, "unit")).toBe(environment(daemonBundle, "unit"));
    expect(files(mixed, "")).toEqual(files(daemonBundle, ""));

    // Vitest's part exports as it does with no node:test part beside it.
    const alone = bundleOf(
      await exported(origin, vitestOnly, "export-vitest", { vitest: true, nodeTest: false }),
    );
    expect(files(mixed, "")).toEqual(files(alone, ""));
    expect(results(mixed, "")).toEqual(results(alone, ""));
    expect(environment(mixed, "")).toBe(environment(alone, ""));

    // A developer clone that imports the export runs none of the node:test files.
    const dev = await daemon(origin, "developer", mixed);
    await dev.h.scheduler.start();
    await dev.h.quiet();
    expect(dev.ran).toEqual([]);
    // The control: without the import, a developer clone runs both.
    const plain = await daemon(origin, "plain");
    await plain.h.scheduler.start();
    await plain.h.quiet();
    expect(plain.ran.sort()).toEqual(["nt/a.test.mjs", "nt/b.test.mjs"]);
  });

  it("leaves out an entry whose part ran on another Node, naming both versions", {
    timeout: 120_000,
  }, async () => {
    const origin = fixture(scratch("ci-export-node-test-other"));
    const out = join(dirname(origin), "parts");
    await recordNodeTest(cloneOf(origin, "ci"), UNIT, out, { version: "v1.0.0" });
    const job = await exported(origin, out, "export", { vitest: false, nodeTest: true });
    if (!("counts" in job)) throw new Error(job.refused.text);
    expect(job.counts).toMatchObject({ testFiles: 0, nodeTestLeftOut: 2 });
    expect(job.nodeTestLines).toEqual([
      `node:test ran on Node v1.0.0; project "unit" runs ${process.version} here: left out (2 test files)`,
    ]);
  });
});
