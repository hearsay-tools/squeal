// Throwaway (environment-at-commit): which recorded installed-dependency
// parts equal the whole fingerprint computed from a committed lockfile.
// For every distinct pnpm-lock.yaml blob on any ref since <since>, computes
// the value as installed-from-git.mjs does, then matches every descriptor in
// a store copy (copy.mjs). Usage: node installed-match.mjs <repo> <scratch store> <since>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [repo, store, since] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const commits = git("log", "--all", `--since=${since}`, "--format=%H", "--", "pnpm-lock.yaml").trim().split("\n").filter(Boolean);
const linked = (line, next) => { const i = /^( +)specifier: /.exec(line)?.[1]; return i !== undefined && next.startsWith(`${i}version: link:`); };
const filter = (t) => { const l = t.split("\n"); return l.filter((x, i) => !linked(x, l[i + 1] ?? "")).join("\n"); };
const blobs = new Map();
for (const c of [...commits, ...commits.map((c) => `${c}^`)]) {
  let blob; try { blob = git("rev-parse", `${c}:pnpm-lock.yaml`).trim(); } catch { continue; }
  if (blobs.has(blob)) continue;
  const text = git("cat-file", "blob", blob);
  const docs = text.split(/^---\n/m);
  const second = docs.length > 2 ? docs[2] : text;
  blobs.set(blob, createHash("sha256").update("node_modules/.pnpm/lock.yaml\0").update(`squeal-installed/2\0${filter(second)}`).digest("hex"));
}
const known = new Set(blobs.values());
const db = new DatabaseSync(store, { readOnly: true });
const rows = db.prepare("select descriptor, recorded_at from environments").all().map((r) => ({ ...JSON.parse(r.descriptor), at: r.recorded_at }));
const tally = {};
for (const d of rows) {
  const k = `${d.project}|${d.ci ? "ci" : "local"}`;
  const t = (tally[k] ??= { hashes: 0, wholeFromSomeLockfile: 0, other: 0, distinctOther: new Set() });
  t.hashes++;
  if (known.has(d.installedDependencies)) t.wholeFromSomeLockfile++;
  else { t.other++; t.distinctOther.add(d.installedDependencies); }
}
for (const t of Object.values(tally)) t.distinctOther = t.distinctOther.size;
console.log(JSON.stringify({ lockfileBlobs: blobs.size, tally }, null, 1));
