// THROWAWAY (running-tier-yields.md Q3, gh-62). Per fast Vitest run: wall (ended - started) against
// the report's fileDurations (Vitest's module diagnostic), and against the store's per-file sum of
// check durations (what the scheduler's `durationOf` reads). Read-only.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
const db = new DatabaseSync(process.env.STORE ?? "/tmp/r381/cezar-store.sqlite", { readOnly: true });
const NODE_TEST = new Set(["test:unit", "root:test:unit"]);
const sums = db.prepare("select c.project, c.test_path path, sum(r.duration_ms) ms, sum(case when c.kind = 'file' then r.duration_ms else 0 end) fileMs, count(*) n from results r join checks c on c.id = r.check_id where r.run_id = ? group by 1, 2");
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
const st = (xs) => ({ n: xs.length, p10: q(xs, 0.1), p50: q(xs, 0.5), p90: q(xs, 0.9) });
const single = { wallOverModule: [], wallOverChecks: [], moduleOverChecks: [], overheadS: [], fileRowShare: [] };
const multi = { wallOverMaxModule: [], wallOverMaxChecks: [], small_wallOverMaxModule: [], small_wallOverSumModule: [] };
let big = [];
for (const r of db.prepare("select id, test_files, log_dir, started_at s, ended_at e, end_state from runs where ended_at is not null and end_state = 'completed'").all()) {
  const files = JSON.parse(r.test_files);
  if (NODE_TEST.has(files[0].project) || /\.e2e\.ts$/.test(files[0].path)) continue;
  const p = `${r.log_dir}/report.json`;
  if (!existsSync(p)) continue;
  let rep; try { rep = JSON.parse(readFileSync(p, "utf8")).report; } catch { continue; }
  if (rep.failure) continue;
  const wall = (r.e - r.s) / 1000;
  const mod = new Map((rep.fileDurations ?? []).map((d) => [`${d.testFile.project}\0${d.testFile.path}`, d.durationMs / 1000]));
  const chk = new Map(sums.all(r.id).map((x) => [`${x.project}\0${x.path}`, { s: x.ms / 1000, file: x.fileMs / 1000 }]));
  if (wall < 5) continue; // fixed costs dominate
  if (files.length === 1) {
    const k = `${files[0].project}\0${files[0].path}`;
    const m = mod.get(k), c = chk.get(k);
    if (m) { single.wallOverModule.push(wall / m); single.overheadS.push(wall - m); }
    if (c && c.s > 0) { single.wallOverChecks.push(wall / c.s); single.fileRowShare.push(c.file / c.s); }
    if (m && c && c.s > 0) single.moduleOverChecks.push(m / c.s);
    if (m && wall > 60) big.push({ path: files[0].path.split("/").pop(), wall, module: m, checks: c?.s ?? null, fileRow: c?.file ?? null });
  } else {
    const mm = Math.max(...mod.values()), mc = Math.max(0, ...[...chk.values()].map((x) => x.s));
    if (mm > 0) multi.wallOverMaxModule.push(wall / mm);
    if (mm > 0 && files.length <= 4) { multi.small_wallOverMaxModule.push(wall / mm); multi.small_wallOverSumModule.push(wall / [...mod.values()].reduce((a, b) => a + b, 0)); }
    if (mc > 0) multi.wallOverMaxChecks.push(wall / mc);
  }
}
for (const [k, v] of Object.entries(single)) console.log(`single-file runs over 5 s, ${k}: ${JSON.stringify(st(v))}`);
for (const [k, v] of Object.entries(multi)) console.log(`multi-file runs over 5 s, ${k}: ${JSON.stringify(st(v))}`);
big.sort((a, b) => b.wall - a.wall);
console.log("longest single-file runs:"); for (const b of big.slice(0, 8)) console.log(JSON.stringify(b));
const hc = big.filter((b) => /harness-codex-parity/.test(b.path)); console.log("harness-codex-parity:", JSON.stringify(hc.slice(0, 3)));
