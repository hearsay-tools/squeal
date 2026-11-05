// 011-299 probe (throwaway): question 2. Per first baseline: its start commit, whether any daemon on this host had
// recorded a clean result at that commit (or a commit with the same tree) before the baseline started, whether it is
// on origin/main, and how far it is from the newest main commit a daemon had seen; hub files changed in between.
// Usage: node startcommits.cjs <store copy> <firsts.jsonl> <git dir> [hub share, default 0.5]
const { DatabaseSync } = require("node:sqlite");
const { execFileSync } = require("child_process");
const fs = require("fs");
const [, , storePath, firstsPath, gitDir, hubArg] = process.argv;
const HUB = Number(hubArg ?? 0.5);
const db = new DatabaseSync(storePath, { readOnly: true });
const git = (...a) => execFileSync("git", ["-C", gitDir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const L = fs.readFileSync(firstsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => !x.summary);
// hub files: paths in at least HUB of the server project's closures (static and declared)
const cl = db.prepare("select closure_paths from test_files where project = 'server'").all().map((r) => JSON.parse(r.closure_paths));
const cnt = new Map(); for (const c of cl) for (const p of c) cnt.set(p, (cnt.get(p) ?? 0) + 1);
const hub = new Set([...cnt].filter(([, n]) => n >= HUB * cl.length).map(([p]) => p));
// commits seen: the first clean result recorded at each commit, any worktree; revision heads of live worktrees
const seenAt = new Map();
for (const r of db.prepare("select commit_sha c, min(recorded_at) t from results where dirty = 0 and commit_sha is not null group by commit_sha").all()) seenAt.set(r.c, r.t);
for (const r of db.prepare("select head c, min(created_at) t from revisions where head is not null and dirty = 0 group by head").all()) seenAt.set(r.c, Math.min(seenAt.get(r.c) ?? Infinity, r.t));
const treeOf = new Map(); const tree = (c) => { if (!treeOf.has(c)) { try { treeOf.set(c, git("rev-parse", c + "^{tree}")); } catch { treeOf.set(c, null); } } return treeOf.get(c); };
const seenTrees = new Map(); for (const [c, t] of seenAt) { const tr = tree(c); if (tr) seenTrees.set(tr, Math.min(seenTrees.get(tr) ?? Infinity, t)); }
const mainList = git("rev-list", "--first-parent", "origin/main", "--since=2026-10-25").split("\n");
const mainIdx = new Map(mainList.map((c, i) => [c, i]));
// start commit per checkpoint, as classes.cjs
const start = new Map(), secOf = new Map(), Tof = new Map();
for (const x of L) { secOf.set(x.ck, (secOf.get(x.ck) ?? 0) + x.sec); Tof.set(x.ck, x.T); if (x.commit && x.rev === x.ckRev && !start.has(x.ck)) start.set(x.ck, x.commit); }
const out = [];
for (const [ck, T] of Tof) {
  let X0 = start.get(ck) ?? null;
  if (!X0) { const y = L.filter((x) => x.ck === ck && x.commit).sort((a, b) => a.rs - b.rs)[0]; X0 = y?.commit ?? null; }
  const o = { ck, T, sec: secOf.get(ck), X0, onMain: X0 !== null && mainIdx.has(X0) };
  if (X0) {
    o.seenCommit = (seenAt.get(X0) ?? Infinity) < T; o.seenTree = (seenTrees.get(tree(X0)) ?? Infinity) < T;
    // the newest main commit at or before X0's main position (or X0's merge base with main) that a daemon had seen before T
    let base = X0; if (!o.onMain) { try { base = git("merge-base", X0, "origin/main"); } catch { base = null; } }
    o.branchCommits = base && base !== X0 ? Number(git("rev-list", "--count", base + ".." + X0)) : 0;
    if (base && mainIdx.has(base)) {
      let i = mainIdx.get(base); while (i < mainList.length && !((seenAt.get(mainList[i]) ?? Infinity) < T)) i++;
      o.mainBehindSeen = i - mainIdx.get(base); const seen = mainList[i];
      if (seen && o.mainBehindSeen > 0) {
        const ch = git("diff", "--no-renames", "--name-only", seen, base).split("\n").filter(Boolean);
        o.changedSinceSeen = ch.length; o.hubChanged = ch.filter((p) => hub.has(p)).length;
        o.lockChanged = ch.includes("pnpm-lock.yaml");
      }
    }
  }
  out.push(o);
}
fs.writeFileSync(firstsPath.replace(/firsts\.jsonl$/, "starts.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const s = (f) => { const xs = out.filter(f); return `${xs.length} baselines, ${Math.round(xs.reduce((a, o) => a + o.sec, 0))} s`; };
console.log(`hub files (in >= ${HUB * 100}% of ${cl.length} server closures): ${hub.size}`);
console.log("all:", s(() => true));
console.log("start commit seen before by a daemon (clean result or revision head):", s((o) => o.seenCommit));
console.log("not seen, but a commit with the same tree was:", s((o) => !o.seenCommit && o.seenTree));
console.log("tree never seen:", s((o) => o.X0 && !o.seenTree));
console.log("  of it on origin/main:", s((o) => o.X0 && !o.seenTree && o.onMain), "; a branch commit:", s((o) => o.X0 && !o.seenTree && !o.onMain));
console.log("start on main or branched from main, main commits since the newest seen main commit: 0:", s((o) => o.mainBehindSeen === 0), "1-3:", s((o) => o.mainBehindSeen >= 1 && o.mainBehindSeen <= 3), ">3:", s((o) => o.mainBehindSeen > 3));
const beh = out.filter((o) => o.mainBehindSeen > 0);
console.log("of those behind: hub file changed:", s((o) => o.mainBehindSeen > 0 && o.hubChanged > 0), "; lockfile changed:", s((o) => o.mainBehindSeen > 0 && o.lockChanged));
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
console.log("behind: median main commits", med(beh.map((o) => o.mainBehindSeen)), "median files changed", med(beh.map((o) => o.changedSinceSeen ?? 0)), "median hub files", med(beh.map((o) => o.hubChanged ?? 0)));
console.log("branch commits on top of main: 0:", s((o) => o.branchCommits === 0), ">0:", s((o) => o.branchCommits > 0));
