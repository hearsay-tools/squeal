import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRepo } from "./helpers.js";

/* The suites of the backlog tests (task 001-124 and after): one module per test file. */

const pad = (n: number) => String(n).padStart(3, "0");

/**
 * `count` test files, each importing its own module and waiting `sleepMs`,
 * or, with `slowWhile`, only while that file exists; `mark` gets a line per test.
 */
export function suite(count: number, sleepMs: number, mark?: string, slowWhile?: string) {
  const [fs, sleep] =
    slowWhile === undefined
      ? ["appendFileSync", `${sleepMs}`]
      : ["appendFileSync, existsSync", `existsSync(${JSON.stringify(slowWhile)}) ? ${sleepMs} : 0`];
  const repo = createRepo("barrel-only");
  const at = (path: string) => join(repo.main, path);
  rmSync(at("test/aa-slow.test.ts"));
  rmSync(at("test/zz-fast.test.ts"));
  for (let i = 0; i < count; i++) {
    writeFileSync(at(`src/m${pad(i)}.ts`), `export const value = ${i};\n`);
    writeFileSync(
      at(`test/f${pad(i)}.test.ts`),
      [
        `import { ${fs} } from "node:fs";`,
        `import { expect, it } from "vitest";`,
        `import { value } from "../src/m${pad(i)}.ts";`,
        `it("holds", async () => {`,
        `  await new Promise((resolve) => setTimeout(resolve, ${sleep}));`,
        `  expect(value).toBe(${i});`,
        mark === undefined ? "" : `  appendFileSync(${JSON.stringify(mark)}, "${i}\\n");`,
        `});`,
        "",
      ].join("\n"),
    );
  }
  return repo;
}

/** The tests `suite` recorded in `mark`. */
export const completions = (mark: string) =>
  existsSync(mark) ? readFileSync(mark, "utf8").split("\n").length - 1 : 0;
