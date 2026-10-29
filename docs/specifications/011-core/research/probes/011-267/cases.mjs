// Throwaway probe, row 011-267. Synthetic cases on the 0.1.377 workload, W = 11:
// Q3 an edit during a wait's batch; Q4 a one-file wait behind a 55-file batch;
// Q5 a stream of named waits with no edits. Usage: node cases.mjs > cases-output.txt
import { writeFileSync } from 'node:fs';
import { simulate } from './model.mjs';
import { build } from './scenarios.mjs';

const W = Number(process.env.W ?? 11);
const s = build('0.1.377');
const named = s.files.filter((f) => f.cls === 'N').map((f) => f.path);
const out = [];
const rows = [];
const r0 = (x) => (x === null || x === undefined ? '-' : String(Math.round(x)));

// ---- Q3: an edit during the batch. The agent's own waits are removed; one parity wait at 0.
{
  // The workload's own edit work is left out (E -> B), so the arrival is the only edit's work.
  const base = s.files.map((f) => ({ ...f, own: false, cls: f.cls === 'E' ? 'B' : f.cls }));
  const edits = {
    'one 2 s file': [{ path: 'edit/one.test.ts', d: 2, cls: 'E', own: true }],
    'the trial\'s 5 own files': s.files.filter((f) => f.own && !f.preDone).map((f) => ({ ...f, path: `edit/${f.path}`, cls: 'E', own: true })),
  };
  const options = {
    'wait (batch, then edit)': { mode: 'tiers', order: 'batch', inTier: 'lpt', onEdit: 'wait' },
    'beside (+4 workers)': { mode: 'tiers', order: 'batch', inTier: 'lpt', onEdit: 'beside' },
    'cancel the batch': { mode: 'tiers', order: 'batch', inTier: 'lpt', onEdit: 'cancel' },
    'slots, batch first': { mode: 'slots', order: 'batch', inTier: 'lpt' },
    'slots, edit own first': { mode: 'slots', order: 'edit-first', inTier: 'lpt' },
  };
  out.push(`## Q3 edit during the batch (W=${W}); cells: edit latency s / parity verdict s / discarded file-s`);
  for (const [ename, efiles] of Object.entries(edits)) {
    out.push(`\n${ename} (${efiles.map((f) => Math.round(f.d)).join(', ')} s)`);
    out.push(`  ${'option'.padEnd(26)} ${[60, 180, 300].map((t) => `edit at ${t} s`.padEnd(18)).join('')}`);
    for (const [oname, policy] of Object.entries(options)) {
      const cells = [];
      for (const at of [60, 180, 300]) {
        const r = simulate({
          files: base,
          initialBusyUntil: s.initialBusyUntil,
          W,
          policy,
          plan: { waits: [{ at: 0, until: 60, files: named }], arrivals: [{ at, files: efiles }] },
        });
        const lat = r.ownAt === null ? null : r.ownAt - at;
        rows.push({ q: 3, edit: ename, option: oname, at, editLatencyS: lat, verdictS: r.verdictAt, discardedS: r.discarded, cuts: r.cuts });
        cells.push(`${r0(lat)} / ${r0(r.verdictAt)} / ${r0(r.discarded)}`.padEnd(18));
      }
      out.push(`  ${oname.padEnd(26)} ${cells.join('')}`);
    }
  }
}

// ---- Q4: a one-file wait behind another session's 55-file batch, no edit work queued.
{
  const base = s.files.map((f) => ({ ...f, own: false, cls: f.cls === 'E' ? 'B' : f.cls }));
  const pick = (target) => base.filter((f) => f.cls === 'B' && !f.preDone).sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target))[0];
  const options = {
    today377: { mode: 'tiers', order: 'today377', inTier: 'lpt' },
    'batch, strict order': { mode: 'tiers', order: 'batch', inTier: 'lpt' },
    'batch, small wait beside': { mode: 'tiers', order: 'batch', inTier: 'lpt', smallBeside: true },
    'slots, strict order': { mode: 'slots', order: 'batch', inTier: 'lpt' },
    'slots, small wait first': { mode: 'slots', order: 'small-first', inTier: 'lpt' },
  };
  const times = [30, 120, 240, 330];
  out.push(`\n## Q4 one-file wait behind a 55-file batch (W=${W}); cells: one-file latency s / parity verdict s`);
  for (const target of [2, 25, 60]) {
    const f = pick(target);
    out.push(`\none file of ${f.d.toFixed(1)} s (${f.path.split('/').pop()})`);
    out.push(`  ${'option'.padEnd(26)} ${times.map((t) => `wait at ${t} s`.padEnd(14)).join('')}`);
    for (const [oname, policy] of Object.entries(options)) {
      const cells = [];
      for (const at of times) {
        const files = base.map((x) => (x.path === f.path ? { ...x, own: true } : x));
        const parity = Array.from({ length: 20 }, (_, i) => ({ at: i * 75, until: i * 75 + 60, files: named }));
        const one = Array.from({ length: 10 }, (_, i) => ({ at: at + i * 75, until: at + i * 75 + 60, files: [f.path] }));
        const r = simulate({ files, initialBusyUntil: s.initialBusyUntil, W, policy, plan: { waits: [...parity, ...one] } });
        const lat = r.ownAt === null ? null : r.ownAt - at;
        rows.push({ q: 4, file: f.path, d: f.d, option: oname, at, latencyS: lat, verdictS: r.verdictAt });
        // A negative latency: the file was current before the wait opened ("cur").
        cells.push(`${lat !== null && lat < 0 ? 'cur' : r0(lat)} / ${r0(r.verdictAt)}`.padEnd(14));
      }
      out.push(`  ${oname.padEnd(26)} ${cells.join('')}`);
    }
  }
}

