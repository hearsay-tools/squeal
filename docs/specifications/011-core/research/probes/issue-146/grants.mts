// Throwaway source-adapter probe, using the fixture after probe.mjs stopped its daemon.
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { createVitestAdapter } from '../../../../../../src/runners/vitest/index.js';

const root = process.argv[2];
if (!root) throw new Error('Pass the fixture root printed by probe.mjs');
const files = ['a', 'b'].flatMap(project => Array.from({ length: 6 }, (_, i) => ({ project, path: `test/${project}${i}.test.ts` })));
function gate(workers: number) {
  const state = { at: new Date().toISOString(), workers, load: loadavg(), cpus: cpus().length };
  console.log(JSON.stringify(state));
  if (state.load[0]! > state.cpus) throw new Error('SKIPPED: load exceeds CPUs');
}
gate(1);
const adapter = await createVitestAdapter({ root });
try {
  for (const workers of [1, 4]) {
    gate(workers);
    writeFileSync(join(root, 'events.jsonl'), '');
    const report = await adapter.run(files, { workers, runId: `grant-${workers}`, logDir: join(root, `grant-${workers}`), timeoutMs: 60000 });
    const events = readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
    let active = 0, peak = 0;
    for (const e of events.sort((a, b) => a.at - b.at)) { active += e.phase === 'start' ? 1 : -1; peak = Math.max(peak, active); }
    const fileMs = report.fileDurations.reduce((sum, f) => sum + f.durationMs, 0);
    console.log(JSON.stringify({ workers, modelWidth: adapter.tierWidth?.(files[0]!, workers), end: report.end, failure: report.failure, completed: report.completedFiles.length, durationMs: report.durationMs, fileMs, effectiveWorkers: fileMs / report.durationMs, peak, ids: [...new Set(events.map(e => e.worker))], fileDurations: report.fileDurations }));
  }
} finally { await adapter.close(); }
