import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPart } from "../../src/core/ci/parts.js";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import { decodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { ci, cloneOf, committed, recordVitest, scratch } from "./fixture.js";

/*
 * Issue #254, spec 018 D30 to D33: a passing test file recorded in a clean
 * checkout exports in a fresh clone when a tracked declared input
 * (`squeal.config.json` `inputs`) or a tracked lazy dynamic-import closure
 * module was never read by the shard. The same part refuses both files when
 * the export checkout holds other bytes for those inputs, or under format 5
 * without endpoint hashes (D9 alone).
 */

const SLOW = { timeout: 300_000 } as const;

const FIXTURE = {
  "package.json": JSON.stringify({ name: "ci-unread-clone", private: true, type: "module" }),
  ".gitignore": "node_modules\n",
  "vitest.config.ts":
    'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1 } });\n',
  "squeal.config.json": JSON.stringify({
    inputs: { "test/declared.test.ts": ["docs/unused.md"] },
  }),
  "docs/unused.md": "declared tracked input\n",
  "src/lazy.ts": 'export const value = "lazy";\n',
  "test/control.test.ts":
    'import { expect, it } from "vitest";\nit("control", () => expect(1).toBe(1));\n',
  "test/declared.test.ts":
    'import { expect, it } from "vitest";\nit("declared", () => expect(1).toBe(1));\n',
  "test/lazy.test.ts":
    'import { expect, it } from "vitest";\nconst load = () => import("../src/lazy.ts");\nit("lazy", () => expect(typeof load).toBe("function"));\n',
} as const;

/** Reproduces each exported key from the commit's blobs and the file's closure and key parts (D11). */
async function keysMatchCommit(root: string, bundle: ResultsBundle): Promise<boolean[]> {
  const blobs = await committedBlobs(root, bundle.header.commit as string);
  const hash = new Map(bundle.environments.map((entry) => [entry.project, entry.hash]));
  return bundle.testFiles.map((file) => {
    const segments = (file.closure?.paths ?? []).map((p) => encodeSegment(p, blobs.get(p) ?? null));
    const { dependencies, runtime } = file.keyParts ?? { dependencies: "", runtime: "" };
    const key = keyFromSegments(
      hash.get(file.project) ?? "",
      file,
      segments,
      dependencies,
      runtime,
    );
    return key === file.key;
  });
}

describe("ci export of unread declared and lazy closure inputs in a fresh clone (issue #254, spec 018 D33)", () => {
  it(
    "exports passing files with unread declared or lazy inputs in a fresh clone, and rejects changed or pre-D33 inputs",
    SLOW,
    async () => {
      const origin = committed(scratch("ci-unread-clone"), FIXTURE);
      const base = dirname(origin);
      const parts = join(base, "parts");
      const recorded = await recordVitest(origin, parts, ["--maxWorkers=1"]);
      expect(recorded.code, recorded.said).toBe(0);

      const partNames = readdirSync(parts);
      expect(partNames).toHaveLength(1);
      const partPath = join(parts, partNames[0] as string);
      const part = readPart(partPath);
      if (typeof part === "string") throw new Error(part);
      expect(part.format).toBe("squeal-ci-part/6");
      expect(part.header.dirty).toBe(false);
      expect(part.header.commit).toMatch(/^[0-9a-f]{40}$/);
      // Neither unread input has read-time evidence; only the endpoint rule (D33) can certify them.
      expect(Object.hasOwn(part.evidence, "docs/unused.md")).toBe(false);
      expect(Object.hasOwn(part.evidence, "src/lazy.ts")).toBe(false);

      // Clean fresh clone: all three passing files export with commit provenance and reproducible keys.
      const exportRoot = cloneOf(origin, "export");
      const bundlePath = join(base, "unread.json.gz");
      const exported = await ci(["export", "--parts", parts, "--out", bundlePath], exportRoot);
      expect(exported.code, exported.said).toBe(0);
      expect(exported.said).toContain(`Exported 3 test files, 6 results, to ${bundlePath}.`);
      expect(exported.said).toContain(
        "2 of them rest on inputs that nothing in their shard's command read, listed or wrote",
      );

      const bundle = decodeBundle(readFileSync(bundlePath));
      if (typeof bundle === "string") throw new Error(bundle);
      expect(bundle.header.commit).toBe(part.header.commit);
      expect(bundle.header.dirty).toBe(false);
      expect(bundle.testFiles.map((file) => file.path)).toEqual([
        "test/control.test.ts",
        "test/declared.test.ts",
        "test/lazy.test.ts",
      ]);
      const byPath = new Map(bundle.testFiles.map((file) => [file.path, file]));
      expect(byPath.get("test/declared.test.ts")?.closure?.paths).toContain("docs/unused.md");
      expect(byPath.get("test/lazy.test.ts")?.closure?.paths).toContain("src/lazy.ts");
      expect(await keysMatchCommit(exportRoot, bundle)).toEqual([true, true, true]);

      // Fresh clone with changed unread inputs: both unread files are left out; only control exports.
      const changedRoot = cloneOf(origin, "changed-export");
      writeFileSync(join(changedRoot, "docs/unused.md"), "changed declared input\n");
      writeFileSync(join(changedRoot, "src/lazy.ts"), 'export const value = "changed";\n');
      const changedBundlePath = join(base, "changed.json.gz");
      const changed = await ci(
        ["export", "--parts", parts, "--out", changedBundlePath],
        changedRoot,
      );
      expect(changed.code, changed.said).toBe(0);
      expect(changed.said).toContain("left out test/declared.test.ts");
      expect(changed.said).toContain("left out test/lazy.test.ts");
      const changedBundle = decodeBundle(readFileSync(changedBundlePath));
      if (typeof changedBundle === "string") throw new Error(changedBundle);
      expect(changedBundle.testFiles.map((file) => file.path)).toEqual(["test/control.test.ts"]);

      // Same recorded evidence as format 5 (D9 alone, pre-0.1.582): proves both unread files would be left out.
      const format5Dir = join(base, "parts-format-5");
      mkdirSync(format5Dir, { recursive: true });
      const { stable: _s, unstable: _u, touched: _t, ...withoutEndpoints } = part;
      writeFileSync(
        join(format5Dir, partNames[0] as string),
        JSON.stringify({ ...withoutEndpoints, format: "squeal-ci-part/5" }),
      );
      const format5BundlePath = join(base, "format5.json.gz");
      const format5 = await ci(
        ["export", "--parts", format5Dir, "--out", format5BundlePath],
        exportRoot,
      );
      expect(format5.code, format5.said).toBe(0);
      expect(format5.said).toContain("left out test/declared.test.ts");
      expect(format5.said).toContain("left out test/lazy.test.ts");
      const format5Bundle = decodeBundle(readFileSync(format5BundlePath));
      if (typeof format5Bundle === "string") throw new Error(format5Bundle);
      expect(format5Bundle.testFiles.map((file) => file.path)).toEqual(["test/control.test.ts"]);
    },
  );
});
