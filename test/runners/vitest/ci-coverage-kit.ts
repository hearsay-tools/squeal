import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type CiDeps, ciCommand } from "../../../src/cli/ci.js";
import { type Part, readPart } from "../../../src/core/ci/parts.js";
import { VITEST } from "../../ci/fixture.js";
import { TS_WORKER } from "../../code/coverage/payloads.js";

/*
 * Spec 020 D13 (row 020-08a): `squeal ci record` with Squeal's provider
 * around a fixture's own Vitest. From the TypeScript sources no bundled
 * records' worker sits beside the CLI, so the worker is the sources' own,
 * as Node strips their types (`TS_WORKER`).
 */

/** `src/math.ts` with a cast arrow and a curried arrow; two test files, one with a skipped test. */
export const MATH_FILES: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({ name: "ci-coverage-fixture", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/math.ts": [
    "export function add(a: number, b: number): number {",
    "  return a + b;",
    "}",
    "export const field = (x: unknown) => (x as { n: number }).n;",
    "export const curried = (a: number) => (b: number) => (c: number) => a * b + c;",
    "export function grade(score: number): string {",
    '  if (score > 90) return "A";',
    '  if (score > 50) return "B";',
    '  return "C";',
    "}",
    "",
  ].join("\n"),
  "test/add.test.ts": [
    'import { expect, it } from "vitest";',
    'import { add, field } from "../src/math.js";',
    'it("adds", () => expect(add(1, 2)).toBe(3));',
    'it("reads a field", () => expect(field({ n: 4 })).toBe(4));',
    "",
  ].join("\n"),
  "test/grade.test.ts": [
    'import { expect, it } from "vitest";',
    'import { curried, grade } from "../src/math.js";',
    'it("grades", () => expect(grade(95)).toBe("A"));',
    'it("curries", () => expect(curried(2)(3)(4)).toBe(10));',
    'it.skip("grades low", () => expect(grade(1)).toBe("C"));',
    "",
  ].join("\n"),
};

/** `squeal ci record --out <out> -- vitest run <args>` in `root` with the sources' worker. */
export async function recordCovered(
  root: string,
  out: string,
  args: readonly string[] = [],
  deps: CiDeps = { mapWorker: TS_WORKER },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; said: string; parts: Part[] }> {
  let said = "";
  const add = (text: string) => {
    said += text;
  };
  const command = [process.execPath, VITEST, "run", ...args];
  const code = await ciCommand(
    ["record", "--out", out, "--", ...command],
    { stdout: add, stderr: add, cwd: root, env },
    deps,
  );
  const names = said.includes("wrote ") ? readdirSync(out).sort() : [];
  const parts = names.map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return part;
  });
  return { code, said, parts };
}
