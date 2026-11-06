// Throwaway probe for row 011-303 (issue #154). Read-only. The same walk as
// `findConfigs` in src/core/lint/provider/oxlint/configs.ts (0.1.407): every
// directory below the root except `node_modules` and `.git`, gitignored ones
// included, with synchronous `readdirSync`. It counts what the walk reads and
// times it; it lists the oxlint configs it finds. It writes nothing.
//
//   node configwalk.mjs <worktree-root>
import { readdirSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

const root = process.argv[2];
if (root === undefined) {
  console.error("usage: node configwalk.mjs <worktree-root>");
  process.exit(2);
}
const SKIP = new Set(["node_modules", ".git"]);
const CONFIG_NAMES = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"];
let dirs = 0;
let entries = 0;
const found = [];
const topLevel = new Map();
const walk = (dir) => {
  let list;
  try {
    list = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  dirs++;
  entries += list.length;
  const top = dir.split("/").slice(0, 3).join("/");
  topLevel.set(top, (topLevel.get(top) ?? 0) + list.length);
  for (const entry of list) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory() && !SKIP.has(entry.name)) walk(rel);
    else if (CONFIG_NAMES.includes(entry.name)) found.push(rel);
  }
};
const load = loadavg()[0];
const start = performance.now();
walk("");
const ms = Math.round(performance.now() - start);
const biggest = [...topLevel].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(JSON.stringify({ root, load1: load, ms, dirs, entries, configs: found, biggest }, null, 1));
