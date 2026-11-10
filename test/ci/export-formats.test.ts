import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CiExport, ciExport } from "../../src/core/ci/export.js";
import { type Part, readPart } from "../../src/core/ci/parts.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { recordCovered } from "../runners/vitest/ci-coverage-kit.js";
import { openRepoStore } from "../scheduler/repo.js";
import { cloneOf, committed, scratch } from "./fixture.js";

/*
 * Spec 020 D13.3 (row 020-08a): exports do not change. Two shards recorded
 * with Squeal's provider write `squeal-ci-part/4` parts with records; the
 * same shards recorded without it, read as format 3 parts, export to the
 * same bundle: the same files, keys, closures and results. Records travel
 * in parts only; D10 of 018 lets the shards' coverage options differ.
 */

const SQUEAL = "0.0.0-test";
const NAMES = ["a", "b", "c", "d"];

function fixture(dir: string): string {
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-formats-fixture", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    "src/upper.ts": "export const upper = (text: string): string => text.toUpperCase();\n",
    ...Object.fromEntries(
      NAMES.flatMap((name) => [
        [`data/${name}.txt`, `${name}\n`],
        [
          `test/${name}.test.ts`,
          `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { upper } from "../src/upper.js";\nit("reads ${name}", () => {\n  expect(upper(readFileSync(new URL("../data/${name}.txt", import.meta.url), "utf8"))).toBe("${name.toUpperCase()}\\n");\n});\n`,
        ],
      ]),
    ),
  });
}

/** The parts of two shards of `root` in `out`, with the provider or without it. */
async function shards(root: string, out: string, provider: boolean): Promise<Part[]> {
  const env = { ...process.env, CI: "true" };
  for (const shard of ["1/2", "2/2"]) {
    const deps = provider ? undefined : {};
    const run = await recordCovered(root, out, [`--shard=${shard}`], deps, env);
    expect(run.code, run.said).toBe(0);
  }
  return readdirSync(out).map((name) => readPart(join(out, name)) as Part);
}

/** Each part in `out` as format 3 wrote it: no coverage header, records or reasons, and no cost (row 018-29). */
function asFormat3(out: string): void {
  for (const name of readdirSync(out)) {
    const file = join(out, name);
    const part = JSON.parse(readFileSync(file, "utf8")) as Part;
    const { coverage: _header, cost: _cost, ...header } = part.header;
    const { coverage: _records, ...rest } = part;
    const testFiles = part.testFiles.map(({ record: _r, noRecord: _n, ...f }) => f);
    writeFileSync(file, JSON.stringify({ ...rest, format: "squeal-ci-part/3", header, testFiles }));
  }
}

async function exportOf(origin: string, out: string, name: string): Promise<ResultsBundle> {
  const root = cloneOf(origin, name);
  const parts = readdirSync(out).map((file) => {
    const part = readPart(join(out, file));
    if (typeof part === "string") throw new Error(part);
    return { file, part };
  });
  const head = await readHead(root);
  const exported: CiExport = await ciExport({
    root,
    worktreeId: worktreeIdFor(root),
    store: openRepoStore(join(scratch(`ci-formats-store-${name}`), "common")),
    runner: () => createVitestAdapter({ root, observe: () => true }),
    policy: { ...DEFAULT_POLICY, observe: { runtimeInputs: true } },
    squealVersion: SQUEAL,
    env: process.env,
    parts,
    header: {
      squealVersion: SQUEAL,
      keyFormat: KEY_FORMAT_VERSION,
      commit: head.head,
      dirty: head.dirty,
      createdAt: 0,
      source: { kind: "local" },
    },
    now: () => 0,
  });
  if (!("bundle" in exported)) throw new Error(exported.refused.text);
  expect(exported.counts).toMatchObject({ testFiles: 4, uncertified: 0, inspector: 0 });
  return exported.bundle;
}

describe("squeal ci export of format 3 and format 4 parts (spec 020 D13.3)", () => {
  it("gives the same bundle, with or without each part's cost (row 018-29)", {
    timeout: 300_000,
  }, async () => {
    const origin = fixture(scratch("ci-formats"));
    const four = join(dirname(origin), "parts-4");
    const three = join(dirname(origin), "parts-3");
    const recorded = await shards(origin, four, true);
    expect(recorded.map((p) => p.format)).toEqual(["squeal-ci-part/4", "squeal-ci-part/4"]);
    expect(recorded.flatMap((p) => p.testFiles.map((f) => f.record !== undefined))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    // Row 018-29: what recording cost, the provider's work included, beside the records.
    for (const part of recorded) expect(part.header.cost?.hooksMs).toBeGreaterThan(0);
    await shards(origin, three, false);
    asFormat3(three);
    expect(readdirSync(three).map((n) => (readPart(join(three, n)) as Part).format)).toEqual([
      "squeal-ci-part/3",
      "squeal-ci-part/3",
    ]);

    const fromFour = await exportOf(origin, four, "export-4");
    const fromThree = await exportOf(origin, three, "export-3");
    const durationless = (bundle: ResultsBundle) => ({
      ...bundle,
      results: bundle.results.map(({ durationMs: _ms, ...r }) => r),
    });
    expect(durationless(fromFour)).toEqual(durationless(fromThree));
    expect(fromFour.testFiles.map((f) => f.path)).toEqual(NAMES.map((n) => `test/${n}.test.ts`));
  });
});
