import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintRunReport } from "../../../src/core/lint/provider/index.js";
import { cli, onDisk, project, provider, write } from "./helpers.js";

/*
 * Row 017-17 (`lessons.md` L3): the worker runs ESLint from the project
 * root. A config whose resolver reads a tsconfig by a path relative to the
 * process directory gives the CLI's findings, though the daemon's process
 * directory is elsewhere. Row 017-27 (review 0.1.391 N1): so do a
 * resolver's probes that read no bytes, as `statSync`, `existsSync` and
 * `readdirSync` with a relative path.
 */

/** Two rules that read `tsconfig.base.json` as an import resolver's `project` setting does. */
const RESOLVER = `import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unresolved = (read) => ({
  meta: { type: "problem", schema: [] },
  create(context) {
    let paths = {};
    try {
      paths = JSON.parse(read()).compilerOptions.paths;
    } catch {}
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source.startsWith("@sb/") && !(source in paths))
          context.report({ node, message: "Unable to resolve path to module '" + source + "'." });
      },
    };
  },
});

export default {
  rules: {
    // eslint-import-resolver-typescript resolves \`project\` against process.cwd().
    resolved: unresolved(() => readFileSync(resolve("tsconfig.base.json"), "utf8")),
    // A relative path read as it is: the process directory decides it.
    relative: unresolved(() => readFileSync("tsconfig.base.json", "utf8")),
  },
};
`;

const FILES: Readonly<Record<string, string>> = {
  "eslint.config.js": `import resolver from "./eslint/resolver.js";

export default [
  { ignores: ["eslint/**", "eslint.config.js"] },
  {
    plugins: { resolver },
    rules: { "resolver/resolved": "error", "resolver/relative": "error", "no-unused-vars": "error" },
  },
];
`,
  "eslint/resolver.js": RESOLVER,
  "tsconfig.base.json": '{ "compilerOptions": { "paths": { "@sb/a": ["src/a.js"] } } }\n',
  "src/a.js": "export const a = 1;\n",
  "src/app.js":
    'import { a } from "@sb/a";\nimport { b } from "@sb/b";\nlet unused;\nexport { a, b };\n',
};

/**
 * Two rules that probe before they read: TypeScript's own tsconfig lookup
 * and listing, as a resolver uses them, and a folder's probes made directly.
 * In the daemon's directory, each probe takes another branch.
 */
const PROBE = `import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";

const ts = createRequire(import.meta.url)("typescript");

const rule = (check) => ({
  meta: { type: "problem", schema: [] },
  create: (context) => ({
    Program(node) {
      const message = check(relative(process.cwd(), context.filename));
      if (message !== null) context.report({ node, message });
    },
  }),
});

export default {
  rules: {
    program: rule((file) => {
      const config = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.lint.json");
      if (config === undefined) return "No tsconfig.lint.json above " + file + ".";
      const json = ts.readConfigFile(config, ts.sys.readFile).config;
      const names = ts
        .parseJsonConfigFileContent(json, ts.sys, ".")
        .fileNames.map((name) => relative(process.cwd(), resolve(name)));
      return names.includes(file) ? null : file + " is outside " + config + ": " + names.join(", ") + ".";
    }),
    folder: rule((file) => {
      const folder = dirname(file);
      if (!existsSync(folder) || !statSync(folder).isDirectory()) return "Folder " + folder + " is missing.";
      const names = readdirSync(folder).filter((name) => name.endsWith(".js"));
      return "Folder " + folder + " holds " + names.sort().join(", ") + ".";
    }),
  },
};
`;

const PROBED: Readonly<Record<string, string>> = {
  "eslint.config.js": `import probe from "./eslint/probe.js";

export default [
  { ignores: ["eslint/**", "eslint.config.js"] },
  { plugins: { probe }, rules: { "probe/program": "error", "probe/folder": "error" } },
];
`,
  "eslint/probe.js": PROBE,
  "tsconfig.lint.json":
    '{ "compilerOptions": { "allowJs": true }, "include": ["src"], "exclude": ["src/legacy"] }\n',
  "src/a.js": "export const a = 1;\n",
  "src/legacy/old.js": "export const old = 1;\n",
};

/** A copy of the hazard fixture's tools with `files` in place of its sources. */
function fixture(files: Readonly<Record<string, string>>): string {
  const root = project("hazard");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    write(root, path, text);
  }
  expect(process.cwd()).not.toBe(realpathSync(root));
  return root;
}

describe("the worker's process directory (row 017-17)", () => {
  it("is the project root: a resolver that reads a tsconfig relative to it gives the CLI's findings", async () => {
    const root = fixture(FILES);
    const eslint = provider(root);
    await eslint.open();
    await eslint.refresh("none");
    const paths = ["src/a.js", "src/app.js"];
    const report = (await eslint.lint(onDisk(root, paths))) as LintRunReport;

    const expected = cli(root, paths);
    expect(report.results).toEqual(expected);
    // Only the import the tsconfig does not name: the tsconfig was read.
    expect(expected.get("src/app.js")).toEqual({
      findings: [
        expect.objectContaining({ rule: "resolver/resolved", line: 2 }),
        expect.objectContaining({ rule: "resolver/relative", line: 2 }),
        expect.objectContaining({ rule: "no-unused-vars", line: 3 }),
      ],
    });
  }, 30_000);

  it("is the project root for probes that read no bytes: a real resolver's lookup gives the CLI's findings (row 017-27)", async () => {
    const root = fixture(PROBED);
    const eslint = provider(root);
    await eslint.open();
    await eslint.refresh("none");
    const paths = ["src/a.js", "src/legacy/old.js"];
    const report = (await eslint.lint(onDisk(root, paths))) as LintRunReport;

    const expected = cli(root, paths);
    expect(report.results).toEqual(expected);
    // TypeScript found the tsconfig and listed the root's folders.
    expect(expected.get("src/legacy/old.js")).toEqual({
      findings: [
        expect.objectContaining({
          rule: "probe/program",
          message: "src/legacy/old.js is outside tsconfig.lint.json: src/a.js, src/ok.js.",
        }),
        expect.objectContaining({
          rule: "probe/folder",
          message: "Folder src/legacy holds old.js.",
        }),
      ],
    });
  }, 30_000);
});
