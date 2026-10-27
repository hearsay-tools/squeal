import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { ALL_TEST_FILES, createRepo } from "./helpers.js";

export const DATA = ".runtime/descriptor.json";
export const A = "test/a.test.ts";
export const B = "test/b.test.ts";
export const OUT = "test/outside.test.ts";
export const rules = [{ project: "", tests: [A, B], paths: [DATA] }];
export const scoped: Policy = { ...DEFAULT_POLICY, ...RUN_MISSING, runtimeFiles: rules };
export function fixture(outside = true) {
  const repo = createRepo();
  for (const path of ALL_TEST_FILES) rmSync(join(repo.main, path));
  writeFileSync(join(repo.main, ".gitignore"), "src/gen/\n.runtime/\nnode_modules/\n");
  const paths = outside ? [A, B, OUT] : [A, B];
  for (const path of paths)
    writeFileSync(
      join(repo.main, path),
      [
        'import { readFileSync } from "node:fs";',
        'import { expect, test } from "vitest";',
        'test("runtime reader", () => {',
        `  const descriptor = JSON.parse(readFileSync(new URL("../${DATA}", import.meta.url), "utf8"));`,
        "  expect(descriptor.port).toBeGreaterThan(0);",
        "});",
        "",
      ].join("\n"),
    );
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "runtime fixture"]);
  mkdirSync(join(repo.main, ".runtime"));
  writeFileSync(join(repo.main, DATA), '{"port": 1234}\n');
  return repo;
}
export const text = (port: number) => `${JSON.stringify({ port })}\n`;
