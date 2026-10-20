// THROWAWAY probe (011-core/research/edit-cut.md, question 2's trust). Squeal's static one-hop
// graph (lib.mjs) at a head against the closures Squeal stored for its own test files
// (`test_files.closure_paths`, read-only copy), both cut to code files in the tree, declared
// inputs (squeal.config.json `inputs` at the head) set apart: ../central-edits/trust.mjs for Squeal.
import { execFileSync } from "node:child_process";
import { matchesGlob } from "node:path";
import { depths, graphAt, openStore, REPOS } from "./lib.mjs";

const sha = process.argv[2] ?? "b3e190d6";
const g = graphAt("squeal", sha);
const config = JSON.parse(execFileSync("git", ["-C", REPOS.squeal.git, "show", `${sha}:squeal.config.json`], { encoding: "utf8" }));
const inputs = Object.entries(config.inputs ?? {});
const declared = (test, p) => inputs.some(([t, globs]) => matchesGlob(test, t) && globs.some((gl) => matchesGlob(p, gl)));
const db = openStore("squeal");
let n = 0, exact = 0, hit = 0, inClosure = 0, inStatic = 0;
const missed = new Map();
for (const t of db.prepare("select path, closure_paths, updated_at from test_files").all()) {
  if (!g.files.has(t.path) || t.path.startsWith("test/e2e/")) continue;
  const reach = new Set([...depths(g.edges, t.path).keys()].filter((p) => g.files.has(p)));
  const closure = new Set(JSON.parse(t.closure_paths).filter((p) => g.files.has(p) && !(declared(t.path, p) && !reach.has(p))));
  const both = [...reach].filter((p) => closure.has(p)).length;
  n++; hit += both; inClosure += closure.size; inStatic += reach.size;
  if (both === closure.size && both === reach.size) exact++;
  for (const p of closure) if (!reach.has(p)) missed.set(p, (missed.get(p) ?? 0) + 1);
}
console.log(`squeal at ${sha}: ${n} test files, exact ${exact}, recall ${(hit / inClosure).toFixed(3)}, precision ${(hit / inStatic).toFixed(3)}`);
console.log("closure paths the static graph misses, by how many closures hold them:");
for (const [p, c] of [...missed].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${c} ${p}`);
