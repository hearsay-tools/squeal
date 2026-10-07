// Throwaway probe (001-102): npm's rule for trusting node_modules/.package-lock.json: its mtime is at least
// as recent as every package folder it lists, every listed folder exists, and no unlisted folder exists
// (the last checked at the top level only here). Usage: node freshness.mjs <worktree root>
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const t = performance.now();
const lockPath = join(root, "node_modules/.package-lock.json");
const lockTime = statSync(lockPath).mtimeMs;
const packages = JSON.parse(readFileSync(lockPath, "utf8")).packages;
const listed = Object.keys(packages).filter((k) => k.includes("node_modules/"));
const newer = [], missing = [];
for (const loc of listed) {
  // A workspace link points at a live project directory: the link itself is what npm wrote.
  try { if ((packages[loc].link ? lstatSync : statSync)(join(root, loc)).mtimeMs > lockTime) newer.push(loc); } catch { missing.push(loc); }
}
const set = new Set(listed);
const unlisted = [];
for (const e of readdirSync(join(root, "node_modules"))) {
  if (e.startsWith(".")) continue;
  const names = e.startsWith("@") ? readdirSync(join(root, "node_modules", e)).map((n) => `${e}/${n}`) : [e];
  for (const n of names) if (!set.has(`node_modules/${n}`)) unlisted.push(n);
}
console.log(JSON.stringify({ root, listed: listed.length, newer, missing: missing.length, unlistedTopLevel: unlisted, ms: +(performance.now() - t).toFixed(1) }));
