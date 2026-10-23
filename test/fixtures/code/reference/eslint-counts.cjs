// Reference CC per function from ESLint's own `complexity` rule (classic), for 015-05's stored counts.
// Usage: DEPS=<dir with eslint and @typescript-eslint/parser> node eslint-counts.cjs <root> <out.json> [relative files...]
// (files from stdin when none are given). See ../README.md.
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const req = require("node:module").createRequire(`${process.env.DEPS ?? "/tmp/w01505/js"}/package.json`);
const { Linter } = req("eslint");
const { builtinRules } = req("eslint/use-at-your-own-risk");
const parser = req("@typescript-eslint/parser");
const complexity = builtinRules.get("complexity");
let found = [];
const rule = {
  meta: { ...complexity.meta },
  create(context) {
    const report = (d) => found.push({ name: d.data.name, cc: Number(d.data.complexity), end: d.node.loc.end, start: d.node.loc.start });
    return complexity.create(new Proxy({}, { get(_, p) { if (p === "report") return report; const v = Reflect.get(context, p, context); return typeof v === "function" ? v.bind(context) : v; } }));
  },
};
const [root, out, ...args] = process.argv.slice(2);
const files = args.length ? args : readFileSync(0, "utf8").trim().split("\n");
const linter = new Linter({ configType: "flat" });
const result = { ...(process.env.COMMIT ? { commit: process.env.COMMIT } : {}), eslint: req("eslint/package.json").version, parser: req("@typescript-eslint/parser/package.json").version, files: {}, fatal: {} };
for (const file of files) {
  found = [];
  const jsx = /\.(tsx|jsx)$/.test(file) || /\.(js|mjs|cjs)$/.test(file);
  const msgs = linter.verify(readFileSync(join(root, file), "utf8"), [{
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    languageOptions: { parser, sourceType: file.endsWith(".cjs") ? "commonjs" : "module", ecmaVersion: "latest", parserOptions: { ecmaFeatures: { jsx } } },
    plugins: { probe: { rules: { cc: rule } } },
    rules: { "probe/cc": ["error", 0] },
  }], { filename: file });
  const fatal = msgs.filter((m) => m.fatal);
  if (fatal.length) result.fatal[file] = fatal.map((m) => `${m.line}:${m.column} ${m.message}`);
  // Functions only: a class field initializer and a static block are code paths of their own, no function.
  const fns = found.filter((f) => !/^class (field initializer|static block)$/i.test(f.name));
  // [endLine, endColumn, cc], the end 1-based and just after the last character, as CodeRange.
  result.files[file] = fns.map((f) => [f.end.line, f.end.column + 1, f.cc]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
writeFileSync(out, JSON.stringify(result));
console.log(JSON.stringify({ files: files.length, functions: Object.values(result.files).reduce((a, v) => a + v.length, 0), fatal: Object.keys(result.fatal) }));
