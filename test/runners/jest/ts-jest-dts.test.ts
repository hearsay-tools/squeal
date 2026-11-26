import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { initRepository, OpenWorktree } from "../../kit/worktrees.js";

/*
 * Spec 028 Testing, D3.2 (row 028-06b) on real Jest 29.7.0 and 30.5.2: a
 * type-checking transform, as `ts-jest` is, reads each test file's `.d.ts`
 * with `fs.readFileSync` in the batch process, outside Jest's module
 * registry. `recorder.cjs` names the test file Jest is running from
 * `Symbol.for("squeal.currentTestFile")`, so in one batch of two files each
 * `.d.ts` keys only the file whose transform read it, and its edit reaches
 * only that file. The fixture has no `ts-jest`: the transform here reads
 * the file a `// @types` comment names, in its cache key and its `process`,
 * and fails the file as a type error when the declarations say `broken`.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const TYPES_TRANSFORM = lines(
  'const crypto = require("crypto");',
  'const fs = require("fs");',
  'const path = require("path");',
  "/** The declarations a `// @types <path>` comment names, read as a type checker reads them. */",
  "function declarations(sourceText, sourcePath) {",
  "  const named = /\\/\\/ @types (\\S+)/.exec(sourceText);",
  '  return named === null ? "" : fs.readFileSync(path.resolve(path.dirname(sourcePath), named[1]), "utf8");',
  "}",
  "module.exports = {",
  "  getCacheKey(sourceText, sourcePath) {",
  "    const types = declarations(sourceText, sourcePath);",
  '    return crypto.createHash("sha1").update(sourcePath).update(sourceText).update(types).digest("hex");',
  "  },",
  "  process(sourceText, sourcePath) {",
  '    if (declarations(sourceText, sourcePath).includes("broken")) {',
  '      throw new Error("type error: " + path.basename(sourcePath) + " does not match its declarations");',
  "    }",
  "    return { code: sourceText };",
  "  },",
  "};",
);

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.js"],',
    '  transform: { "\\\\.js$": "<rootDir>/transform/types.js" },',
    "};",
  ),
  "transform/types.js": TYPES_TRANSFORM,
  "types/a.d.ts": "export declare const a: number;\n",
  "types/b.d.ts": "export declare const b: number;\n",
  "test/a.test.js": lines("// @types ../types/a.d.ts", 'test("a", () => expect(1).toBe(1));'),
  "test/b.test.js": lines("// @types ../types/b.d.ts", 'test("b", () => expect(2).toBe(2));'),
};

const A = ref("test/a.test.js");
const B = ref("test/b.test.js");
const SLOW = { timeout: 240_000 };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-dts-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function ref(path: string): TestFileRef {
  return { project: "app", path };
}

function worktree(major: JestMajor): { root: AbsolutePath; common: AbsolutePath } {
  const dir = join(scratch, `tree-${made++}`);
  const root = join(dir, "worktree");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  const jest = realpathSync(join(installJest(major), "node_modules/jest"));
  symlinkSync(jest, join(root, "node_modules/jest"));
  mkdirSync(join(dir, "common"));
  initRepository(root);
  return {
    root: realpathSync(root) as AbsolutePath,
    common: realpathSync(join(dir, "common")) as AbsolutePath,
  };
}

/** Both files in one batch, recorded as the core records a tier. */
function runBoth(open: OpenWorktree, root: string): Promise<RunReport> {
  return open.record([A, B], () =>
    open.adapter.run([A, B], {
      runId: `run-${made}`,
      logDir: join(root, "..", `logs-${made++}`) as AbsolutePath,
      timeoutMs: 120_000,
    }),
  );
}

const outcomes = (report: RunReport) =>
  Object.fromEntries(report.results.map((r) => [r.check.fullName, r.outcome]));

describe.each(JEST_MAJORS)("a type-checking transform's .d.ts reads on Jest %i", (major) => {
  it("key and reach only the test file whose transform read them", SLOW, async () => {
    const { root, common } = worktree(major);
    const open = await OpenWorktree.open("a", root, common, () =>
      createJestAdapter(PROJECT, { root, batchSize: () => 5 }),
    );
    onTestFinished(() => open.close());

    const first = await runBoth(open, root);
    expect(first.end).toBe("completed");
    expect(outcomes(first)).toEqual({ a: "pass", b: "pass" });
    // One batch ran both files: attribution is per test file, not per process.
    expect(first.observed?.find((o) => o.testFile.path === A.path)?.paths).toContain(
      "types/a.d.ts",
    );
    expect(first.observed?.find((o) => o.testFile.path === A.path)?.paths).not.toContain(
      "types/b.d.ts",
    );
    expect(await open.keyed(A)).toContain("types/a.d.ts");
    expect(await open.keyed(A)).not.toContain("types/b.d.ts");
    expect(await open.keyed(B)).toContain("types/b.d.ts");
    expect(await open.keyed(B)).not.toContain("types/a.d.ts");

    // The edit of `a.d.ts` reaches `a` alone: the static graph knows no `.d.ts`, the keys do.
    writeFileSync(join(root, "types/a.d.ts"), "export declare const a: broken;\n");
    expect(await open.adapter.invalidate([{ path: "types/a.d.ts", kind: "change" }])).toEqual({
      recreatedProjects: [],
    });
    expect(await open.adapter.affected(["types/a.d.ts"])).toEqual({ direct: [], transitive: [] });
    const keyed = await Promise.all([A, B].map((f) => open.keyed(f)));
    expect(keyed.map((paths) => paths.includes("types/a.d.ts"))).toEqual([true, false]);

    // Run again, both in one batch: `a` fails on its declarations, `b` is untouched.
    const second = await runBoth(open, root);
    expect(second.completedFiles.map((f) => f.path).sort()).toEqual([A.path, B.path]);
    expect(outcomes(second)).toEqual({ b: "pass" });
    expect(second.fileErrors.map((e) => e.testFile.path)).toEqual([A.path]);
    expect(second.fileErrors[0]?.errors[0]?.message).toContain(
      "type error: a.test.js does not match its declarations",
    );
    expect(await open.keyed(A)).toContain("types/a.d.ts");
    expect(await open.keyed(B)).not.toContain("types/a.d.ts");
  });
});
