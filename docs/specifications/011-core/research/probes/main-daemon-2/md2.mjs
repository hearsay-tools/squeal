// 011-300 probe (throwaway): a daemon on the main checkout that validates origin/main after each pull, simulated
// over the window. Cost (questions 1), saving (2) and waiting (3).
// Usage: MD_ENV=0|1 node md2.mjs <store copy> <fileruns.jsonl> <git dir> <squeal.config.json> <fromISO> <toISO> <rates csv> <out prefix>
// - Content: 011-157's closure signature (../main-daemon/sig.mjs): stored closure + observed set + declared inputs as
//   git blobs at a commit; MD_ENV=1 adds every vitest config and the root lockfile (stricter: a lower bound of equality).
// - Main commits: first-parent origin/main. A commit "lands" when this host's origin/main reflog first reaches it
//   (a fetch or push in any checkout), else at its committer time.
// - Stored before: a clean (dirty = 0) result row of any worktree at a commit with the same signature, by its
//   recorded_at. The main daemon looks up before it runs each file (lookup-then-run-missing; tier selection re-reads
//   the store, claims.ts peekClaim), and skips a file stored at equal content.
// - The daemon runs one queue at <rate> recorded s per wall minute. A new target replaces the queue (a later commit
//   supersedes a queued file); a running file finishes. Seconds per file: median of its ended runs in fileruns.
// - Policies: every main commit; every Nth; only a commit followed by Q quiet minutes.
// - Saving: a worktree file run (not the main checkout) is spared when the main daemon finished its file at the run's
//   committed content before the run started. Dirty runs are compared by their commit (as 011-299); reported apart.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makeSig } from "../main-daemon/sig.mjs";
const [, , storePath, frPath, gitDir, configPath, fromIso, toIso, ratesArg, outPrefix] = process.argv;
const T0 = Date.parse(fromIso), T1 = Date.parse(toIso);
const db = new DatabaseSync(storePath, { readOnly: true });
const { sig, tree, closures } = makeSig(db, gitDir, configPath);
const git = (...a) => execFileSync("git", ["--git-dir", gitDir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// main commits and landing times
const chain = git("rev-list", "--first-parent", "--format=%H %ct", "--since=" + new Date(T0 - 3 * 86400e3).toISOString(), "origin/main").split("\n").filter((l) => l && !l.startsWith("commit ")).map((l) => { const [h, t] = l.split(" "); return { h, ct: Number(t) * 1000 }; }).reverse();
const pos = new Map(chain.map((c, i) => [c.h, i]));
const reflog = readFileSync(gitDir + "/logs/refs/remotes/origin/main", "utf8").trim().split("\n").map((l) => { const [, sha] = l.split(" "); const m = l.match(/> (\d+) [+-]\d{4}\t/); return { sha, t: Number(m[1]) * 1000 }; }).filter((e) => pos.has(e.sha));
const landed = chain.map((c) => c.ct);
for (const e of reflog) { const p = pos.get(e.sha); for (let i = p; i >= 0 && (landed[i] === chain[i].ct || landed[i] > e.t); i--) { if (landed[i] === chain[i].ct || e.t < landed[i]) landed[i] = Math.max(chain[i].ct, Math.min(landed[i] === chain[i].ct ? Infinity : landed[i], e.t)); } }
const mains = chain.map((c, i) => ({ ...c, at: landed[i] }));
const start = mains.findLastIndex((m) => m.at < T0); // the commit validated when the window opens
const inWin = mains.slice(start + 1).filter((m) => m.at < T1);
log(`main commits: chain ${mains.length}, in window ${inWin.length}, landing lag after commit p50 ${(() => { const d = inWin.map((m) => (m.at - m.ct) / 60e3).sort((a, b) => a - b); return d[d.length >> 1]?.toFixed(1); })()} min`);

// seconds per file
const L = readFileSync(frPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const durs = new Map();
for (const x of L) if (x.ended && x.sec > 0) (durs.get(x.file) ?? durs.set(x.file, []).get(x.file)).push(x.sec);
const secOf = new Map([...durs].map(([f, a]) => { a.sort((p, q) => p - q); return [f, a[a.length >> 1]]; }));
const files = [...closures.keys()];
let noDur = 0;
const filesAt = new Map();
const listAt = (c) => { if (!filesAt.has(c)) { const t = tree(c); filesAt.set(c, t ? files.filter((f) => t.has(f.split("\0")[1])) : []); } return filesAt.get(c); };

// stored before: (file, signature) -> earliest recorded_at of a clean row
const stored = new Map();
const rows = db.prepare("select c.project || char(0) || c.test_path f, r.commit_sha c, min(r.recorded_at) t from results r join checks c on c.id = r.check_id where r.dirty = 0 and r.commit_sha is not null group by 1, 2").all();
log(`clean (file, commit) pairs: ${rows.length}`);
let n = 0;
for (const r of rows) { if (!closures.has(r.f)) continue; const s = sig(r.f, r.c); if (!s) continue; const k = r.f + "@" + s; if (!(stored.get(k) <= r.t)) stored.set(k, r.t); if (++n % 100000 === 0) log(`signed ${n}`); }
log(`stored signatures: ${stored.size}`);

// main signatures
const mainSig = new Map(); // commit -> Map(file -> sig)
for (const m of [mains[start], ...inWin]) { const s = new Map(); for (const f of listAt(m.h)) s.set(f, sig(f, m.h)); mainSig.set(m.h, s); }
log("main signatures done");

// per-commit re-key table (every commit, against the previous one)
const perCommit = [];
for (let i = 0; i < inWin.length; i++) {
  const prev = mainSig.get((i === 0 ? mains[start] : inWin[i - 1]).h), cur = mainSig.get(inWin[i].h);
  let nf = 0, sec = 0, nsk = 0, ssk = 0;
  for (const [f, s] of cur) if (prev.get(f) !== s) { const d = secOf.get(f) ?? 0; nf++; sec += d; if (stored.get(f + "@" + s) <= inWin[i].at) { nsk++; ssk += d; } }
  perCommit.push({ h: inWin[i].h.slice(0, 10), at: new Date(inWin[i].at).toISOString(), lagMin: +((inWin[i].at - inWin[i].ct) / 60e3).toFixed(1), files: cur.size, rekeyed: nf, rekeyedSec: Math.round(sec), storedAtLand: nsk, storedAtLandSec: Math.round(ssk) });
}
writeFileSync(outPrefix + "-percommit.jsonl", perCommit.map((p) => JSON.stringify(p)).join("\n") + "\n");
for (const f of files) if (!secOf.has(f)) noDur++;
log(`files without a recorded duration: ${noDur} of ${files.length}`);

const mainW = new Set(db.prepare("select id from worktrees where is_main = 1").all().map((w) => w.id));
const earliest = new Map(db.prepare("select worktree_id, commit_sha, min(recorded_at) t from results where commit_sha is not null group by worktree_id").all().map((r) => [r.worktree_id, r]));
// worktree runs to judge
const wt = L.filter((x) => !x.main && x.ended && x.sec > 0 && x.commit);
for (const x of wt) x.s = closures.has(x.file) ? sig(x.file, x.commit) : null;
log(`worktree file runs with a signature: ${wt.filter((x) => x.s).length} of ${wt.length}`);
const needAt = new Map(); // file@sig -> sorted run starts
for (const x of wt) if (x.s) (needAt.get(x.file + "@" + x.s) ?? needAt.set(x.file + "@" + x.s, []).get(x.file + "@" + x.s)).push(x.rs);
for (const a of needAt.values()) a.sort((p, q) => p - q);

function simulate(targets, rate) {
  const R = rate / 60e3; // recorded s per wall ms
  // the start commit's content counts as validated before the window
  const done = new Map([...mainSig.get(mains[start].h)].map(([f, s]) => [f + "@" + s, T0 - 1])); // file@sig -> finish time
  let queue = [], t = targets[0]?.at ?? T0, ran = 0, superseded = 0, skipped = 0, rekeyed = 0, lastSig = mainSig.get(mains[start].h);
  const drain = (until) => {
    while (queue.length && t < until) {
      const j = queue[0];
      const k = j.f + "@" + j.s;
      if (done.has(k) || stored.get(k) <= t) { skipped += j.sec; queue.shift(); continue; }
      const need = j.sec / R; t += need; ran += j.sec; done.set(k, t); queue.shift();
    }
    if (t < until && until !== Infinity) t = until;
  };
  for (const m of targets) {
    drain(m.at);
    const cur = mainSig.get(m.h);
    // superseded: a queued file whose content at the new target differs (it would have run for nothing)
    for (const j of queue) if (cur.get(j.f) !== j.s) superseded += j.sec;
    queue = [];
    for (const [f, s] of cur) { const k = f + "@" + s; if (done.has(k)) continue; const sec = secOf.get(f) ?? 0; if (lastSig.get(f) !== s) rekeyed += sec; if (stored.get(k) <= m.at) { skipped += sec; continue; } queue.push({ f, s, sec }); }
    lastSig = cur;
  }
  drain(Infinity);
  return { done, ran, superseded, skipped, rekeyed, endsAt: t };
}
// A main daemon at the window's start is assumed current: the start commit's signatures count as done.
const policies = [["every commit", inWin]];
for (const N of [2, 4, 8]) policies.push([`every ${N}th commit`, inWin.filter((_, i) => i % N === N - 1 || i === inWin.length - 1)]);
for (const Q of [10, 30, 60]) policies.push([`after ${Q} min with no newer commit`, inWin.filter((m, i) => i === inWin.length - 1 || inWin[i + 1].at - m.at >= Q * 60e3).map((m, i, a) => ({ ...m, at: m.at + Q * 60e3 }))]);
const out = [];
for (const [name, targets] of policies) for (const rate of ratesArg.split(",").map(Number)) {
  const sim = simulate(targets, rate);
  const by = {}, add = (k, v) => { by[k] = (by[k] ?? 0) + v; };
  for (const x of wt) {
    const k = `${x.kind}${x.dirty ? " dirty" : " clean"}`; add(k + " total", x.sec);
    const d = x.s ? sim.done.get(x.file + "@" + x.s) : undefined;
    if (d !== undefined && d <= x.rs) add(k + " spared", x.sec);
  }
  // main runs no worktree needed: ran by main, no worktree run at that content after it finished
  let unneeded = 0, late = 0, used = 0;
  for (const [k, fin] of sim.done) { if (fin < T0) continue; const sec = secOf.get(k.split("@")[0]) ?? 0; const a = needAt.get(k); if (!a) unneeded += sec; else if (a[a.length - 1] >= fin) used += sec; else late += sec; }
  out.push({ policy: name, rate, targets: targets.length, ran: Math.round(sim.ran), rekeyed: Math.round(sim.rekeyed), skippedStored: Math.round(sim.skipped), superseded: Math.round(sim.superseded), mainUsed: Math.round(used), mainLate: Math.round(late), mainUnneeded: Math.round(unneeded), busyUntil: new Date(sim.endsAt).toISOString(), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round(v)])) });
  log(name, rate, "ran", Math.round(sim.ran));
  if (name === "every commit") {
    // waiting, first baselines: per checkpoint, ended files' time to current today and with the main daemon;
    // a file counts as covered only when its run was at a clean revision (a dirty run carries own edits)
    const cps = new Map();
    for (const x of wt) if (x.kind === "first") { const c = cps.get(x.cp) ?? cps.set(x.cp, { T: x.T, all: [], cov: [] }).get(x.cp); const d = x.s ? sim.done.get(x.file + "@" + x.s) : undefined; const w = ((x.re ?? x.rs) - x.T) / 60e3; c.all.push({ w, sec: x.sec, cov: d !== undefined && d <= x.rs && !x.dirty }); }
    writeFileSync(`${outPrefix}-wait-${rate}.jsonl`, [...cps].map(([id, c]) => JSON.stringify({ cp: id, n: c.all.length, cov: c.all.filter((y) => y.cov).length, lastToday: Math.max(...c.all.map((y) => y.w)), lastUncov: Math.max(0, ...c.all.filter((y) => !y.cov).map((y) => y.w)), lastCov: Math.max(0, ...c.all.filter((y) => y.cov).map((y) => y.w)), meanToday: c.all.reduce((s, y) => s + y.w, 0) / c.all.length, meanMain: c.all.reduce((s, y) => s + (y.cov ? 0 : y.w), 0) / c.all.length, sec: c.all.reduce((s, y) => s + y.sec, 0), covSec: c.all.reduce((s, y) => s + (y.cov ? y.sec : 0), 0) })).join("\n") + "\n");
    // the start verdict: a first baseline's listed misses (checkpoint test_files) at its start commit that the main
    // daemon had finished before the checkpoint started. Start commit: the revision's head when the worktree's
    // revisions survive, else the commit of the worktree's earliest stored row (an approximation).
    const firsts = [];
    const seenW = new Set();
    for (const c of db.prepare("select c.*, v.head from checkpoints c left join revisions v on v.worktree_id = c.worktree_id and v.number = c.revision where c.kind = 'baseline' order by c.started_at").all()) {
      const first = !seenW.has(c.worktree_id); seenW.add(c.worktree_id);
      if (!first || c.started_at < T0 || c.started_at >= T1 || mainW.has(c.worktree_id)) continue;
      const head = c.head ?? earliest.get(c.worktree_id)?.commit_sha ?? null;
      const listed = JSON.parse(c.test_files).map((f) => f.project + "\0" + f.path);
      let n = 0, sec = 0, cn = 0, csec = 0;
      for (const f of listed) { const d = secOf.get(f) ?? 0; n++; sec += d; const sg = head && closures.has(f) ? sig(f, head) : null; const fin = sg ? sim.done.get(f + "@" + sg) : undefined; if (fin !== undefined && fin <= c.started_at) { cn++; csec += d; } }
      firsts.push({ cp: c.id, T: new Date(c.started_at).toISOString(), head: head?.slice(0, 10) ?? null, fromRevision: !!c.head, listed: n, listedSec: Math.round(sec), covered: cn, coveredSec: Math.round(csec) });
    }
    writeFileSync(`${outPrefix}-start-${rate}.jsonl`, firsts.map((x) => JSON.stringify(x)).join("\n") + "\n");
  }
}
writeFileSync(outPrefix + "-sim.json", JSON.stringify(out, null, 1));
log("done");
