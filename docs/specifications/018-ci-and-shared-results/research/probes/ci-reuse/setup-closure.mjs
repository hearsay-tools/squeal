// Throwaway (018-04). The globalSetup closure of this repository as Vite sees
// it: each file is stripped of TypeScript by esbuild (as Vite's transform
// does, so imports used only as types drop out), then its relative imports
// are followed. Reads files at a git revision; runs no test.
// Usage: node setup-closure.mjs <repo> <rev> <esbuild module path>
import { execFileSync } from "node:child_process";
import { posix as path } from "node:path";
const [repo, rev, esbuildPath] = process.argv.slice(2);
const { transformSync } = await import(esbuildPath);
const show = (p) => { try { return execFileSync("git", ["-C", repo, "show", `${rev}:${p}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const seen = new Set();
const todo = ["test/global-teardown.ts"];
while (todo.length > 0) {
  const p = todo.pop();
  if (seen.has(p)) continue;
  const src = show(p);
  if (src === null) continue;
  seen.add(p);
  const js = transformSync(src, { loader: "ts", format: "esm" }).code;
  for (const m of js.matchAll(/(?:import|export)\s*(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2];
    todo.push(path.normalize(path.join(path.dirname(p), spec)).replace(/\.js$/, ".ts"));
  }
}
const files = [...seen].sort();
process.stdout.write(`${JSON.stringify({ rev, files, reachesCoreTypes: files.filter((f) => f.startsWith("src/core/types/")) })}\n`);
