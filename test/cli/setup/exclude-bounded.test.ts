import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { terminalAsker } from "../../../src/cli/setup/ask.js";
import { setupCommand } from "../../../src/cli/setup/command.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { readRepoFacts } from "../../../src/cli/setup/repo.js";
import type { AbsolutePath } from "../../../src/core/types/index.js";
import { capture, cleanupFixtures, harnessEnv, json, squealShaped } from "./fixture.js";

/*
 * Wave 13 review B1 (row 005-70): a default-yes exclude selects only test
 * files that name a build output. A directory glob is proposed only when
 * every test file it selects, descendants included, names one; otherwise the
 * files that do, by path, and the others stay slow candidates.
 */

afterEach(cleanupFixtures);

const SUM = "export const sum = (a: number, b: number) => a + b;\n";
const sourceTest = (up: string) =>
  `import { expect, it } from "vitest";\nimport { sum } from "${up}src/math.ts";\nit("adds", () => expect(sum(1, 2)).toBe(3));\n`;

/** The review's reproduction: a sibling and a nested source test beside `plugin-copy`. */
function withSourceTests(): string {
  return squealShaped({
    "squeal.config.json": json({}),
    "src/math.ts": SUM,
    "test/e2e/source.test.ts": sourceTest("../../"),
    "test/e2e/nested/source.test.ts": sourceTest("../../../"),
  });
}

const SOURCE_TESTS = ["test/e2e/nested/source.test.ts", "test/e2e/source.test.ts"];

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8")) as Record<string, unknown>;

/** Each source test is still listed, and the nested one is still a slow candidate. */
async function expectSourceTestsKept(root: string) {
  const listed = (await readRepoFacts(root as AbsolutePath)).testFiles.paths;
  expect(listed).toEqual(expect.arrayContaining(SOURCE_TESTS));
  expect(listed).not.toContain("test/e2e/plugin-copy.test.ts");
  const groups = (await buildPlan(root, { env: harnessEnv() })).slow.groups;
  expect(groups.map((g) => [g.dir, g.files])).toEqual([
    ["test/e2e/nested", ["test/e2e/nested/source.test.ts"]],
    ["test/e2e", ["test/e2e/shipped-plugin.test.ts", "test/e2e/source.test.ts"]],
  ]);
  expect(groups.every((g) => g.declaredSlow)).toBe(true);
}

describe("a bounded exclude proposal", () => {
  it("names only the file that names a build output, keeping its sibling and nested source tests", async () => {
    const groups = (await buildPlan(withSourceTests(), { env: harnessEnv() })).slow.groups;
    expect(groups.map((g) => [g.dir, g.exclude ?? null])).toEqual([
      ["test/e2e/nested", null],
      [
        "test/e2e",
        {
          globs: ["test/e2e/plugin-copy.test.ts"],
          into: [{ runner: "vitest", glob: "test/e2e/plugin-copy.test.ts" }],
          kept: ["test/e2e/shipped-plugin.test.ts", "test/e2e/source.test.ts"],
        },
      ],
    ]);
  });

  it("proposes the directory glob when every test file under it names a build output, descendants included", async () => {
    const root = squealShaped({
      "squeal.config.json": json({}),
      "test/e2e/shipped-plugin.test.ts": `const bundle = "plugins/codex/dist/cli/squeal.mjs";\n`,
      "test/e2e/nested/copy.test.ts": `const bundle = "plugins/codex/dist/cli/squeal.mjs";\n`,
    });
    const groups = (await buildPlan(root, { env: harnessEnv() })).slow.groups;
    expect(groups.map((g) => [g.dir, g.exclude?.globs ?? null, g.exclude?.kept ?? null])).toEqual([
      ["test/e2e/nested", ["test/e2e/nested/**"], []],
      ["test/e2e", ["test/e2e/**"], []],
    ]);
  });

  it("setup --yes excludes plugin-copy alone; both source tests stay listed and the nested one slow", async () => {
    const root = withSourceTests();
    const { io, out } = capture(root, harnessEnv(["claude"]));
    const code = await main(
      ["setup", "--yes", "--harness", "none", "--block", "none", "--no-warmup"],
      io,
    );
    expect(out.stderr).toBe("");
    expect(code).toBe(0);
    expect(config(root)).toEqual({
      vitest: { exclude: ["test/e2e/plugin-copy.test.ts"] },
      slow: { include: ["test/e2e/nested/**", "test/e2e/**"] },
    });
    await expectSourceTestsKept(root);
  });

  it("the terminal default does the same", async () => {
    const root = withSourceTests();
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    output.resume();
    // Claude Code yes, Codex no, keep the gate; every later question takes its default.
    input.end(["", "", "keep", "", "", ""].map((line) => `${line}\n`).join(""));
    const { io, out } = capture(root, harnessEnv(["claude"]));
    const asker = () => terminalAsker({ input, output });
    const code = await setupCommand(["--no-warmup", "--block", "none"], io, { asker });
    expect(code).toBe(0);
    expect(out.stdout).toContain("    test/e2e/plugin-copy.test.ts\n");
    expect(config(root)).toEqual({
      vitest: { exclude: ["test/e2e/plugin-copy.test.ts"] },
      slow: { include: ["test/e2e/nested/**", "test/e2e/**"] },
    });
    await expectSourceTestsKept(root);
  });

  it("the skill's answer flags: --exclude with the path the question shows, beside --slow", async () => {
    const root = withSourceTests();
    const { io } = capture(root, harnessEnv(["claude"]));
    const code = await main(
      [
        "setup",
        "--yes",
        "--harness",
        "none",
        "--block",
        "none",
        "--no-warmup",
        "--exclude",
        "test/e2e/plugin-copy.test.ts",
        "--slow",
        "test/e2e",
        "--slow",
        "test/e2e/nested",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(config(root)).toEqual({
      vitest: { exclude: ["test/e2e/plugin-copy.test.ts"] },
      slow: { include: ["test/e2e/**", "test/e2e/nested/**"] },
    });
    await expectSourceTestsKept(root);
  });

  it("a *.e2e.* group's directory glob would select every test beside it: its path only", async () => {
    const root = squealShaped({
      "squeal.config.json": json({}),
      "test/e2e/plugin-copy.test.ts": "\n",
      "test/e2e/shipped-plugin.test.ts": "\n",
      "test/bundle.e2e.test.ts": `const bundle = "plugins/codex/dist/cli/squeal.mjs";\n`,
    });
    const group = (await buildPlan(root, { env: harnessEnv() })).slow.groups.find(
      (g) => g.dir === "test",
    );
    expect(group?.exclude?.globs).toEqual(["test/bundle.e2e.test.ts"]);
  });
});
