// THROWAWAY probe (011-core/research/edit-cut.md, questions 2 and 3). `node replay.mjs`.
// Replays each agent revision of cezar and Squeal (results/classified-<repo>.json.gz) on its own,
// from recorded durations, with the tier model of ../central-edits/replay.mjs, under each cut:
//   today   every re-keyed file is an edit's work (edit tiers of runner.tierSize);
//   (a)     edited and added test files plus every direct importer of a changed path stay edits;
//   (n)     edited and added test files plus each changed source's namesakes (lib.mjs namesakeOf)
//           among the files the revision re-keyed; a changed source with none re-keyed keeps its
//           direct importers;
//   (nd)    as (n), but a namesake counts only when it is also a direct importer of the source;
//   (n+K)   (n) plus the K shortest of the revision's other direct importers (K = 4, 12);
//   (a) kit (a), had the hubs' fixture importers (hubs.mjs) reached them through a testkit.
// Everything else the revision re-keyed is catch-up (Vitest backlog tiers, node:test slots).
// Measures per revision: the own test file's result (edited test files and the picked namesakes;
// none when the revision has neither), the next edit's wait (Vitest lane), all results.
// Question 3 (exposure): the files a revision re-keyed that failed afterwards. A fail result of a
// file (`results.outcome = 'fail'`, by worktree and revision) is the revision's when the revision
// is the latest of the worktree at or before the result's revision whose change re-keys the file
// (today's closures). A file whose last result before the revision already failed is carried, and
// orders first in its group (C4 step 4); a new failure does not. For each such revision: the class
// of its earliest failing file under today's rule (edited test, namesake, other direct, transitive,
// outside), and under each cut the time to its first failing result against today's.
import { readFileSync, writeFileSync } from "node:fs";
import { FIXED_S, makespan } from "../catch-up/calibrate.mjs";
import { namesakeOf, openStore, q, readClassified, writeResult } from "./lib.mjs";

const out = { replay: {}, exposure: {} };
const lines = [];
const log = (s = "") => { lines.push(s); console.log(s); };

// ---- The tier model (../central-edits/replay.mjs) -----------------------------------------
const CLASS = { edited: 1, direct: 2, transitive: 3, outside: 3 };
const order = (a, b) => (b.prevFail - a.prevFail) || CLASS[a.cls] - CLASS[b.cls] || a.s - b.s;
const catchUpOrder = (a, b) => (b.prevFail - a.prevFail) || a.s - b.s;
function editTiers(fs, size) {
  const qu = [...fs].sort(order), tiers = [];
  while (qu.length) {
    const t = [qu.shift()];
    for (let i = 0; i < qu.length && t.length < size; ) {
      const lo = Math.min(...t.map((f) => f.s), qu[i].s), hi = Math.max(...t.map((f) => f.s), qu[i].s);
      if (hi <= Math.max(1, 4 * lo)) t.push(qu.splice(i, 1)[0]); else i++;
    }
    tiers.push(t);
  }
  return tiers;
}
function backlogTiers(fs, w) {
  const qu = [...fs].sort(catchUpOrder), tiers = [];
  while (qu.length) {
    const t = [];
    let sum = 0, longest = 0;
    while (qu.length && t.length < 200) {
      const s2 = sum + qu[0].s, l2 = Math.max(longest, qu[0].s);
      if (t.length >= w && s2 / w + (1 - 1 / w) * l2 > 120) break;
      t.push(qu.shift()); sum = s2; longest = l2;
    }
    tiers.push(t);
  }
  return tiers;
}
function serial(tiers, w, t0, cancellable, done, busy) {
  let t = t0;
  for (const tier of tiers) {
    const wall = makespan(tier.map((f) => f.s), Math.min(w ?? tier.length, tier.length)) + FIXED_S;
    busy.push({ s: t, e: t + wall, cancellable });
    t += wall;
    for (const f of tier) done.set(f.id, t);
  }
  return t;
}
function slots(fs, w, t0, done) {
  const free = Array(w).fill(t0);
  for (const f of [...fs].sort(catchUpOrder)) { const i = free.indexOf(Math.min(...free)); free[i] += f.s + FIXED_S; done.set(f.id, free[i]); }
  return Math.max(...free);
}
function plan(files, isEdit, size) {
  const done = new Map(), busy = [];
  let end = 0;
  for (const lane of ["vitest", "node:test"]) {
    const fs = files.filter((f) => f.lane === lane);
    const t = serial(editTiers(fs.filter(isEdit), size), null, 0, false, done, lane === "vitest" ? busy : []);
    const e = lane === "vitest" ? serial(backlogTiers(fs.filter((f) => !isEdit(f)), 23), 23, t, true, done, busy) : slots(fs.filter((f) => !isEdit(f)), 4, t, done);
    end = Math.max(end, e);
  }
  const total = busy.reduce((a, b) => a + (b.e - b.s), 0);
  const wait = total === 0 ? 0 : busy.reduce((a, b) => {
    const d = b.e - b.s;
    return a + (b.cancellable ? Math.min(d, 6) * d - Math.min(d, 6) ** 2 / 2 : d * d / 2);
  }, 0) / total;
  return { done, end, wait };
}

