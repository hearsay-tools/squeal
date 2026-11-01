import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintRunReport } from "../../../src/core/lint/provider/index.js";
import { cli, onDisk, project, provider, write } from "./helpers.js";

/*
 * Row 017-17 (`lessons.md` L3): the worker runs ESLint from the project
 * root. A config whose resolver reads a tsconfig by a path relative to the
 * process directory gives the CLI's findings, though the daemon's process
 * directory is elsewhere.
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

describe("the worker's process directory (row 017-17)", () => {
  it("is the project root: a resolver that reads a tsconfig relative to it gives the CLI's findings", async () => {
    const root = project("hazard");
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      write(root, path, text);
    }
    expect(process.cwd()).not.toBe(realpathSync(root));

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
});
