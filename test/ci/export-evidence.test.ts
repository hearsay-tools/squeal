import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Part, readPart } from "../../src/core/ci/parts.js";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import { ci, cloneOf, committed, recordVitest, scratchDir, writeFiles } from "./fixture.js";

/*
 * Review of 0.1.421 B1, B3 and B4, with the real recorder and CLI (spec 018
 * D8, D9 as amended 2026-11-09). Two test files read an ignored
 * `data/value.txt` and expect `GOOD`; two more name two checks alike, on two
 * lines and in one `test.each`. Both shards pass with `GOOD`. An export job
 * whose checkout holds `BAD`, or no file there, exports none of the reads; a
 * part set without one shard, or with an empty part directory, exports
 * nothing. The files with shared names export under the names the daemon
 * gives, a repeat by its line: `ci record` collects each test's location
 * (row 018-43); a part without them leaves such a file out, never exported
 * under a name the daemon does not give.
 */

const READS = (name: string) =>
  `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("reads ${name}", () => {\n  expect(readFileSync(new URL("../data/value.txt", import.meta.url), "utf8")).toBe("GOOD");\n});\n`;

const FILES = {
  "package.json": JSON.stringify({ name: "ci-evidence-fixture", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"] } });\n`,
  ".gitignore": "data/\nnode_modules/\n",
  "test/a.test.ts": READS("a"),
  "test/b.test.ts": READS("b"),
  "test/lines.test.ts": `import { it } from "vitest";\nit("duplicate", () => {});\nit("duplicate", () => {});\nit("once", () => {});\n`,
  "test/each.test.ts": `import { it } from "vitest";\nit.each([1, 2])("same", () => {});\n`,
};

const SLOW = { timeout: 300_000 };

/** The files that read nothing but their own, which every checkout certifies. */
const NAMED = ["test/each.test.ts", "test/lines.test.ts"];

let dir = "";
let origin = "";
let out = "";

/** Both shards of the fixture, recorded as in CI with `GOOD` in the ignored file. */
beforeAll(async () => {
  dir = scratchDir("ci-evidence");
  origin = committed(dir, FILES);
  writeFiles(origin, { "data/value.txt": "GOOD" });
  out = join(dir, "parts");
  for (const shard of ["1/2", "2/2"]) {
    const recorded = await recordVitest(origin, out, [`--shard=${shard}`]);
    expect(recorded.code, recorded.said).toBe(0);
  }
}, SLOW.timeout);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

function parts(): { file: string; part: Part }[] {
  return readdirSync(out).map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return { file: name, part };
  });
}

/** A clone of `origin` whose ignored `data/value.txt` holds `value`, or none. */
function checkout(name: string, value: string | null): string {
  const root = cloneOf(origin, name);
  if (value !== null) writeFiles(root, { "data/value.txt": value });
  return root;
}

/** `squeal ci export` of `dirs` in `root` to `results.json.gz` there: its exit, text and bundle. */
async function exportIn(root: string, dirs: readonly string[] = [out]) {
  const target = join(root, "results.json.gz");
  const { code, said } = await ci(["export", "--parts", ...dirs, "--out", target], root);
  const bundle = existsSync(target) ? decodeBundle(readFileSync(target)) : null;
  if (typeof bundle === "string") throw new Error(bundle);
  return { code, said, bundle };
}

describe("ci export certifies each result by its shard's evidence (review of 0.1.421)", () => {
  it(
    "B1: exports a read only where the job's checkout holds the content the shard read",
    SLOW,
    async () => {
      for (const [name, value] of [
        ["bad", "BAD"],
        ["none", null],
      ] as const) {
        const { code, said, bundle } = await exportIn(checkout(name, value));
        expect(bundle?.testFiles.map((f) => f.path) ?? [], said).toEqual(NAMED);
        expect(code).toBe(0);
        expect(said).toContain("2 test files whose inputs here are not what their shard read");
        expect(said).toContain(
          "left out test/a.test.ts: its shard recorded other content, or none, for data/value.txt",
        );
      }
      const good = await exportIn(checkout("good", "GOOD"));
      expect(good.code, good.said).toBe(0);
      const reads = good.bundle?.testFiles.filter((f) => !NAMED.includes(f.path));
      expect(reads?.map((f) => f.path)).toEqual(["test/a.test.ts", "test/b.test.ts"]);
      expect(reads?.every((f) => f.closure?.paths.includes("data/value.txt"))).toBe(true);
      // Each shard took the ignored file's content as its tests read it, the blob of `GOOD`.
      const blob = execFileSync("git", ["hash-object", "--stdin"], { input: "GOOD" }).toString();
      for (const { part } of parts()) expect(part.evidence["data/value.txt"]).toBe(blob.trim());
    },
  );

  it("B3: refuses one shard's part alone, or beside an empty part directory", SLOW, async () => {
    const root = checkout("partial", "GOOD");
    const [first] = parts();
    const single = join(dir, "single");
    const empty = join(dir, "empty");
    mkdirSync(single);
    mkdirSync(empty);
    copyFileSync(join(out, first?.file as string), join(single, first?.file as string));
    const withEmpty = await exportIn(root, [single, empty]);
    expect(withEmpty.bundle, withEmpty.said).toBeNull();
    expect(withEmpty.code).toBe(1);
    expect(withEmpty.said).toContain(`no part (squeal-part-*.json) in ${empty}`);
    const alone = await exportIn(root, [single]);
    expect(alone.bundle, alone.said).toBeNull();
    expect(alone.code).toBe(1);
    const index = first?.part.header.shard.index;
    expect(alone.said).toContain(`refused: no part of shard ${index === 1 ? 2 : 1}/2`);
  });

  it(
    "B4: names two checks of one name, on two lines or in one test.each, as the daemon does (018-43)",
    SLOW,
    async () => {
      const { code, said, bundle } = await exportIn(checkout("names", "GOOD"));
      expect(code, said).toBe(0);
      expect(said).toContain("Exported 4 test files");
      expect(said).not.toContain("two checks of one name");
      const names = (path: string) =>
        (bundle?.results ?? [])
          .filter((r) => r.testPath === path && r.kind === "test")
          .map((r) => r.fullName);
      expect(names("test/lines.test.ts")).toEqual(["duplicate", "duplicate (line 3)", "once"]);
      expect(names("test/each.test.ts")).toEqual(["same", "same (line 2)"]);
      const files = parts().flatMap((p) => p.part.testFiles);
      expect(Object.fromEntries(files.map((f) => [f.path, f.sharedNames ?? []]))).toEqual({
        "test/a.test.ts": [],
        "test/b.test.ts": [],
        "test/each.test.ts": ["same"],
        "test/lines.test.ts": ["duplicate"],
      });
      // `ci record` collects every test's location, as the daemon's instance does.
      expect(files.every((f) => f.checks.every((c) => c.location !== null))).toBe(true);
    },
  );
});
