import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blobHash } from "../../../src/core/hash/blob.js";
import type { LintRunReport } from "../../../src/core/lint/pass/provider.js";
import { isOxlintConfigInput } from "../../../src/core/lint/provider/oxlint/index.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/index.js";
import { project, provider, write } from "./helpers.js";
import { FIXTURE } from "./replay.js";

/*
 * Spec 017 D11 "Key": each input that decides a file's findings reaches what
 * the provider reports, so the pass can key it: the configs and what they
 * extend, the JS plugin's entry, what the plugin imports and reads (held
 * bytes from the preload), a TS config's import, the import plugin, the
 * keyed variables. The replay's default schedule never edits `banned.txt`
 * while `src/w.ts` is linted; this test does.
 */

const p = (path: string) => path as RelativePath;
const blobOf = (root: string, path: string) => blobHash(readFileSync(join(root, path)), "sha1");
const file = (root: string, path: string) => ({
  path: p(path),
  text: readFileSync(join(root, path), "utf8"),
});

const ROOT_CONFIG = {
  extends: ["./configs/base.json"],
  plugins: ["eslint", "typescript"],
  jsPlugins: ["./plugins/local.mjs"],
  rules: { "local/no-ident": "error", "local/no-word": "error" },
};

function report(r: LintRunReport | { off: string }): LintRunReport {
  if ("off" in r) throw new Error(r.off);
  return r;
}

