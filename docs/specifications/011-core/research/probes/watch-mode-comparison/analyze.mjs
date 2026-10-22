// Summarises results.ndjson (011-119): per repository, scenario, step and tool, the seconds from the
// write to the first and to the last result over the edit's affected test files, median and range,
// the one-minute load, correctness against the expected outcome, and Squeal's stages from the store.
// Usage: node analyze.mjs <results.ndjson> [--stages]
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l.replace(/":(-?)\./g, '":$10.')));
const stagesOn = process.argv.includes('--stages');
// Repetition 1 of t-cli-swp wrote the same cli.py content as repetition 1 of t-cli, so Squeal answered it
// from the store; it is left out and repetition 6 stands in for it.
const kept = rows.filter((r) => !(r.repo === 'toolkit' && r.sc === 't-cli-swp' && r.rep === 1));
// Expected outcomes, from plain targeted runs (README): the files that fail after the edit.
const failing = { 's-break': ['test/harness/pi/session.test.ts'], 'c-break': ['packages/cezar/src/application-update/helper.test.ts'],
  't-cli': ['tools/generator/tests/publish.test.ts'], 't-cli-swp': ['tools/generator/tests/publish.test.ts'], 't-rules': ['tools/generator/tests/publish.test.ts'] };
const expectFail = (r, f) => r.op === 'apply' && (failing[r.sc] ?? []).some((x) => x.endsWith(f));
const clone = { squeal: '/tmp/wm119/repos/squeal-s', cezar: '/tmp/wm119/repos/cezar-s', toolkit: '/tmp/wm119/repos/toolkit-s' };
const dbs = {};
function db(repo) { return dbOf(repo); }
const dbOf = (repo) => (dbs[repo] ??= new DatabaseSync(`${clone[repo]}/.git/squeal/store.sqlite`, { readOnly: true }));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n === 0 ? NaN : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const groups = new Map();
for (const r of kept) {
  const k = `${r.repo}|${r.sc}|${r.op}|${r.tool}${r.hold ? '+hold' : ''}`;
  let first = NaN, last = NaN, wrong = [], note = '', stages = null;
  if (r.tool === 'squeal') {
    // A new failure is stored and told at its first run, then re-run once to confirm (001-171) with the
    // file pending again: its time is the transition to fail, not the end of the confirmation.
    const fs = Object.entries(r.w.files ?? {}).map(([f, v]) => {
      if (v.outcome !== 'fail') return [f, v];
      const tr = db(r.repo).prepare(`SELECT min(t.at) at FROM transitions t JOIN checks c ON c.id = t.check_id WHERE c.test_path = ? AND t.to_outcome = 'fail' AND t.at >= ?`).get(f, Math.round(r.t0 * 1000));
      return [f, tr?.at ? { ...v, confirmedAt: v.at, at: tr.at / 1000 } : v];
    });
    const confirm = fs.filter(([, v]) => v.confirmedAt).map(([, v]) => v.confirmedAt - r.t0);
    if (confirm.length) note = `fail confirmed by re-run at ${confirm.map((x) => x.toFixed(1)).join(',')} s`;
    if (fs.length < (r.nfiles ?? fs.length) || r.w.idleAt === null && fs.length === 0) note = 'timeout';
    first = Math.min(...fs.map(([, v]) => v.at)) - r.t0; last = Math.max(...fs.map(([, v]) => v.at)) - r.t0;
    for (const [f, v] of fs) if ((v.outcome === 'fail') !== expectFail(r, f)) wrong.push(`${f}:${v.outcome}`);
    if (stagesOn) {
      const d = db(r.repo);
      const runs = d.prepare('SELECT id, started_at, ended_at, end_state, test_files FROM runs WHERE started_at >= ? AND started_at <= ? ORDER BY started_at').all(Math.round(r.t0 * 1000) - (r.sc === 't-cli-swp' ? 14000 : 500), Math.round(Math.max(...fs.map(([, v]) => v.at)) * 1000));
      stages = { watcher: r.w.revAt - r.t0, runs: runs.map((x) => ({ s: x.started_at / 1000 - r.t0, e: x.ended_at ? x.ended_at / 1000 - r.t0 : null, st: x.end_state, n: JSON.parse(x.test_files).length })) };
    }
  } else if (r.tool === 'vitest-watch') {
    if (!r.w.rerun) { note = 'no rerun'; if (expectFail(r, (failing[r.sc] ?? [''])[0].split('/').pop())) wrong.push('stale pass'); }
    else {
      const fs = Object.entries(r.w.files ?? {}).filter(([, v]) => v);
      first = Math.min(...fs.map(([, v]) => v.at)) - r.t0; last = Math.max(...fs.map(([, v]) => v.at)) - r.t0;
      for (const [f, v] of fs) if ((v.state === 'failed') !== expectFail(r, f)) wrong.push(`${f}:${v.state}`);
      const missing = Object.entries(r.w.files ?? {}).filter(([, v]) => !v).map(([f]) => f);
      if (missing.length) note = `not run: ${missing.join(' ')}`;
    }
  }
  const g = groups.get(k) ?? { first: [], last: [], load: [], wrong: [], notes: [], stages: [], plain: [], testmon: [], pyout: [] };
  if (r.tool === 'pytest') { g.plain.push(r.plain_s); g.testmon.push(r.testmon_s); g.pyout.push(`${r.plain} / ${r.testmon}`); }
  g.first.push(first); g.last.push(last); g.load.push(r.load); if (wrong.length) g.wrong.push(`rep${r.rep}:${wrong.join(',')}`); if (note) g.notes.push(`rep${r.rep}:${note}`); if (stages) g.stages.push({ rep: r.rep, ...stages });
  groups.set(k, g);
}
console.log('| repo | scenario | step | tool | n | first result s, median (range) | all affected s, median (range) | load 1 min | wrong | notes |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const [k, g] of groups) {
  const [repo, sc, op, tool] = k.split('|');
  const rng = (a) => { const v = a.filter(Number.isFinite); return v.length ? `${f1(med(v))} (${f1(Math.min(...v))} to ${f1(Math.max(...v))})` : '-'; };
  if (tool === 'pytest') {
    console.log(`| ${repo} | ${sc} | ${op} | pytest plain | ${g.plain.length} | ${rng(g.plain)} | same | ${rng(g.load)} | | ${[...new Set(g.pyout.map((x) => x.split(' / ')[0]))].join('; ')} |`);
    console.log(`| ${repo} | ${sc} | ${op} | pytest --testmon | ${g.testmon.length} | ${rng(g.testmon)} | same | ${rng(g.load)} | | ${[...new Set(g.pyout.map((x) => x.split(' / ')[1]))].join('; ')} |`);
    continue;
  }
  console.log(`| ${repo} | ${sc} | ${op} | ${tool} | ${g.first.length} | ${rng(g.first)} | ${rng(g.last)} | ${rng(g.load)} | ${g.wrong.join(' ') || 'none'} | ${g.notes.join(' ')} |`);
  if (stagesOn) for (const s of g.stages) console.log(`  stages rep${s.rep}: watcher ${s.watcher.toFixed(2)} s; runs ${s.runs.map((x) => `[${x.s.toFixed(1)}..${x.e === null ? 'open' : x.e.toFixed(1)} ${x.st} ${x.n}f]`).join(' ')}`);
}
