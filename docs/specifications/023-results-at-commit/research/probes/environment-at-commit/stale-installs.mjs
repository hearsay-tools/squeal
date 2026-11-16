// Throwaway (environment-at-commit): for each live worktree of a store copy
// (copy.mjs), whether the installed-dependency part its daemon keys with
// equals the value computed from the lockfile committed at its HEAD
// (installed-from-git.mjs). Reads each worktree's HEAD with rev-parse only.
// Usage: node stale-installs.mjs <scratch store>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const linked = (l, n) => { const i = /^( +)specifier: /.exec(l)?.[1]; return i !== undefined && n.startsWith(`${i}version: link:`); };
const whole = (text) => { const d = text.split(/^---\n/m); const s = d.length > 2 ? d[2] : text; const l = s.split("\n"); return createHash("sha256").update("node_modules/.pnpm/lock.yaml\0").update(`squeal-installed/2\0${l.filter((x, i) => !linked(x, l[i + 1] ?? "")).join("\n")}`).digest("hex"); };
const out = { worktrees: 0, equal: 0, differs: 0, noInstall: 0, rows: [] };
for (const w of db.prepare("select id, root from worktrees").all()) {
  if (!existsSync(w.root)) continue;
  const env = db.prepare("select e.descriptor from worktree_environment_hashes h join environments e on e.hash = h.hash where h.worktree_id = ? limit 1").get(w.id);
  if (!env) continue;
  let head, text;
  try { head = execFileSync("git", ["-C", w.root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); text = execFileSync("git", ["-C", w.root, "show", "HEAD:pnpm-lock.yaml"], { encoding: "utf8", maxBuffer: 1 << 28 }); } catch { continue; }
  const recorded = JSON.parse(env.descriptor).installedDependencies;
  out.worktrees++;
  if (recorded === "none") out.noInstall++;
  else if (recorded === whole(text)) out.equal++;
  else out.differs++;
  out.rows.push({ root: w.root.replace(/.*\//, ""), head: head.slice(0, 9), equal: recorded === whole(text) });
}
console.log(JSON.stringify(out));