describe("what the provider reports for the key", { timeout: 60_000 }, () => {
  it("holds what a JS plugin imported and read, with the bytes it used", async () => {
    const root = project({ ...FIXTURE, ".oxlintrc.json": JSON.stringify(ROOT_CONFIG) });
    const lint = provider(root);
    await lint.open();
    const snapshot = await lint.refresh("none");
    expect(snapshot).toMatchObject({
      // `--print-config` loads the JS plugin and its imports; the rule reads `banned.txt` only when it lints.
      closure: ["configs/base.json", "plugins/helper.mjs", "plugins/local.mjs"],
      declaration: { configFiles: [".eslintignore", ".oxlintrc.json", "pkg/.oxlintrc.json"] },
    });
    const first = report(await lint.lint([file(root, "src/w.ts")]));
    expect(first.results.get(p("src/w.ts"))).toMatchObject({
      findings: [{ rule: "local(no-ident)", message: "Identifier 'foo' is banned." }],
    });
    expect(first.held?.get(p("plugins/helper.mjs"))).toEqual({
      others: [blobOf(root, "plugins/helper.mjs")],
    });
    expect(first.held?.get(p("banned.txt"))).toEqual({ others: [blobOf(root, "banned.txt")] });
    expect(first.closure).toEqual(
      expect.arrayContaining(["banned.txt", "plugins/helper.mjs", "plugins/local.mjs"]),
    );

    write(root, { "banned.txt": "allowed\n" });
    const second = report(await lint.lint([file(root, "src/w.ts")]));
    expect(second.results.get(p("src/w.ts"))).toMatchObject({
      findings: [
        { rule: "local(no-word)", message: "String 'allowed' is banned." },
        { rule: "local(no-ident)" },
      ],
    });
    expect(second.held?.get(p("banned.txt"))).toEqual({ others: [blobOf(root, "banned.txt")] });
  });

  it("holds the modules a TS config imported", async () => {
    const root = project({
      "oxlint.config.ts":
        'import { rules } from "./shared.ts";\nexport default { plugins: ["eslint"], rules };\n',
      "shared.ts": 'export const rules = { eqeqeq: "error" };\n',
      "src/a.ts": "export const f = (x: number) => x == 1;\n",
    });
    const lint = provider(root);
    await lint.open();
    const snapshot = await lint.refresh("none");
    expect(snapshot).toMatchObject({
      closure: ["shared.ts"],
      declaration: { configFiles: ["oxlint.config.ts"] },
    });
    expect("off" in snapshot ? null : snapshot.held?.get(p("shared.ts"))).toEqual({
      others: [blobOf(root, "shared.ts")],
    });
  });

  it("names each file's config chain, and the import plugin as whole-program", async () => {
    const root = project({ ...FIXTURE, ".oxlintrc.json": JSON.stringify(ROOT_CONFIG) });
    const lint = provider(root);
    await lint.open();
    const inputs = await lint.inputs([p("src/a.ts"), p("pkg/sub/q.ts"), p("gen/g.ts")]);
    expect([...inputs.keys()]).toEqual(["src/a.ts", "pkg/sub/q.ts", "gen/g.ts"]);
    expect(inputs.get(p("pkg/sub/q.ts"))).toEqual({
      config: JSON.stringify({
        chain: [
          ["pkg/sub", null],
          ["pkg", "pkg/.oxlintrc.json"],
        ],
      }),
      wholeProgram: false,
    });
    expect(inputs.get(p("src/a.ts"))).toEqual({
      config: JSON.stringify({
        chain: [
          ["src", null],
          ["", ".oxlintrc.json"],
        ],
      }),
      wholeProgram: false,
    });

    write(root, {
      ".oxlintrc.json": JSON.stringify({ ...ROOT_CONFIG, ignorePatterns: ["gen/**"] }),
      "pkg/.oxlintrc.json": JSON.stringify({ plugins: ["import"] }),
    });
    await lint.refresh("instance");
    const again = await lint.inputs([p("src/a.ts"), p("gen/g.ts")]);
    expect([...again.keys()]).toEqual(["src/a.ts"]);
    expect(again.get(p("src/a.ts"))?.wholeProgram).toBe(true);
  });

  it("keys D11's variables, and reads the paths that re-read the configs", async () => {
    const root = project({ "src/a.ts": "export const a = 1;\n" }) as AbsolutePath;
    const lint = provider(root, { env: { PATH: process.env.PATH, VP_VERSION: "1.2.3" } });
    await lint.open();
    expect(await lint.refresh("none")).toMatchObject({ env: { VP_VERSION: "1.2.3" } });
    for (const path of [".oxlintrc.json", "a/b/.oxlintrc.jsonc", "oxlint.config.mts"]) {
      expect(isOxlintConfigInput(p(path))).toBe(true);
    }
    expect(isOxlintConfigInput(p(".eslintignore"))).toBe(true);
    expect(isOxlintConfigInput(p("oxlint-suppressions.json"))).toBe(true);
    expect(isOxlintConfigInput(p("src/.eslintignore"))).toBe(false);
    expect(isOxlintConfigInput(p("src/a.ts"))).toBe(false);
  });
});

describe("lint's own checks on a part", { timeout: 60_000 }, () => {
  it("reads a file oxlint ignores as `unknown`, never `pass`", async () => {
    const root = project({
      ".oxlintrc.json": JSON.stringify({ ignorePatterns: ["gen/**"] }),
      "gen/g.ts": "const gUnused = 1;\n",
      "src/a.ts": "const aUnused = 1;\n",
    });
    const lint = provider(root);
    await lint.open();
    const result = report(await lint.lint([file(root, "gen/g.ts"), file(root, "src/a.ts")]));
    expect(result.results.get(p("gen/g.ts"))).toEqual({ unknown: "oxlint does not lint it now" });
    expect(result.results.get(p("src/a.ts"))).toMatchObject({
      findings: [{ rule: "eslint(no-unused-vars)" }],
    });
  });

  it("reads a file whose bytes are not the text given as `unknown`: oxlint reads the disk", async () => {
    const root = project({ "src/a.ts": "const aUnused = 1;\n" });
    const lint = provider(root);
    await lint.open();
    const result = report(await lint.lint([{ path: p("src/a.ts"), text: "export {};\n" }]));
    expect(result.results.get(p("src/a.ts"))).toEqual({ unknown: "it changed while oxlint ran" });
  });
});
