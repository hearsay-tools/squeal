import { readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  LintFileResult,
  LintProvider,
  LintRunReport,
  LintSnapshot,
} from "../../../src/core/lint/provider/index.js";
import { cli, FIXTURES, onDisk, project, provider, read, write } from "./helpers.js";

/* Spec 017 D4's refresh levels and D5's program, on the fixture project with ESLint 10. */

const PROMISE = (text: string) =>
  text.replace(
    "export function load(): number {\n  return 1;",
    "export function load(): Promise<number> {\n  return Promise.resolve(1);",
  );

async function opened(root: string): Promise<LintProvider> {
  const eslint = provider(root);
  expect(await eslint.open()).toHaveProperty("tool", "eslint");
  expect(await eslint.refresh("none")).toHaveProperty("closure");
  return eslint;
}

async function lint(eslint: LintProvider, root: string, paths: string[]) {
  return ((await eslint.lint(onDisk(root, paths))) as LintRunReport).results;
}

const rules = (result: LintFileResult | undefined) =>
  result !== undefined && "findings" in result ? result.findings.map((f) => f.rule) : result;

describe("D4 refresh levels", () => {
  it("none keeps the instance; instance reads a config edit", async () => {
    const root = project("project");
    const eslint = await opened(root);
    expect(rules((await lint(eslint, root, ["src/a.js"])).get("src/a.js"))).toEqual([
      "prefer-const",
    ]);
    const config = read(root, "eslint.config.js");
    write(
      root,
      "eslint.config.js",
      config.replace(
        '"import-x/named": "error"',
        '"import-x/named": "error", "id-length": "error"',
      ),
    );

    expect(rules((await lint(eslint, root, ["src/a.js"])).get("src/a.js"))).toEqual([
      "prefer-const",
    ]);
    await eslint.refresh("instance");
    const results = await lint(eslint, root, ["src/a.js"]);
    expect(rules(results.get("src/a.js"))).toContain("id-length");
    expect(results).toEqual(cli(root, ["src/a.js"]));
  }, 60_000);

  it("instance keeps what the config imported; thread reads it again", async () => {
    const root = project("project");
    const eslint = await opened(root);
    write(
      root,
      "eslint/local.js",
      read(root, "eslint/local.js").replace('"prefer-const": "error"', '"prefer-const": "off"'),
    );

    await eslint.refresh("instance");
    expect(rules((await lint(eslint, root, ["src/a.js"])).get("src/a.js"))).toEqual([
      "prefer-const",
    ]);
    await eslint.refresh("thread");
    const results = await lint(eslint, root, ["src/a.js"]);
    expect(rules(results.get("src/a.js"))).toEqual([]);
    expect(results).toEqual(cli(root, ["src/a.js"]));
  }, 60_000);

  it("thread declares a newly installed ESLint", async () => {
    const root = project("project");
    const eslint = await opened(root);
    rmSync(join(root, "node_modules/eslint"));
    symlinkSync(join(FIXTURES, "../../../node_modules/eslint9"), join(root, "node_modules/eslint"));
    const snapshot = (await eslint.refresh("thread")) as LintSnapshot;
    expect(snapshot.declaration.toolVersion).toBe("9.39.5");
  }, 60_000);
});

describe("D5 whole-program files", () => {
  it("are flagged by typed signals or a cross-file plugin's rules", async () => {
    const root = project("project");
    write(root, "plain.mjs", "export const plain = 1;\n");
    const eslint = await opened(root);
    const inputs = await eslint.inputs(["src/a.js", "src/t.ts", "plain.mjs"]);
    expect(Object.fromEntries([...inputs].map(([path, i]) => [path, i.wholeProgram]))).toEqual({
      "src/a.js": true,
      "src/t.ts": true,
      "plain.mjs": false,
    });
  }, 60_000);

  it("refresh reports, before any lint, the program TypeScript builds", async () => {
    const root = project("project");
    const eslint = provider(root);
    await eslint.open();
    const snapshot = (await eslint.refresh("none")) as LintSnapshot;

    const toolchain = createRequire(
      realpathSync(join(root, "node_modules/typescript-eslint/package.json")),
    );
    const parser = toolchain("@typescript-eslint/parser") as {
      parseForESLint(
        text: string,
        options: object,
      ): {
        services: { program: { getSourceFiles(): { fileName: string }[] } };
      };
    };
    const path = join(root, "src/t.ts");
    const { services } = parser.parseForESLint(readFileSync(path, "utf8"), {
      filePath: path,
      projectService: true,
      tsconfigRootDir: root,
    });
    const program = services.program
      .getSourceFiles()
      .map((s) => relative(root, s.fileName))
      .filter((p) => !p.startsWith("..") && !p.includes("node_modules"));
    expect(snapshot.program).toEqual(program.sort());
    expect(snapshot.closure).toContain("tsconfig.json");

    const report = (await eslint.lint(onDisk(root, ["src/t.ts"]))) as LintRunReport;
    expect(report.program).toEqual(snapshot.program);
  }, 60_000);

  it("refresh reports a file the program imports outside include and ESLint's ignores", async () => {
    const root = project("project");
    // Review 0.1.348 B3: TypeScript follows `t.ts`'s import of `u.ts` past both.
    write(
      root,
      "tsconfig.json",
      read(root, "tsconfig.json").replace('"src/**/*.ts"', '"src/t.ts"'),
    );
    write(
      root,
      "eslint.config.js",
      read(root, "eslint.config.js").replace(
        '"eslint.config.js"]',
        '"eslint.config.js", "src/u.ts"]',
      ),
    );
    const eslint = provider(root);
    await eslint.open();
    const snapshot = (await eslint.refresh("none")) as LintSnapshot;
    expect(snapshot.program).toEqual(["src/t.ts", "src/u.ts"]);
    expect((await eslint.inputs(["src/t.ts", "src/u.ts"])).has("src/u.ts")).toBe(false);
  }, 60_000);

  it("a typed file reads the call's text of every program file, whatever the order", async () => {
    const root = project("project");
    const eslint = await opened(root);
    await lint(eslint, root, ["src/t.ts", "src/u.ts"]);
    write(root, "src/u.ts", PROMISE(read(root, "src/u.ts")));

    const results = await lint(eslint, root, ["src/t.ts", "src/u.ts"]);
    expect(rules(results.get("src/t.ts"))).toEqual(["@typescript-eslint/no-floating-promises"]);
    expect(results).toEqual(cli(root, ["src/t.ts", "src/u.ts"]));
  }, 60_000);

  it("a program file ESLint does not lint is fed and gets no result", async () => {
    const root = project("project");
    const config = read(root, "eslint.config.js");
    write(
      root,
      "eslint.config.js",
      config.replace('"eslint.config.js"]', '"eslint.config.js", "src/u.ts"]'),
    );
    const eslint = provider(root);
    await eslint.open();
    expect(((await eslint.refresh("none")) as LintSnapshot).program).toEqual([
      "src/t.ts",
      "src/u.ts",
    ]);
    await lint(eslint, root, ["src/t.ts"]);
    write(root, "src/u.ts", PROMISE(read(root, "src/u.ts")));

    const results = await lint(eslint, root, ["src/u.ts", "src/t.ts"]);
    expect([...results.keys()]).toEqual(["src/t.ts"]);
    expect(rules(results.get("src/t.ts"))).toEqual(["@typescript-eslint/no-floating-promises"]);
    expect(results).toEqual(cli(root, ["src/t.ts"]));
  }, 60_000);
});