// ---- The cuts -------------------------------------------------------------------------------
/** The namesakes rule (n) keeps for a revision, and the sources that fall back to direct importers. */
function namesakeSets(r, files, requireDirect) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const keep = new Set(), fallback = [];
  for (const s of r.sources) {
    const picks = namesakeOf(s, r.present).map((p) => byPath.get(p)).filter((f) => f && (!requireDirect || f.cls === "direct" || f.cls === "edited"));
    if (picks.length) for (const f of picks) keep.add(f.id);
    else fallback.push(s);
  }
  for (const f of files) if (f.directOf.some((c) => fallback.includes(c))) keep.add(f.id);
  return keep;
}
// The testkit counterfactual (question 4, cezar only): the fixture importers of a hub (hubs.mjs)
// reach it through a testkit instead, so they are transitive for it, not direct.
const HUBS = JSON.parse(readFileSync(new URL("results/hubs.json", import.meta.url)));
const fixtureOf = new Map(Object.entries(HUBS).map(([hub, h]) => [hub, new Set(h.fixture)]));
const viaKit = (f) => f.cls === "direct" && f.directOf.every((c) => fixtureOf.get(c)?.has(f.path));
function cuts(r, files) {
  const edited = (f) => f.cls === "edited";
  const n = namesakeSets(r, files, false), nd = namesakeSets(r, files, true);
  const plus = (k) => {
    const extra = new Set(files.filter((f) => f.cls === "direct" && !n.has(f.id)).sort((a, b) => a.s - b.s).slice(0, k).map((f) => f.id));
    return (f) => edited(f) || n.has(f.id) || extra.has(f.id);
  };
  return {
    today: () => true,
    "(a)": (f) => edited(f) || f.cls === "direct",
    "(n)": (f) => edited(f) || n.has(f.id),
    "(nd)": (f) => edited(f) || nd.has(f.id),
    "(n+4)": plus(4),
    "(n+12)": plus(12),
    "(a) kit": (f) => edited(f) || (f.cls === "direct" && !viaKit(f)),
  };
}

