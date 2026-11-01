#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code. Runs as squeal-e2e.
//   node repro-cwd.mjs <project root> <file>...
// Lints the files with the project's own ESLint, constructed as Squeal's worker does
// (`loadESLint({ cwd: root })`, then `new ESLint({ cwd: root })`), from whatever process
// directory this is started in. Prints the process directory and each file's rule|message list.
// Run once from the root and once from <root>/.git/squeal (the daemon's directory) to see
// whether the project's config reads process.cwd().
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, ...files] = process.argv.slice(2);
const require = createRequire(resolve(root, "package.json"));
const api = await import(pathToFileURL(require.resolve("eslint")).href);
const ESLint = api.loadESLint ? await api.loadESLint({ cwd: root }) : api.ESLint;
const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(files.map((f) => resolve(root, f)));
console.log(JSON.stringify({ processCwd: process.cwd() }));
for (const r of results)
  console.log(JSON.stringify({ file: relative(root, r.filePath), findings: r.messages.map((m) => `${m.ruleId}|${m.message}`) }));