// ---- Q5: a stream of named waits, no edits. Every 75 s a wait names 4 new queued files
// (seeded choice); the parity wait opens at 0. Backlog progress: when unnamed files get results.
{
  const base = s.files.map((f) => ({ ...f, own: false, cls: f.cls === 'E' ? 'B' : f.cls }));
  const pool = base.filter((f) => f.cls === 'B' && !f.preDone).map((f) => f.path);
  const dOf = new Map(base.map((f) => [f.path, f.d]));
  for (const [kind, minD] of [['light (any file)', 0], ['heavy (files of 30 s or more)', 30]]) {
  let seed = 267;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const shuffled = pool.filter((p) => dOf.get(p) >= minD).map((p) => ({ p, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const streamWaits = [];
  const streamed = new Set();
  for (let i = 0; i < 24; i++) {
    const files = shuffled.slice(i * 4, i * 4 + 4);
    if (!files.length) break;
    files.forEach((p) => streamed.add(p));
    streamWaits.push({ at: 30 + i * 75, until: 30 + i * 75 + 60, files });
  }
  const options = {
    today377: { mode: 'tiers', order: 'today377', inTier: 'lpt' },
    'batch, no bound': { mode: 'tiers', order: 'batch', inTier: 'lpt' },
    'batch, turn after 4 batch tiers': { mode: 'tiers', order: 'batch', inTier: 'lpt', batchTurn: 4 },
    'batch, turn after 1 batch tier': { mode: 'tiers', order: 'batch', inTier: 'lpt', batchTurn: 1 },
    'slots, strict order': { mode: 'slots', order: 'batch', inTier: 'lpt' },
  };
  out.push(`\n## Q5 ${kind}: a stream of ${streamWaits.length} four-file named waits every 75 s from 30 s (${Math.round([...streamed].reduce((n, p) => n + dOf.get(p), 0))} file-s), plus the parity wait at 0 (W=${W})`);
  const unnamed = pool.filter((p) => !streamed.has(p));
  out.push(`  ${'option'.padEnd(32)} parity  stream-last  unnamed-first  unnamed-p90    all  (s; unnamed: the ${unnamed.length} files no wait names)`);
  for (const [oname, policy] of Object.entries(options)) {
    const r = simulate({ files: base, initialBusyUntil: s.initialBusyUntil, W, policy, plan: { waits: [{ at: 0, until: 60, files: named }, ...streamWaits] } });
    if (process.env.DEBUG) for (const t of r.tiers) out.push(`    ${Math.round(t.at)}-${Math.round(t.end)} ${t.kind} ${t.files}`);
    const ends = unnamed.map((p) => r.done.get(p) ?? Infinity).sort((a, b) => a - b);
    const first = ends[0];
    const p90 = ends[Math.ceil(ends.length * 0.9) - 1];
    const streamLast = Math.max(...[...streamed].map((p) => r.done.get(p) ?? Infinity));
    rows.push({ q: 5, stream: kind, option: oname, verdictS: r.verdictAt, streamLastS: streamLast, unnamedFirstS: first, unnamedP90S: p90, unnamed: unnamed.length, allS: r.allAt });
    out.push(`  ${oname.padEnd(32)} ${r0(r.verdictAt).padStart(6)}  ${r0(streamLast).padStart(11)}  ${r0(first).padStart(13)}  ${r0(p90).padStart(11)}  ${r0(r.allAt).padStart(5)}`);
  }
  }
}

// ---- Re-waits: how many batches the recorded 0.1.377 plan forms (14 parity waits, 2 own waits).
{
  const r = simulate({ files: s.files, initialBusyUntil: s.initialBusyUntil, W, policy: { mode: 'tiers', order: 'batch', inTier: 'lpt' }, plan: { waits: s.recorded } });
  const batches = r.tiers.filter((t) => t.kind === 'batch');
  out.push(`\n## Re-waits: the recorded plan (${s.recorded.length} waits) under batch order forms ${batches.length} batch tiers: ${batches.map((b) => `${b.files} files at ${Math.round(b.at)} s`).join(', ')}`);
}

writeFileSync(new URL(`cases-W${W}.jsonl`, import.meta.url), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(out.join('\n'));
