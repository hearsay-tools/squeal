// Throwaway probe (017-01). Which files enter a typed file's findings: the
// program the project service builds for it. Usage: node program.mjs <root> <file>
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";

const [root, file] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const parser = require("@typescript-eslint/parser");
const abs = join(root, file);
const { services } = parser.parseForESLint(readFileSync(abs, "utf8"), { filePath: abs, projectService: true, tsconfigRootDir: root, sourceType: "module" });
const files = services.program.getSourceFiles().map((s) => relative(root, s.fileName));
const kinds = { project: [], typescriptLib: 0, otherPackages: [] };
for (const f of files) {
  if (f.startsWith("node_modules/typescript/lib/")) kinds.typescriptLib++;
  else if (f.includes("node_modules/")) kinds.otherPackages.push(f);
  else kinds.project.push(f);
}
console.log(JSON.stringify({ file, typescript: require("typescript").version, total: files.length, ...kinds }));
