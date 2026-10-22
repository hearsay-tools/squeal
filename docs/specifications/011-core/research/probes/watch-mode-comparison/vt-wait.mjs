// Vitest watch timer (011-119): reads the stamp reporter's NDJSON for events after t0.
// Usage: node vt-wait.mjs <log> <t0 epoch s> <no-rerun wait s> <timeout s> <test file>...
// A run that starts within the no-rerun wait is followed to its end; prints one JSON line.
import { readFileSync } from 'node:fs';
const [log, t0s, quiet, tos, ...files] = process.argv.slice(2);
const t0 = Number(t0s), start = Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (;;) {
  const ev = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t > t0 - 0.05);
  const st = ev.find((e) => e.ev === 'start');
  const now = Date.now() / 1000;
  if (!st && now - start > Number(quiet)) { console.log(JSON.stringify({ rerun: false, waited: now - t0 })); break; }
  const end = st && ev.find((e) => e.ev === 'end' && e.t >= st.t);
  if (end) {
    const per = {};
    for (const f of files) { const m = ev.find((e) => e.ev === 'moduleEnd' && e.file === f && e.t >= st.t); per[f] = m ? { at: m.t, state: m.state } : null; }
    const rr = ev.find((e) => e.ev === 'rerun');
    console.log(JSON.stringify({ rerun: true, trigger: rr?.trigger, rerunAt: rr?.t, startAt: st.t, endAt: end.t, ran: st.files, states: end.modules, files: per, later: ev.filter((e) => e.ev === 'start' && e.t > end.t).length }));
    break;
  }
  if (now - start > Number(tos)) { console.log(JSON.stringify({ rerun: !!st, timeout: true })); break; }
  await sleep(100);
}
