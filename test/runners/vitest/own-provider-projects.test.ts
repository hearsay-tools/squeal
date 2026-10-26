import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { buildRecord, type V8Script } from "../../../src/core/code/coverage/index.js";
import { type CoverageBatch, coveredFiles } from "../../../src/runners/vitest/coverage.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { SourceStamps } from "../../../src/runners/vitest/sources.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 013-10: Vitest names a batch's test files from its project's root
 * (`file.name`, Vitest 4 and 5). A project of its own config has a root
 * other than the worktree, as each of Cezar's has, so its payloads were
 * read as the wrong files and dropped. Each name is read from its
 * project's root; an absolute one stays.
 */

const fixture = (path: string) =>
  readFileSync(
    join(resolve(import.meta.dirname, "../../fixtures/vitest/own-provider"), path),
    "utf8",
  );

/** Two projects, each of its own config, each with `test/math.test.ts` over its own `src/math.ts`. */
const TWO_PROJECTS: Readonly<Record<string, string>> = {
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    'export default defineConfig({ test: { projects: ["./a/vitest.config.ts", "./b/vitest.config.ts"] } });',
    "",
  ].join("\n"),
  ...Object.fromEntries(
    ["a", "b"].flatMap((name) => [
      [
        `${name}/vitest.config.ts`,
        [
          'import { defineConfig } from "vitest/config";',
          `export default defineConfig({ test: { name: "${name}", include: ["test/**/*.test.ts"] } });`,
          "",
        ].join("\n"),
      ],
      [`${name}/src/math.ts`, fixture("src/math.ts")],
      [`${name}/test/math.test.ts`, fixture("test/math.test.ts")],
    ]),
  ),
};

describe("vitest adapter: coverage of a project of its own config", SLOW, () => {
  it("keeps each file's payload under its project, with its project's sources", async () => {
    const opened = covering();
    const fx = await openFixture("own-provider", TWO_PROJECTS, opened.create);
    const files = [ref("a/test/math.test.ts", "a"), ref("b/test/math.test.ts", "b")];
    const report = await fx.adapter.run(files, fx.runOptions());

    expect(report.failure).toBeNull();
    const kept = opened.runs.flatMap((r) => r.files);
    expect(kept.map((f) => f.testFile).sort((x, y) => x.path.localeCompare(y.path))).toEqual(files);
    for (const file of kept) {
      const { result } = JSON.parse(readFileSync(file.payload, "utf8")) as { result: V8Script[] };
      const record = buildRecord(file, result, "sha1", new Map());
      const dir = file.testFile.project;
      expect(record.sources.map((s) => s.path)).toEqual([
        `${dir}/src/math.ts`,
        `${dir}/test/math.test.ts`,
      ]);
    }
  });
});

describe("coveredFiles: a batch's test file name", () => {
  const paths = new WorktreePaths("/w");
  const project = (name: string, root: string) => ({
    name,
    config: { root },
    vite: { environments: { ssr: { moduleGraph: { idToModuleMap: new Map() } } } },
  });
  const vitest = { projects: [project("a", "/w/a"), project("b", "/w/b"), project("", "/w")] };
  const batch = (projectName: string, file: string): CoverageBatch => ({
    coverage: `/tmp/payload-${projectName}-${file.replaceAll("/", "_")}.json`,
    testFiles: [file],
    environment: "ssr",
    projectName,
  });

  it("reads a relative name from its project's root, and keeps an absolute one", () => {
    const covered = coveredFiles(
      vitest as unknown as Vitest,
      [
        batch("a", "test/math.test.ts"),
        batch("b", "test/math.test.ts"),
        batch("b", "/w/b/test/other.test.ts"),
        batch("", "test/root.test.ts"),
      ],
      () => true,
      new SourceStamps(paths),
      paths,
    );
    expect(covered.map((f) => f.testFile)).toEqual([
      ref("a/test/math.test.ts", "a"),
      ref("b/test/math.test.ts", "b"),
      ref("b/test/other.test.ts", "b"),
      ref("test/root.test.ts"),
    ]);
  });
});
