import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import { decodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { daemonExport, partsExport } from "./export-harness.js";
import { ci, committed, recordVitest, scratch } from "./fixture.js";

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

    const { bundle: daemon } = await daemonExport(origin);
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

    // `ci record` collects each test's location, as Squeal's instance does (row 018-43).
    const results = (bundle: ResultsBundle) =>
      bundle.results.map(({ durationMs: _ms, ...result }) => result);
    expect(results(job.bundle)).toEqual(results(daemon));
    expect(job.bundle.results.filter((r) => r.kind === "test" && r.location === null)).toEqual([]);
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
