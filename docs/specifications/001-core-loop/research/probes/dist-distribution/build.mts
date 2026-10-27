/** Throwaway probe: build each harness twice in temporary directories, never in plugins/. */
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDist } from '../../../../../../src/harness/build.ts';
import { CLAUDE_CODE_PLUGIN } from '../../../../../../src/harness/claude-code/build.ts';
import { CODEX_PLUGIN } from '../../../../../../src/harness/codex/build.ts';
import { PI_PLUGIN } from '../../../../../../src/harness/pi/build.ts';
import { buildOpencodeDist } from '../../../../../../src/harness/opencode/build.ts';
const scratch = await mkdtemp(join(tmpdir(), 'squeal-dist-build-'));
async function hashes(dir: string, prefix = ''): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const name of (await readdir(join(dir, prefix))).sort()) {
    const relative = join(prefix, name);
    if ((await stat(join(dir, relative))).isDirectory()) Object.assign(found, await hashes(dir, relative));
    else found[relative] = createHash('sha256').update(await readFile(join(dir, relative))).digest('hex');
  }
  return found;
}
const result = [];
try {
  for (const [name, build] of [
    ['claude-code', (out: string) => buildDist(CLAUDE_CODE_PLUGIN, out)],
    ['codex', (out: string) => buildDist(CODEX_PLUGIN, out)],
    ['pi', (out: string) => buildDist(PI_PLUGIN, out)],
    ['opencode', buildOpencodeDist],
  ] as const) {
    const start = performance.now();
    const first = join(scratch, name, 'first');
    const second = join(scratch, name, 'second');
    await build(first); await build(second);
    const a = await hashes(first), b = await hashes(second);
    const tracked = await hashes(resolve('plugins', name, 'dist'));
    const changed = (x: Record<string, string>, y: Record<string, string>) =>
      [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(p => x[p] !== y[p]);
    result.push({name, files: Object.keys(a).length, repeatDifferences: changed(a,b), checkoutDifferences: changed(a,tracked), elapsedMs: Math.round(performance.now()-start)});
  }
  console.log(JSON.stringify({node: process.version, results: result}, null, 2));
} finally { await rm(scratch, {recursive:true, force:true}); }
