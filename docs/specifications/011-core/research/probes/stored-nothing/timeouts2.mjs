// 011-148 probe (throwaway): per timed-out run, the planned work (usual durations) against what completed, and repeats at a key.
// Usage: node timeouts2.mjs <store copy> <fate.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, fatePath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const fate = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const durs = new Map();
for (const r of db.prepare("SELECT c.project p, c.test_path t, r.duration_ms d FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.duration_ms > 0").all()) { const k = r.p + "\0" + r.t; (durs.get(k) ?? durs.set(k, []).get(k)).push(r.d / 1000); }
const med = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const byRun = new Map(); for (const f of fate) (byRun.get(f.run) ?? byRun.set(f.run, []).get(f.run)).push(f);
for (const fs of [...byRun.values()].filter((fs) => fs[0].fk === "timed-out").sort((a, b) => a[0].start - b[0].start)) {
  const r = fs[0]; const wall = (r.endAt - r.start) / 1000;
  const endedS = fs.filter((f) => f.ended).reduce((a, f) => a + f.secs, 0);
  const usualEnded = fs.filter((f) => f.ended).reduce((a, f) => a + (med(durs.get(f.file)) ?? 0), 0);
  const notEnded = fs.filter((f) => !f.ended);
  const usualRest = notEnded.reduce((a, f) => a + (med(durs.get(f.file)) ?? 0), 0);
  const unknownDur = fs.filter((f) => med(durs.get(f.file)) === null).length;
  console.log(`${new Date(r.start).toISOString().slice(5, 16)} ${r.w.slice(0, 8)} rev ${r.rev} files ${fs.length}: ended ${fs.length - notEnded.length} took ${endedS.toFixed(0)} s (usual ${usualEnded.toFixed(0)}, slowdown ${(endedS / usualEnded).toFixed(1)}x), ran ${(endedS / wall).toFixed(1)} file-s per s; not ended ${notEnded.length}, usual ${usualRest.toFixed(0)} s; unknown durations ${unknownDur}`);
}
