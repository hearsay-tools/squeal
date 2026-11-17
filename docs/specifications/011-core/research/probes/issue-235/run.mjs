import { cpus, loadavg } from 'node:os';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const probe = 'docs/specifications/011-core/research/probes/issue-235';
const temp = resolve(probe, '.runtime/tmp');
mkdirSync(temp, { recursive: true });
const oneMinute = loadavg()[0];
const cpuCount = cpus().length;
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, oneMinute, cpuCount, skipped: oneMinute > cpuCount }));
if (oneMinute > cpuCount) process.exit(77);
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', `${probe}/vitest.config.ts`], {
  stdio: 'inherit', env: { ...process.env, TMPDIR: temp },
});
process.exit(result.status ?? 1);
