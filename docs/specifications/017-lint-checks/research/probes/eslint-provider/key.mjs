// Throwaway probe (017-01). Fresh process: computed config facts and findings
// for each file. Usage: node key.mjs <project root> <file>...
import { loadProjectESLint, configFacts, findings } from "./lib.mjs";

const [root, ...files] = process.argv.slice(2);
process.chdir(root);
const { ESLint, version } = await loadProjectESLint(root);
const eslint = new ESLint({ cwd: root });
const out = { eslint: version, files: {} };
for (const file of files) {
  const facts = await configFacts(eslint, file);
  const res = facts.ignored ? [] : await eslint.lintFiles([file]);
  out.files[file] = { ...facts, findings: findings(res)[0]?.messages ?? [] };
  if (process.env.SHOW_JSON !== "1") delete out.files[file].json;
}
console.log(JSON.stringify(out));
