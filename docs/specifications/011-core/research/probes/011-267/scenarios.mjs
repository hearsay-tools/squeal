// Throwaway probe, row 011-267. Builds the two replay workloads from
// traces.json (cezar's store) and the agents' recorded named waits.
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const traces = JSON.parse(readFileSync(new URL('traces.json', here), 'utf8'));
const trialWaits = JSON.parse(readFileSync(new URL('waits.json', here), 'utf8'));

const fast = (p) => !/\.(cjs|mjs)$/.test(p) && !p.endsWith('.e2e.ts') && !p.startsWith('packages/cezar/test/unit/');
const sec = (iso) => Date.parse(iso) / 1000;

/**
 * Files of one episode: every fast file whose run started in [t0, end) with a
 * reported duration. N: a named parity file. E: the edit's work, a non-named
 * file of a tier of at most 4 files that started before the first wider tier
 * without a named file. B: the rest. `own`: a file the agent's own edit wait named.
 */
function episode({ trace, t0, end, own }) {
  const t = traces.find((x) => x.name === trace);
  const T0 = sec(t0);
  const END = sec(end);
  const runs = t.runs.filter((r) => fast(r.files[0].path) && sec(r.start) < END && sec(r.start) + (r.wall ?? 0) > T0);
  const firstBacklog = runs.find((r) => sec(r.start) >= T0 && r.files.length > 4 && r.files.every((f) => !f.named));
  const files = new Map();
  let initialBusyUntil = 0;
  const real = new Map();
  for (const r of runs) {
    const startS = sec(r.start) - T0;
    const endS = startS + (r.wall ?? 0);
    const before = startS < 0;
    if (before) initialBusyUntil = Math.max(initialBusyUntil, endS);
    for (const f of r.files) {
      if (f.s === null || !fast(f.path)) continue;
      const isE = !f.named && r.files.length <= 4 && (!firstBacklog || sec(r.start) < sec(firstBacklog.start));
      const prev = files.get(f.path);
      files.set(f.path, {
        path: f.path,
        d: f.s,
        cls: f.named ? 'N' : isE || prev?.cls === 'E' ? 'E' : 'B',
        own: own.includes(f.path),
        ...(before ? { preDone: true, doneAt: endS } : {}),
      });
      real.set(f.path, endS);
    }
  }
  const list = [...files.values()];
  const at = (pred) => Math.max(...list.filter(pred).map((f) => real.get(f.path)));
  return {
    files: list,
    initialBusyUntil: Math.max(0, initialBusyUntil),
    real: { verdictS: at((f) => f.cls === 'N'), ownS: at((f) => f.own), allS: at(() => true) },
  };
}


export function build(name) {
  if (name === '0.1.377') {
    const t0 = '2026-10-29T09:29:19Z';
    const own = [
      'packages/cezar/src/workflows/ci-wait.test.ts',
      'packages/cezar/src/workflows/execution-account.test.ts',
      'packages/cezar/src/workflows/workspace-semaphore.test.ts',
      'packages/cezar/src/workflows/worker-wait-conversations.test.ts',
      'packages/cezar/src/workflows/run.test.ts',
    ];
    const ep = episode({ trace: '0.1.377', t0, end: '2026-10-29T10:03:00Z', own });
    const named = ep.files.filter((f) => f.cls === 'N').map((f) => f.path);
    const waits = trialWaits
      .filter((w) => w.waitedMs > 30000)
      .map((w) => ({ at: sec(w.start) - sec(t0), until: sec(w.end) - sec(t0), files: named, agent: 'parity' }));
    // The agent's own-file waits: 09:33:46 and 09:53:45 (session rollout), 60 s each.
    for (const s of ['09:33:46', '09:53:45']) {
      const at = sec(`2026-10-29T${s}Z`) - sec(t0);
      waits.push({ at, until: at + 60, files: own, agent: 'own' });
    }
    const gaps = trialWaits.filter((w) => w.waitedMs > 30000).map((w, i, a) => (i ? sec(w.start) - sec(a[i - 1].end) : null)).filter((x) => x !== null).sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    return {
      ...ep,
      name,
      recorded: waits,
      cadence: { wait: 60, gap },
      ownFirstAt: sec('2026-10-29T09:33:46Z') - sec(t0),
    };
  }
  if (name === '0.1.374') {
    const t0 = '2026-10-29T01:21:55Z';
    const own = [
      'packages/cezar/src/workflows/automation-tools.test.ts',
      'packages/cezar/src/workflows/run-preview.test.ts',
      'packages/cezar/src/server/project-context.test.ts',
      'packages/cezar/src/workflows/ci-wait-refusal.test.ts',
      'packages/cezar/src/workflows/ci-wait-registration.test.ts',
      'packages/cezar/src/workflows/ci-wait.test.ts',
    ];
    const ep = episode({ trace: '0.1.374', t0, end: '2026-10-29T02:00:00Z', own });
    const named = ep.files.filter((f) => f.cls === 'N').map((f) => f.path);
    // Parity waits from session rollout 01a1853d-6b87 (60 s each; later ones named the pending files).
    const parity = ['01:21:55', '01:25:04', '01:28:10', '01:30:26', '01:32:41', '01:35:52', '01:39:03', '01:41:52', '01:45:06', '01:48:17', '01:51:28', '01:54:38', '01:56:49'];
    const waits = parity.map((s) => {
      const at = sec(`2026-10-29T${s}Z`) - sec(t0);
      return { at, until: at + 60, files: named, agent: 'parity' };
    });
    for (const s of ['01:22:49', '01:24:47']) {
      const at = sec(`2026-10-29T${s}Z`) - sec(t0);
      waits.push({ at, until: at + 60, files: own, agent: 'own' });
    }
    return { ...ep, name, recorded: waits, cadence: { wait: 60, gap: 191 }, ownFirstAt: sec('2026-10-29T01:22:49Z') - sec(t0) };
  }
  throw new Error(`no scenario ${name}`);
}
