// THROWAWAY probe (011-core/research/central-edits.md, question 4, the measured side). What the 62
// revisions' own test files actually waited on cezar (Squeal 0.1.2xx of 2026-10-14 to 10-19, edit
// tiers of the then runner.tierSize, the host's load of the time unrecorded): from the revision's
// `created_at` to the start of the first run in that worktree holding the own file, and to the
// first result of the file recorded after the revision. Also how much uncancelled edit-tier work
// was in flight when the revision landed (the run a new edit waits for). Read-only.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { readResult } from "./graph.mjs";

const db = new DatabaseSync(process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const revs = readResult("direct");
const wtOf = db.prepare("select id from worktrees where id like ?");
const revAt = db.prepare("select created_at from revisions where worktree_id = ? and number = ?");
const runs = db.prepare("select id, revision, test_files, checkpoint_id, started_at, ended_at, end_state from runs where worktree_id = ? order by started_at");
const firstResult = db.prepare(`select min(r.recorded_at) at from results r join checks c on c.id = r.check_id
  where r.worktree_id = ? and c.project = ? and c.test_path = ? and r.recorded_at >= ?`);
const out = [];
for (const r of revs) {
  const [wt8, n] = r.rev.split(" r");
  const wt = wtOf.get(`${wt8}%`).id;
  const at = revAt.get(wt, Number(n)).created_at;
  const rs = runs.all(wt).map((x) => ({ ...x, files: JSON.parse(x.test_files).map((f) => `${f.project}:${f.path}`) }));
  const inFlight = rs.filter((x) => x.started_at <= at && (x.ended_at ?? Infinity) > at);
  const own = r.own.map((o) => {
    const run = rs.find((x) => x.started_at >= at && x.files.includes(o.id));
    const [project, ...p] = o.id.split(":");
    const res = firstResult.get(wt, project, p.join(":"), at)?.at ?? null;
    return { id: o.id, startS: run ? (run.started_at - at) / 1000 : null, resultS: res === null ? null : (res - at) / 1000 };
  });
  out.push({ rev: r.rev, at: new Date(at).toISOString(), inFlight: inFlight.map((x) => ({ files: x.files.length, edit: x.checkpoint_id === null, leftS: ((x.ended_at ?? at) - at) / 1000, end: x.end_state })), own });
}
writeFileSync(new URL("results/measured.json", import.meta.url), JSON.stringify(out, null, 1));
const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const owns = out.flatMap((o) => o.own);
const starts = owns.map((o) => o.startS).filter((x) => x !== null), results = owns.map((o) => o.resultS).filter((x) => x !== null);
console.log(`own test files: ${owns.length}; a run started for ${starts.length}, a result recorded for ${results.length}`);
console.log(`  wait to its run's start  s p50 ${q(starts, 0.5).toFixed(0)} p90 ${q(starts, 0.9).toFixed(0)} max ${Math.max(...starts).toFixed(0)}`);
console.log(`  wait to its first result s p50 ${q(results, 0.5).toFixed(0)} p90 ${q(results, 0.9).toFixed(0)} max ${Math.max(...results).toFixed(0)}`);
const left = out.map((o) => Math.max(0, ...o.inFlight.filter((x) => x.edit).map((x) => x.leftS)));
console.log(`edit tier in flight when the revision landed: ${left.filter((x) => x > 0).length} of ${out.length}; its time left s p50 ${q(left, 0.5).toFixed(0)} p90 ${q(left, 0.9).toFixed(0)} max ${Math.max(...left).toFixed(0)}`);
for (const o of out) console.log(`${o.rev.padEnd(14)} ${o.at.slice(5, 19)} in flight ${o.inFlight.map((x) => `${x.files}f ${x.edit ? "edit" : "backlog"} ${x.leftS.toFixed(0)}s left`).join(", ") || "-"}; own ${o.own.map((x) => `${x.id.split("/").pop()} start ${x.startS?.toFixed(0) ?? "-"} result ${x.resultS?.toFixed(0) ?? "-"}`).join("; ")}`);

// The tiers in flight: were their files, under cut (a), edits (edited or direct for some earlier
// revision of the worktree among the 62) or catch-up (a later edit would cancel them)?
const earlierClasses = (rev) => {
  const [wt8, n] = rev.split(" r");
  const before = revs.filter((x) => x.rev.startsWith(wt8) && Number(x.rev.split(" r")[1]) < Number(n));
  const cls = new Map();
  for (const b of before) for (const f of b.files) if (f.cls === "edited" || f.cls === "direct") cls.set(f.id, "edit"); else if (!cls.has(f.id)) cls.set(f.id, "catch-up");
  return cls;
};
const inflight = [];
for (const r of revs) {
  const [wt8, n] = r.rev.split(" r");
  const wt = wtOf.get(`${wt8}%`).id;
  const at = revAt.get(wt, Number(n)).created_at;
  const cls = earlierClasses(r.rev);
  for (const x of runs.all(wt)) {
    if (!(x.started_at <= at && (x.ended_at ?? Infinity) > at) || x.checkpoint_id !== null) continue;
    const files = JSON.parse(x.test_files).map((f) => `${f.project}:${f.path}`);
    const kinds = files.map((f) => cls.get(f) ?? "unknown");
    inflight.push({ rev: r.rev, leftS: ((x.ended_at ?? at) - at) / 1000, kinds: kinds.join(",") });
  }
}
const allCatchUp = inflight.filter((x) => x.kinds.split(",").every((k) => k === "catch-up"));
const anyEdit = inflight.filter((x) => x.kinds.split(",").some((k) => k === "edit"));
const sumLeft = (xs) => xs.reduce((a, x) => a + x.leftS, 0).toFixed(0);
console.log(`\nedit tiers in flight at a revision: ${inflight.length}; of only catch-up files under (a) ${allCatchUp.length} (${sumLeft(allCatchUp)} s left in sum), holding an edit's file ${anyEdit.length} (${sumLeft(anyEdit)} s), unclassified ${inflight.length - allCatchUp.length - anyEdit.length} (${sumLeft(inflight.filter((x) => !allCatchUp.includes(x) && !anyEdit.includes(x)))} s)`);
for (const x of inflight) console.log(`  ${x.rev.padEnd(14)} ${x.leftS.toFixed(0).padStart(4)} s left: ${x.kinds}`);
