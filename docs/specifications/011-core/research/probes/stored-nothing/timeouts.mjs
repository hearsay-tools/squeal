// 011-148 probe (throwaway): every timed-out run of a store copy's window: what was in flight, its usual duration, the load, repeats.
// Usage: node timeouts.mjs <store copy> <fate.jsonl> <load.csv from sadf -d -- -q> <run-log snapshot dir>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [, , storePath, fatePath, loadPath, logsDir] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const fate = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const load = readFileSync(loadPath, "utf8").trim().split("\n").map((l) => l.split(";")).map((c) => [Date.parse(c[2].replace(" UTC", "Z").replace(" ", "T")), Number(c[5])]).sort((a, b) => a[0] - b[0]);
const loadAt = (t) => { let best = null; for (const [at, v] of load) { if (at - 600_000 > t) break; if (at >= t) { best = v; break; } } return best; };
// usual duration of a file: median of its stored file-level durations (all rows)
const durs = new Map();
for (const r of db.prepare("SELECT c.project p, c.test_path t, r.duration_ms d FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.duration_ms > 0").all()) {
  const k = r.p + "\0" + r.t; (durs.get(k) ?? durs.set(k, []).get(k)).push(r.d / 1000);
}
const med = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const byRun = new Map();
for (const f of fate) (byRun.get(f.run) ?? byRun.set(f.run, []).get(f.run)).push(f);
const timedOut = [...byRun.values()].filter((fs) => fs[0].fk === "timed-out");
let lostUpper = 0, lostInFlight = 0, storedS = 0, hungFiles = 0, slowFiles = 0, inflightN = 0;
const perFile = new Map();
const lines = [];
for (const fs of timedOut) {
  const r = fs[0];
  const wall = (r.endAt - r.start) / 1000;
  const inflight = fs.filter((f) => !f.ended && f.est === "wall-started");
  const ended = fs.filter((f) => f.ended);
  const stored = fs.filter((f) => f.stored);
  storedS += stored.reduce((a, f) => a + f.secs, 0);
  const lost = fs.filter((f) => !f.stored).reduce((a, f) => a + f.secs, 0);
  lostUpper += lost;
  const desc = inflight.map((f) => {
    const m = med(durs.get(f.file)); inflightN++;
    if (m === null || m * 3 < wall) hungFiles++; else slowFiles++;
    const p = f.file.split("\0")[1];
    (perFile.get(p) ?? perFile.set(p, []).get(p)).push({ run: r.run, w: r.w, rev: r.rev, at: r.start, later: f.later, atKeyNow: f.atKeyNow });
    return `${p.split("/").slice(-2).join("/")} (usual ${m === null ? "?" : m.toFixed(0)} s)`;
  });
  lostInFlight += inflight.reduce((a, f) => a + f.secs, 0);
  lines.push(`${new Date(r.start).toISOString().slice(5, 16)} w=${r.w.slice(0, 8)} ${r.live ? "live" : "removed"} ${r.cls} files=${fs.length} ended=${ended.length} stored=${stored.length} wall=${wall.toFixed(0)} load1=${loadAt(r.start)}..${loadAt(r.endAt)} inflight=${inflight.length}: ${desc.join(", ")}`);
}
console.log(lines.sort().join("\n"));
console.log(`\ntimed-out runs ${timedOut.length}; stored in them ${Math.round(storedS)} s; not stored (upper: in-flight files at the full wall) ${Math.round(lostUpper)} s; in-flight files ${inflightN}: usual duration under a third of the wall ${hungFiles}, else ${slowFiles}`);
console.log("files in flight at a timeout more than once:");
for (const [p, list] of [...perFile].sort((a, b) => b[1].length - a[1].length)) if (list.length > 1) console.log(`  ${list.length}x ${p} in ${new Set(list.map((x) => x.w)).size} worktrees`);
