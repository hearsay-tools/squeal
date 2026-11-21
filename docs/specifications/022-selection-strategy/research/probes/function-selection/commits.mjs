// Throwaway: the first-parent commits of a branch in a window as edits for
// population.mjs (POP_COMMITS=<this output>): each commit's whole diff from
// its first parent, blob ids from git, the commit time as the edit's time.
//   node commits.mjs <git-dir> <branch> <since-iso> <until-iso> <out.json>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const [gitDir, branch, since, until, out] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["--git-dir", gitDir, ...a], { encoding: "utf8", maxBuffer: 1e9 });
const shas = git("log", "--first-parent", "--format=%H %ct", `--since=${since}`, `--until=${until}`, branch).trim().split("\n").filter(Boolean);
const commits = [];
for (const line of shas) {
  const [sha, ct] = line.split(" ");
  const diff = git("diff-tree", "-r", "--no-renames", "--no-commit-id", `${sha}^`, sha).trim().split("\n").filter(Boolean);
  const Z = "0".repeat(40);
  const changes = diff.map((l) => { const [meta, path] = l.split("\t"); const [, , a, b] = meta.split(" "); return { path, oldHash: a === Z ? null : a, newHash: b === Z ? null : b }; });
  commits.push({ sha, at: Number(ct) * 1000, changes });
}
writeFileSync(out, JSON.stringify(commits));
console.log(commits.length, "commits", commits.reduce((a, c) => a + c.changes.length, 0), "changes");
