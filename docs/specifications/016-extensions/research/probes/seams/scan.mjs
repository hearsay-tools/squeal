// Throwaway probe for 016-extensions/research/seams.md (brief 016-01). Not product code.
// Reads src/ only and prints, with file and line:
//   A. imports (static and dynamic) from src/core or src/cli into src/runners or src/harness;
//   B. imports from src/harness into src/runners or src/cli;
//   C. imports between runner folders (src/runners/<a> into src/runners/<b>);
//   D. code lines (not comments) in core, cli and harness/shared that name a runner or a harness.
// Usage: node scan.mjs <repo root>
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const src = join(root, "src");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|mjs|cjs)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

const files = walk(src).map((p) => relative(root, p));
const IMPORT = /(?:from\s+|import\(\s*)["'](\.[^"']+)["']/g;
const layer = (p) => {
  const m = /^src\/(core|cli|runners|harness)\/([^/.]+)/.exec(p);
  return m === null ? null : { top: m[1], sub: m[2] };
};
const isComment = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

const edges = [];
for (const file of files) {
  const lines = readFileSync(join(root, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const m of line.matchAll(IMPORT)) {
      const target = relative(root, resolve(root, dirname(file), m[1]));
      edges.push({ file, line: i + 1, target, from: layer(file), to: layer(target) });
    }
  });
}

const print = (title, rows) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows) console.log(`${r.file}:${r.line} -> ${r.target}`);
};
const has = (l, top) => l !== null && l.top === top;
print(
  "A. core or cli -> runners or harness",
  edges.filter((e) => (has(e.from, "core") || has(e.from, "cli")) && (has(e.to, "runners") || has(e.to, "harness"))),
);
print(
  "B. harness -> runners or cli",
  edges.filter((e) => has(e.from, "harness") && (has(e.to, "runners") || has(e.to, "cli"))),
);
print(
  "C. runner folder -> another runner folder",
  edges.filter((e) => has(e.from, "runners") && has(e.to, "runners") && e.from.sub !== e.to.sub && e.to.sub !== "focus" && e.to.sub !== "run-summary"),
);

const RUNNER = /vitest|node-?test|nodeTest|pytest/i;
// Case-sensitive, and spec 015's `openCodeStore` and `OpenCodeStoreOptions` are dropped first.
const HARNESS = /[Cc]laude|CLAUDE|[Cc]odex|CODEX|OpenCode|opencode|OPENCODE|\bpi\b|\bPi\b|PI_SESSION/;
const named = { runner: new Map(), harness: new Map() };
for (const file of files) {
  if (!/^src\/(core|cli|harness\/shared)\//.test(file)) continue;
  const lines = readFileSync(join(root, file), "utf8").split("\n");
  for (const line of lines) {
    if (isComment(line)) continue;
    if (RUNNER.test(line)) named.runner.set(file, (named.runner.get(file) ?? 0) + 1);
    if (HARNESS.test(line.replace(/[Oo]penCodeStore/g, ""))) named.harness.set(file, (named.harness.get(file) ?? 0) + 1);
  }
}
for (const [kind, map] of Object.entries(named)) {
  const rows = [...map].sort((a, b) => b[1] - a[1]);
  const byTop = {};
  for (const [f, n] of rows) {
    const top = /^src\/(core|cli|harness\/shared)/.exec(f)[1];
    byTop[top] = { files: (byTop[top]?.files ?? 0) + 1, lines: (byTop[top]?.lines ?? 0) + n };
  }
  console.log(`\n## D. code lines naming a ${kind}: ${JSON.stringify(byTop)}`);
  for (const [f, n] of rows) console.log(`${n}\t${f}`);
}
