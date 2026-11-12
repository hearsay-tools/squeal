import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CiExport, ciExport } from "../../src/core/ci/export.js";
import { readPart } from "../../src/core/ci/parts.js";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import type { ExportHeader } from "../../src/core/store/imports.js";
import { exportResults } from "../../src/core/store/transfer.js";
import { decodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";
import { ci, cloneOf, committed, recordVitest, scratch } from "./fixture.js";

/*
 * Spec 018 D9 (row 018-17): `squeal ci export` in a fresh checkout of the
 * shards' commit keys each file as a daemon at that content does. Two shards
 * of one fixture are recorded with `CI=true`; a daemon runs the same fixture
 * in a clone of its own; the export of the parts, made in a third clone,
 * holds the same keys, closures and results as the daemon's `squeal export`,
 * with each file's `keyParts`. The fixture lives inside the repository, so
 * its Vitest resolves from the repository's `node_modules`.
 */

const NAMES = ["a", "b", "c", "d"];
const SQUEAL = "0.0.0-test";

/** Four test files, each reading its own data file and importing one source file. */
function fixture(dir: string): string {
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-export-fixture", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    "src/upper.ts": "export const upper = (text: string): string => text.toUpperCase();\n",
    ...Object.fromEntries(
      NAMES.flatMap((name) => [
        [`data/${name}.txt`, `${name}\n`],
        [
          `test/${name}.test.ts`,
          `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { upper } from "../src/upper.js";\nit("reads ${name}", () => {\n  expect(upper(readFileSync(new URL("../data/${name}.txt", import.meta.url), "utf8"))).toBe("${name.toUpperCase()}\\n");\n});\nit.skip("waits ${name}", () => {});\n`,
        ],
      ]),
    ),
  });
}

/** The parts of two shards of `root`, recorded as in CI. */
async function recordShards(root: string, out: string): Promise<void> {
  for (const shard of ["1/2", "2/2"]) {
    const recorded = await recordVitest(root, out, [`--shard=${shard}`]);
    expect(recorded.code, recorded.said).toBe(0);
  }
}

async function headerOf(root: string): Promise<ExportHeader> {
  const head = await readHead(root);
  return {
    squealVersion: SQUEAL,
    keyFormat: KEY_FORMAT_VERSION,
    commit: head.head,
    dirty: head.dirty,
    createdAt: Date.now(),
    source: { kind: "local" },
  };
}

/** `squeal export` of a daemon that ran every file of a clone of `origin`. */
async function daemonExport(origin: string): Promise<ResultsBundle> {
  const root = cloneOf(origin, "daemon");
  const common = join(root, ".git");
  const h = await openHarness(root, openRepoStore(common), common, { observe: true });
  await h.scheduler.start();
  await h.scheduler.requestFullSuite();
  await h.scheduler.idle();
  return exportResults(h.store, h.worktreeId as WorktreeId, await headerOf(root)).bundle;
}

/** `ciExport` of the parts in `out`, in a fresh clone of `origin`, as the daemon's harness keys. */
async function partsExport(origin: string, out: string): Promise<CiExport & { root: string }> {
  const root = cloneOf(origin, "export");
  const parts = readdirSync(out).map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return { file: name, part };
  });
  const store = openRepoStore(join(scratch("ci-export-store"), "common"));
  const exported = await ciExport({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    runner: () => createVitestAdapter({ root, observe: () => true }),
    policy: { ...DEFAULT_POLICY, observe: { runtimeInputs: true } },
    squealVersion: SQUEAL,
    env: process.env,
    parts,
    header: await headerOf(root),
    now: Date.now,
  });
  return { ...exported, root };
}

/**
 * The import's proof (018 D11, `transfer-rekey.ts`): the exported key comes
 * out of the file's own list over the commit's blobs, with the export's
 * environment hash and the file's key parts. The fixture lists no directory.
 */
async function proven(root: string, bundle: ResultsBundle): Promise<boolean[]> {
  const blobs = await committedBlobs(root, bundle.header.commit as string);
  const hash = new Map(bundle.environments.map((e) => [e.project, e.hash]));
  return bundle.testFiles.map((file) => {
    const segments = (file.closure?.paths ?? []).map((p) => encodeSegment(p, blobs.get(p) ?? null));
    const { dependencies, runtime } = file.keyParts ?? { dependencies: "", runtime: "" };
    const at = keyFromSegments(hash.get(file.project) ?? "", file, segments, dependencies, runtime);
    return at === file.key;
  });
}

describe("squeal ci export (spec 018 D9)", () => {
  it("keys the shards' files as a daemon that ran them, with each file's key parts", {
    timeout: 300_000,
  }, async () => {
    const origin = fixture(scratch("ci-export"));
    const out = join(dirname(origin), "parts");
    await recordShards(origin, out);
    expect(readdirSync(out)).toHaveLength(2);

    const daemon = await daemonExport(origin);
    const job = await partsExport(origin, out);
    if (!("bundle" in job)) throw new Error(job.refused.text);
    expect(job.counts, JSON.stringify(job.uncertified)).toEqual({
      testFiles: 4,
      results: 12,
      failed: 0,
      unkeyed: 0,
      uncertified: 0,
      ambiguous: 0,
      inspector: 0,
      unwatched: 0,
    });

    const files = (bundle: ResultsBundle) =>
      bundle.testFiles.map(({ keyParts: _parts, ...file }) => file);
    expect(daemon.testFiles.map((f) => f.path)).toEqual(NAMES.map((n) => `test/${n}.test.ts`));
    expect(files(job.bundle)).toEqual(files(daemon));
    for (const file of job.bundle.testFiles) {
      expect(file.closure?.paths).toContain(`data/${file.path.slice(5, 6)}.txt`);
      expect(file.closure?.paths).toContain("src/upper.ts");
      expect(file.keyParts).toEqual({ dependencies: expect.any(String), runtime: "" });
    }
    expect(await proven(job.root, job.bundle)).toEqual([true, true, true, true]);

    // The project's own run collects no test location (Squeal's instance sets `includeTaskLocation`).
    const results = (bundle: ResultsBundle) =>
      bundle.results.map(({ durationMs: _ms, location: _at, ...result }) => result);
    expect(results(job.bundle)).toEqual(results(daemon));
    expect(job.bundle.results.filter((r) => r.location !== null)).toEqual([]);
    expect(job.bundle.environments.map((e) => e.hash)).toEqual(
      daemon.environments.map((e) => e.hash),
    );
    expect(job.bundle.header.commit).toBe(daemon.header.commit);

    // The command: the same parts, keyed with this Squeal's version and policy, written gzipped.
    const written = join(dirname(origin), "results.json.gz");
    const command = await ci(["export", "--parts", out, "--out", written], job.root);
    expect(command.code, command.said).toBe(0);
    expect(command.said).toContain(`Exported 4 test files, 12 results, to ${written}.`);
    const decoded = decodeBundle(readFileSync(written));
    if (typeof decoded === "string") throw new Error(decoded);
    expect(decoded.testFiles.map((f) => f.path)).toEqual(daemon.testFiles.map((f) => f.path));
    expect(await proven(job.root, decoded)).toEqual([true, true, true, true]);
  });
});
