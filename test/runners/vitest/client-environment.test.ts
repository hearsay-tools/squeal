import { describe, expect, it } from "vitest";
import type { InvalidatedPath } from "../../../src/core/types/index.js";
import { openFixture, outcomes, paths, readsTest, ref, SLOW } from "./helpers.js";

const plain = ref("test/plain.test.ts");
const usesMarkdown = 'export { which } from "./markdown";\n';
const markdown = 'export const which = "md";\n';
const added = (...files: string[]): InvalidatedPath[] =>
  files.map((path) => ({ path, kind: "add" as const }));

/*
 * Task 001-424: in a client environment Vite raises "Failed to resolve
 * import" for a missing target. Once the target is added, the next run of
 * its importer passes with no touch: in one directory, and with the importer
 * and its target written at once in a new one.
 */
describe("vitest adapter: a missing import in a client environment is added", SLOW, () => {
  it.each([
    { name: "the target alone", dir: "src", first: ["src/uses-md.ts"] },
    { name: "importer and target at once, in a new directory", dir: "src/fresh", first: [] },
  ])("imported by a test file: $name", async ({ dir, first }) => {
    const fx = await openFixture("client-env", {
      "test/md.test.ts": readsTest(`../${dir}/uses-md.ts`, "md"),
      ...(first.length > 0 ? { [`${dir}/uses-md.ts`]: usesMarkdown } : {}),
    });
    const test = ref("test/md.test.ts");
    const before = await fx.adapter.run([test], fx.runOptions());
    expect(before.fileErrors[0]?.errors[0]?.message).toMatch(/^Failed to resolve import/);

    const files = [...(first.length > 0 ? [] : [`${dir}/uses-md.ts`]), `${dir}/markdown.ts`];
    fx.write(`${dir}/uses-md.ts`, usesMarkdown);
    fx.write(`${dir}/markdown.ts`, markdown);
    await fx.adapter.invalidate(added(...files));

    expect((await fx.adapter.closure(test)).paths).toContain(`${dir}/markdown.ts`);
    expect(outcomes(await fx.adapter.run([test], fx.runOptions()))).toEqual(["pass"]);
  });

  /*
   * The reported case: a setup file's import. Every test file of the project
   * fails with it, and no test file's closure holds the target, so the
   * environment lists its resolution candidates and the add re-keys them all.
   */
  it.each([
    { name: "the target alone", dir: "src", setup: "../src/markdown", first: true },
    {
      name: "importer and target at once, in a new directory",
      dir: "src/fresh",
      setup: "../src/fresh/uses-md",
      first: false,
    },
  ])("imported by a setup file: $name", async ({ dir, setup, first }) => {
    const fx = await openFixture("client-env", { "test/setup.ts": `import "${setup}";\n` });
    const [environment] = await fx.adapter.environment();
    const target = first ? `${dir}/markdown.ts` : `${dir}/uses-md.ts`;
    expect(environment?.files).toContain(target);
    const before = await fx.adapter.run([plain], fx.runOptions());
    expect(before.fileErrors[0]?.errors[0]?.message).toMatch(/^Failed to resolve import/);

    if (!first) fx.write(`${dir}/uses-md.ts`, usesMarkdown);
    fx.write(`${dir}/markdown.ts`, markdown);
    const files = [...(first ? [] : [`${dir}/uses-md.ts`]), `${dir}/markdown.ts`];
    await fx.adapter.invalidate(added(...files));

    expect(paths(await fx.adapter.affected([target]))).toContain(plain.path);
    const [after] = await fx.adapter.environment();
    expect(after?.files).toContain(`${dir}/markdown.ts`);
    expect(outcomes(await fx.adapter.run([plain], fx.runOptions()))).toEqual(["pass"]);
  });
});
