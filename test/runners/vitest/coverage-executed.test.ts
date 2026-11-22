import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import { type CoverageBatch, coveredFiles } from "../../../src/runners/vitest/coverage.js";
import { SourceStamps } from "../../../src/runners/vitest/sources.js";

/*
 * Spec 024 D3 (row 024-03): a file's sources are what its environment's kept
 * payloads executed, not every module the environment transformed, and the
 * files of one environment share them.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const paths = new WorktreePaths("/w");
const transformed = (count: number) =>
  new Map(
    Array.from({ length: count }, (_, i) => [
      `/w/src/m${i}.ts`,
      { transformResult: { code: `m${i}`, map: null } },
    ]),
  );

function payload(dir: string, name: string, files: readonly string[]): string {
  const result = files.map((file, i) => ({
    scriptId: String(i),
    url: pathToFileURL(file).href,
    functions: [],
  }));
  const path = join(dir, `coverage-${name}.json`);
  writeFileSync(path, JSON.stringify({ result }));
  return path;
}

describe("coveredFiles: the sources the run executed", () => {
  it("keeps only the modules a kept payload's scripts name, one map per environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-executed-"));
    dirs.push(dir);
    const modules = transformed(100);
    modules.set("/w/src/query.ts?raw", { transformResult: { code: "q", map: null } });
    const vitest = {
      projects: [
        {
          name: "",
          config: { root: "/w" },
          vite: { environments: { ssr: { moduleGraph: { idToModuleMap: modules } } } },
        },
      ],
    };
    const batch = (name: string, files: readonly string[]): CoverageBatch => ({
      coverage: payload(dir, name, files),
      testFiles: [`test/${name}.test.ts`],
      environment: "ssr",
      projectName: "",
      scripts: files,
    });
    const covered = coveredFiles(
      vitest as unknown as Vitest,
      [
        batch("a", ["/w/src/m1.ts", "/w/src/m2.ts", "/w/node/outside.ts"]),
        batch("b", ["/w/src/m2.ts", "/w/src/m7.ts"]),
        batch("dropped", ["/w/src/m50.ts"]),
      ],
      (ref) => ref.path !== "test/dropped.test.ts",
      new SourceStamps(paths),
      paths,
    );
    expect(covered.map((f) => f.testFile.path)).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    const [a, b] = covered;
    expect(a?.sources).toBe(b?.sources);
    expect([...(a?.sources.keys() ?? [])].sort()).toEqual([
      "/w/src/m1.ts",
      "/w/src/m2.ts",
      "/w/src/m7.ts",
    ]);
    expect(a?.sources.get("/w/src/m7.ts")).toMatchObject({ path: "src/m7.ts", code: "m7" });
  });

  it("gives no sources for a batch without scripts", () => {
    const vitest = {
      projects: [
        {
          name: "",
          config: { root: "/w" },
          vite: { environments: { ssr: { moduleGraph: { idToModuleMap: transformed(5) } } } },
        },
      ],
    };
    const covered = coveredFiles(
      vitest as unknown as Vitest,
      [
        {
          coverage: "/nonexistent/coverage-x.json",
          testFiles: ["test/x.test.ts"],
          environment: "ssr",
          projectName: "",
        },
      ],
      () => true,
      new SourceStamps(paths),
      paths,
    );
    expect(covered).toHaveLength(1);
    expect(covered[0]?.sources.size).toBe(0);
  });
});
