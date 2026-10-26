// Throwaway probe (017-01). One input change per case, each with its revert.
// Shared by cases.mjs (fresh process per state) and warm.mjs (one warm worker).
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

function edit(root, rel, from, to) {
  const p = join(root, rel);
  let before;
  return {
    apply: () => {
      before = readFileSync(p, "utf8");
      if (!before.includes(from)) throw new Error(`${rel}: no "${from}"`);
      writeFileSync(p, before.replace(from, to));
    },
    revert: () => writeFileSync(p, before),
  };
}

function create(root, rel, text) {
  const p = join(root, rel);
  return {
    apply: () => writeFileSync(p, text),
    revert: () => existsSync(p) && rmSync(p),
  };
}

const NAMED = "node_modules/eslint-plugin-import-x/lib/rules/named.js";
const IMPORTX_PKG = "node_modules/eslint-plugin-import-x/package.json";

// Each case: id, what it changes, the files whose findings to compare.
export function mutations(root) {
  return [
    { id: "file-edit", what: "the linted file itself: `let` -> `const`", files: ["src/a.js"],
      ...edit(root, "src/a.js", "let y", "const y") },
    { id: "config-file", what: "eslint.config.js: add id-length for *.js", files: ["src/a.js"],
      ...edit(root, "eslint.config.js", '"import-x/named": "error"', '"import-x/named": "error", "id-length": ["error", { min: 2 }]') },
    { id: "config-import", what: "eslint/local.js (a file the config imports): prefer-const off", files: ["src/a.js"],
      ...edit(root, "eslint/local.js", '"prefer-const": "error"', '"prefer-const": "off"') },
    { id: "local-rule-code", what: "eslint/rules/no-foo.js (a local rule, no meta): also report `y`", files: ["src/a.js"],
      ...edit(root, "eslint/rules/no-foo.js", 'node.name === "foo"', 'node.name === "foo" || node.name === "y"') },
    { id: "shareable-config", what: "node_modules/eslint-config-probe/index.js: add id-length, version unchanged", files: ["src/a.js"],
      ...edit(root, "node_modules/eslint-config-probe/index.js", '"no-console": "error"', '"no-console": "error", "id-length": ["error", { min: 2 }]') },
    { id: "plugin-code", what: "import-x's named rule reports on every file, version unchanged", files: ["src/a.js"],
      ...edit(root, NAMED, "create(context) {", 'create(context) {\n        context.report({ loc: { line: 1, column: 0 }, message: "probe: plugin code changed" });') },
    { id: "plugin-version", what: "import-x package.json version 4.17.1 -> 4.17.2, code unchanged", files: ["src/a.js"],
      ...edit(root, IMPORTX_PKG, '"version": "4.17.1"', '"version": "4.17.2"') },
    { id: "import-target", what: "src/b.js (imported by a.js) renames its export: import-x/named, an untyped rule", files: ["src/a.js"],
      ...edit(root, "src/b.js", "export const x", "export const w") },
    { id: "typed-program", what: "src/u.ts returns a Promise: t.ts's no-floating-promises", files: ["src/t.ts"],
      ...edit(root, "src/u.ts", "export function load(): number {\n  return 1;", "export function load(): Promise<number> {\n  return Promise.resolve(1);") },
    { id: "tsconfig", what: "tsconfig.json excludes src/t.ts", files: ["src/t.ts"],
      ...edit(root, "tsconfig.json", '"include": ["src/**/*.ts"]', '"include": ["src/**/*.ts"], "exclude": ["src/t.ts"]') },
    { id: "ignores", what: "eslint.config.js ignores src/a.js", files: ["src/a.js"],
      ...edit(root, "eslint.config.js", '"eslint.config.js"]', '"eslint.config.js", "src/a.js"]') },
    { id: "nested-config", what: "a new src/eslint.config.js with only no-console", files: ["src/a.js"],
      ...create(root, "src/eslint.config.js", 'export default [{ rules: { "no-console": "error" } }];\n') },
  ];
}
