// Throwaway probe (row 025-14). Splits an esbuild bundle (not minified) at its
// `// <source path>` module comments and sums the bytes per source path.
// Usage: node sections.mjs <bundle.mjs | -> [--group]   ('-' reads stdin)
import { readFileSync } from "node:fs";

export function sections(text) {
  const bytes = new Map();
  let current = "(banner)";
  for (const line of text.split("\n")) {
    const m = /^\/\/ ((?:src|node_modules|plugins)\/\S+)$/.exec(line);
    if (m) current = m[1];
    bytes.set(current, (bytes.get(current) ?? 0) + Buffer.byteLength(line) + 1);
  }
  return bytes;
}

/** `src/core/delivery/x.ts` -> `core/delivery`; `src/harness/claude-code/x` -> `harness/claude-code`. */
export function groupOf(path) {
  const p = path.split("/");
  if (p[0] === "node_modules") return `npm:${p[1].startsWith("@") ? `${p[1]}/${p[2]}` : p[1]}`;
  if (p[0] !== "src") return path;
  if (p.length <= 3) return `${p[1]}/${p.length === 3 ? "(root)" : ""}`;
  return `${p[1]}/${p[2]}`;
}

export function grouped(bytes) {
  const g = new Map();
  for (const [path, n] of bytes) g.set(groupOf(path), (g.get(groupOf(path)) ?? 0) + n);
  return g;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const text = readFileSync(file === "-" ? 0 : file, "utf8");
  const b = process.argv.includes("--group") ? grouped(sections(text)) : sections(text);
  const rows = [...b].sort((x, y) => y[1] - x[1]);
  for (const [k, v] of rows) console.log(`${String(v).padStart(8)}  ${k}`);
}
