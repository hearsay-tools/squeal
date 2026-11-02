import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshLevel } from "../../../src/core/lint/pass/refresh.js";
import type { LintRunReport, LintSnapshot } from "../../../src/core/lint/provider/index.js";
import { cli, type Major, onDisk, project, provider, write } from "./helpers.js";

/*
 * Row 017-24 (`lessons.md` L7; D3 step 4, D5): under ESLint 9 with a nested
 * `eslint.config.*`, the worker adds `v10_config_lookup_from_file` to
 * `ESLINT_FLAGS`, so each file uses its nearest config, as ESLint 10 does.
 * `ESLINT_FLAGS` is keyed. Without a nested config, nothing changes.
 */

const FLAG = "v10_config_lookup_from_file";
const NESTED = "packages/app/eslint.config.js";

const ROOT_CONFIG = `export default [
  { ignores: ["eslint/**", "**/eslint.config.js"] },
  { rules: { "no-debugger": "error" } },
];
`;

const FILES: Readonly<Record<string, string>> = {
  "eslint.config.js": ROOT_CONFIG,
  [NESTED]: 'export default [{ rules: { "no-console": "error" } }];\n',
  "packages/app/src/a.js": 'debugger;\nconsole.log("a");\n',
  "src/b.js": 'debugger;\nconsole.log("b");\n',
};

const PATHS = ["packages/app/src/a.js", "src/b.js"];

/** The hazard fixture's tools with `FILES`, the nested config left out unless `nested`. */
function fixture(major: Major, nested = true): string {
  const root = project("hazard", major);
  for (const [path, text] of Object.entries(FILES)) {
    if (path === NESTED && !nested) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    write(root, path, text);
  }
  return root;
}

/** Each file's rules, in the order of its findings. */
function rules(report: LintRunReport): Record<string, (string | null)[]> {
  const out: Record<string, (string | null)[]> = {};
  for (const [path, result] of report.results) {
    out[path] = "findings" in result ? result.findings.map((f) => f.rule) : [result.unknown];
  }
  return out;
}

describe("ESLint 9 with a nested config (row 017-24)", () => {
  it("lints each file with its nearest config, as ESLint 10 does, and keys the flag", async () => {
    const root = fixture(9);
    const eslint = provider(root);
    await eslint.open();
    const snapshot = (await eslint.refresh("none")) as LintSnapshot;
    expect(snapshot.env).toEqual({ ESLINT_FLAGS: FLAG, TSESTREE_SINGLE_RUN: "false" });

    const report = (await eslint.lint(onDisk(root, PATHS))) as LintRunReport;
    // The nested config loads with its first file, and joins the closure.
    expect(report.closure).toContain(NESTED);
    expect(report.results).toEqual(cli(fixture(10), PATHS));
    expect(report.results).toEqual(cli(root, PATHS, { ESLINT_FLAGS: FLAG }));
    expect(rules(report)).toEqual({
      "packages/app/src/a.js": ["no-console"],
      "src/b.js": ["no-debugger"],
    });
  }, 60_000);

  it("adds nothing without a nested config; one added or removed moves the flag at an instance refresh", async () => {
    const root = fixture(9, false);
    const eslint = provider(root);
    await eslint.open();
    let snapshot = (await eslint.refresh("none")) as LintSnapshot;
    expect(snapshot.env).toEqual({ TSESTREE_SINGLE_RUN: "false" });
    const lint = async () => (await eslint.lint(onDisk(root, PATHS))) as LintRunReport;
    let report = await lint();
    expect(report.results).toEqual(cli(root, PATHS));
    expect(rules(report)["packages/app/src/a.js"]).toEqual(["no-debugger"]);

    write(root, NESTED, FILES[NESTED] ?? "");
    expect(refreshLevel([NESTED], snapshot.declaration, snapshot.closure)).toBe("instance");
    snapshot = (await eslint.refresh("instance")) as LintSnapshot;
    expect(snapshot.env).toEqual({ ESLINT_FLAGS: FLAG, TSESTREE_SINGLE_RUN: "false" });
    report = await lint();
    expect(report.results).toEqual(cli(root, PATHS, { ESLINT_FLAGS: FLAG }));
    expect(rules(report)["packages/app/src/a.js"]).toEqual(["no-console"]);

    rmSync(join(root, NESTED));
    expect(refreshLevel([NESTED], snapshot.declaration, snapshot.closure)).toBe("instance");
    snapshot = (await eslint.refresh("instance")) as LintSnapshot;
    expect(snapshot.env).toEqual({ TSESTREE_SINGLE_RUN: "false" });
    report = await lint();
    expect(report.results).toEqual(cli(root, PATHS));
  }, 60_000);
});

describe("the daemon's ESLINT_FLAGS (row 017-24, D5)", () => {
  it.each([
    {
      given: "unstable_native_nodejs_ts_config",
      nested: false,
      keyed: "unstable_native_nodejs_ts_config",
    },
    {
      given: "unstable_native_nodejs_ts_config",
      nested: true,
      keyed: `unstable_native_nodejs_ts_config,${FLAG}`,
    },
    { given: FLAG, nested: true, keyed: FLAG },
  ])(
    "$given, nested $nested: keyed as $keyed",
    async ({ given, nested, keyed }) => {
      const root = fixture(9, nested);
      const eslint = provider(root, { env: { ESLINT_FLAGS: given } });
      await eslint.open();
      const snapshot = (await eslint.refresh("none")) as LintSnapshot;
      expect(snapshot.env).toEqual({ ESLINT_FLAGS: keyed, TSESTREE_SINGLE_RUN: "false" });
      const report = (await eslint.lint(onDisk(root, PATHS))) as LintRunReport;
      expect(report.results).toEqual(cli(root, PATHS, { ESLINT_FLAGS: keyed }));
    },
    60_000,
  );
});

describe("ESLint 10 with a nested config", () => {
  it("adds no flag: its own lookup is the nearest config", async () => {
    const root = fixture(10);
    const eslint = provider(root);
    await eslint.open();
    const snapshot = (await eslint.refresh("none")) as LintSnapshot;
    expect(snapshot.env).toEqual({ TSESTREE_SINGLE_RUN: "false" });
    const report = (await eslint.lint(onDisk(root, PATHS))) as LintRunReport;
    expect(report.results).toEqual(cli(root, PATHS));
    expect(rules(report)["packages/app/src/a.js"]).toEqual(["no-console"]);
  }, 60_000);
});