// ---- Per repository -------------------------------------------------------------------------
for (const repo of ["cezar", "squeal"]) {
  const db = openStore(repo);
  const perRun = db.prepare(`select c.project, c.test_path path, r.run_id, sum(r.duration_ms) ms from results r
    join checks c on c.id = r.check_id group by c.project, c.test_path, r.run_id`).all();
  const byFile = new Map(), byProject = new Map();
  for (const x of perRun) {
    const id = `${x.project}:${x.path}`;
    (byFile.get(id) ?? byFile.set(id, []).get(id)).push(x.ms / 1000);
    (byProject.get(x.project) ?? byProject.set(x.project, []).get(x.project)).push(x.ms / 1000);
  }
  const secs = (id) => (byFile.has(id) ? q(byFile.get(id), 0.5) : byProject.has(id.split(":")[0]) ? q(byProject.get(id.split(":")[0]), 0.5) : 1);

  // Failures: per worktree, per file, the revisions of its fail results; and the last result before a time.
  const fails = db.prepare(`select r.worktree_id wt, c.project, c.test_path path, min(r.revision) rev, min(r.recorded_at) at from results r join checks c on c.id = r.check_id
    where r.outcome = 'fail' group by r.worktree_id, c.project, c.test_path, r.run_id`).all();
  const lastBefore = db.prepare(`select max(case when r.outcome = 'fail' then 1 else 0 end) failed, r.run_id from results r join checks c on c.id = r.check_id
    where r.worktree_id = ? and c.project = ? and c.test_path = ? and r.recorded_at < ? group by r.run_id order by max(r.recorded_at) desc limit 1`);
  // Every revision of each worktree with the set of test files it re-keys (today's closures), for attribution.
  const tf = db.prepare("select project, path, closure_paths from test_files").all().map((t) => ({ id: `${t.project}:${t.path}`, path: t.path, closure: new Set(JSON.parse(t.closure_paths)) }));
  const allRevs = new Map();
  for (const rv of db.prepare("select worktree_id, number, created_at, changes from revisions order by worktree_id, number").all()) {
    const changed = JSON.parse(rv.changes).map((c) => c.path);
    const ch = new Set(changed);
    const ids = new Set(tf.filter((t) => ch.has(t.path) || changed.some((c) => t.closure.has(c))).map((t) => t.id));
    (allRevs.get(rv.worktree_id) ?? allRevs.set(rv.worktree_id, []).get(rv.worktree_id)).push({ n: rv.number, at: rv.created_at, ids });
  }
  const causeOf = (wt, id, rev) => {
    const rs = allRevs.get(wt) ?? [];
    let best = null;
    for (const r of rs) if (r.n <= rev && r.ids.has(id)) best = r.n;
    return best;
  };
  const failsOf = new Map();
  for (const f of fails) {
    const id = `${f.project}:${f.path}`;
    const n = causeOf(f.wt, id, f.rev);
    if (n === null) continue;
    const k = `${f.wt}:${n}`;
    (failsOf.get(k) ?? failsOf.set(k, new Set()).get(k)).add(id);
  }

  const revs = readClassified(repo);
  const rows = [], expo = [];
  for (const r of revs) {
    const failing = failsOf.get(`${r.wt}:${r.n}`) ?? new Set();
    const files = r.files.filter((f) => f.cls !== "absent").map((f) => {
      let prevFail = 0;
      if (failing.has(f.id)) { const [project, ...p] = f.id.split(":"); prevFail = lastBefore.get(r.wt, project, p.join(":"), r.at)?.failed ?? 0; }
      return { ...f, s: secs(f.id), prevFail };
    });
    if (!files.length) continue;
    const central = files.length >= 200;
    const own = new Set(files.filter((f) => f.cls === "edited").map((f) => f.id));
    for (const s of r.sources) for (const p of namesakeOf(s, r.present)) { const f = files.find((x) => x.path === p); if (f) own.add(f.id); }
    const kind = (f) => (f.cls === "edited" ? "edited test" : own.has(f.id) ? "namesake" : f.cls === "direct" ? "other direct" : f.cls);
    const sizes = repo === "cezar" ? [4, 12] : [4];
    const fail = files.filter((f) => failing.has(f.id));
    let firstCls = null;
    for (const size of sizes) for (const [rule, isEdit] of Object.entries(cuts(r, files))) {
      if (size === 12 && !["today", "(a)", "(n)", "(n+12)"].includes(rule)) continue;
      const p = plan(files, isEdit, size);
      const ownT = [...own].map((id) => p.done.get(id));
      rows.push({ rev: r.rev, central, rule, size, files: files.length, edit: files.filter(isEdit).length, ownS: own.size ? Math.max(...ownT) : null,
        allS: p.end, waitS: p.wait });
      if (fail.length) {
        const first = Math.min(...fail.map((f) => p.done.get(f.id)));
        if (rule === "today" && size === 4) {
          const f0 = fail.sort((a, b) => p.done.get(a.id) - p.done.get(b.id))[0];
          firstCls = kind(f0);
          expo.push({ rev: r.rev, central, files: files.length, failing: fail.length, carried: fail.filter((f) => f.prevFail).length, firstCls, first: {}, firstNew: {}, newCls: null });
        }
        expo.at(-1).first[`${rule} ${size}`] = first;
        const fresh = fail.filter((f) => !f.prevFail);
        if (fresh.length) {
          expo.at(-1).firstNew[`${rule} ${size}`] = Math.min(...fresh.map((f) => p.done.get(f.id)));
          if (rule === "today" && size === 4) expo.at(-1).newCls = kind(fresh.sort((a, b) => p.done.get(a.id) - p.done.get(b.id))[0]);
        }
        // The best class among all failing files, whatever reports first.
        expo.at(-1).classes = [...new Set(fail.map(kind))];
        expo.at(-1).failing = fail.map((f) => ({ path: f.path, kind: kind(f), carried: f.prevFail, s: f.s }));
      }
    }
  }
  out.replay[repo] = rows;
  out.exposure[repo] = expo;

  const fmt = (xs) => (xs.length ? `${q(xs, 0.5).toFixed(0)} / ${q(xs, 0.9).toFixed(0)} / ${Math.max(...xs).toFixed(0)}` : "-");
  for (const [label, pick] of [["central (200 or more re-keyed)", (x) => x.central], ["every agent revision", () => true]]) {
    const rs = rows.filter(pick);
    log(`\n== ${repo}, ${label}: ${new Set(rs.map((x) => x.rev)).size} revisions (p50 / p90 / max)`);
    log("rule            size  edit files      own result s    (n)  next edit waits s  all results s");
    for (const key of [...new Set(rs.map((x) => `${x.rule}|${x.size}`))]) {
      const [rule, size] = key.split("|");
      const xs = rs.filter((x) => x.rule === rule && x.size === Number(size));
      const own = xs.map((x) => x.ownS).filter((v) => v !== null);
      log(`${rule.padEnd(15)} ${size.padStart(4)}  ${fmt(xs.map((x) => x.edit)).padEnd(15)} ${fmt(own).padEnd(15)} ${String(own.length).padStart(4)}  ${fmt(xs.map((x) => x.waitS)).padEnd(18)} ${fmt(xs.map((x) => x.allS))}`);
    }
  }
  log(`\n== ${repo}, exposure: ${expo.length} agent revisions whose re-keyed files failed afterwards (${expo.filter((e) => e.central).length} central)`);
  const byCls = {};
  for (const e of expo) byCls[e.firstCls] = (byCls[e.firstCls] ?? 0) + 1;
  log(`  the first failing file under today's rule: ${JSON.stringify(byCls)}`);
  log(`  carried failures (failing before the revision) among them: ${expo.reduce((a, e) => a + e.carried, 0)} of ${expo.reduce((a, e) => a + e.failing.length, 0)} failing files`);
  for (const rule of Object.keys(expo[0]?.first ?? {})) {
    const d = expo.map((e) => e.first[rule] - e.first["today 4"]);
    const later = d.filter((x) => x > 0.5);
    log(`  ${rule.padEnd(12)} first failure later than today in ${later.length} of ${d.length}: by p50 ${later.length ? q(later, 0.5).toFixed(0) : 0} s, max ${later.length ? Math.max(...later).toFixed(0) : 0} s; earlier in ${d.filter((x) => x < -0.5).length}`);
  }
  const fresh = expo.filter((e) => e.newCls !== null);
  const byNew = {};
  for (const e of fresh) byNew[e.newCls] = (byNew[e.newCls] ?? 0) + 1;
  log(`  new failures (no failing file of the revision failed before it): ${fresh.length} revisions; the first new failing file under today's rule: ${JSON.stringify(byNew)}`);
  for (const rule of Object.keys(fresh[0]?.firstNew ?? {})) {
    const d = fresh.map((e) => e.firstNew[rule] - e.firstNew["today 4"]);
    const later = d.filter((x) => x > 0.5);
    log(`  new, ${rule.padEnd(12)} later than today in ${later.length} of ${d.length}: p50 ${later.length ? q(later, 0.5).toFixed(0) : 0} s, max ${later.length ? Math.max(...later).toFixed(0) : 0} s, sum ${later.reduce((a, b) => a + b, 0).toFixed(0)} s; earlier in ${d.filter((x) => x < -0.5).length}`);
  }
  for (const [x, y] of [["(n) 4", "(a) 4"], ["(a) kit 4", "(a) 4"], ["(n+4) 4", "(a) 4"], ["(n+12) 4", "(a) 4"], ["(nd) 4", "(a) 4"]]) {
    const d = fresh.map((e) => ({ rev: e.rev, d: e.firstNew[x] - e.firstNew[y], cls: e.newCls }));
    const later = d.filter((v) => v.d > 0.5);
    log(`  new, ${x} against ${y}: later in ${later.length} of ${d.length} (${later.map((v) => `${v.rev} +${v.d.toFixed(0)} s, ${v.cls}`).join("; ")}); earlier in ${d.filter((v) => v.d < -0.5).length}`);
  }
  for (const e of expo) log(`  ${e.rev.padEnd(14)} ${String(e.files).padStart(4)} files, ${e.failing.length} failing (${e.carried} carried), first: ${e.firstCls}, first new: ${e.newCls ?? "-"}; classes ${e.classes.join(",")}; first failure s ${Object.entries(e.first).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}`);
}
writeResult("replay", out);
writeFileSync(new URL("results/replay.txt", import.meta.url), lines.join("\n") + "\n");
