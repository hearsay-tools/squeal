// Throwaway probe (row 025-14). Per release step, the groups and source files
// that added the most bytes to a committed hook bundle, read from the module
// comments of `plugins/claude-code/dist/<hook>.mjs` at each ref.
// Usage: node growth.mjs <hook> <ref>...   (run from the repository root)
import { execFileSync } from "node:child_process";
import { grouped, sections } from "./sections.mjs";

const [hook, ...refs] = process.argv.slice(2);
const read = (ref) =>
  execFileSync("git", ["show", `${ref}:plugins/claude-code/dist/${hook}.mjs`], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
const top = (a, b, n) => {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys]
    .map((k) => [k, (b.get(k) ?? 0) - (a.get(k) ?? 0), a.has(k) ? "" : " (new)"])
    .filter(([, d]) => d !== 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n);
};
let prev = null;
for (const ref of refs) {
  const text = read(ref);
  const s = sections(text);
  const total = Buffer.byteLength(text);
  console.log(`\n## ${hook} @ ${ref}: ${total} bytes, ${s.size - 1} source files`);
  if (prev) {
    console.log(`  +${total - prev.total} bytes, ${s.size - prev.s.size >= 0 ? "+" : ""}${s.size - prev.s.size} files since ${prev.ref}`);
    console.log("  groups:", top(grouped(prev.s), grouped(s), 8).map(([k, d, n]) => `${k} ${d > 0 ? "+" : ""}${d}${n}`).join(", "));
    console.log("  files:");
    for (const [k, d, n] of top(prev.s, s, 12)) console.log(`    ${String(d).padStart(7)}  ${k}${n}`);
  }
  prev = { ref, s, total };
}
