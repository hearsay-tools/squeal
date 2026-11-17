// Throwaway reproduction: only two synthetic test files in a temporary git repo.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const [cli, modules] = process.argv.slice(2);
if (!cli || !modules) throw new Error('usage: node live.mjs <pinned squeal.mjs> <node_modules>');
const load = loadavg()[0];
console.log(JSON.stringify({at: new Date().toISOString(), load, cpus: cpus().length, node: process.version}));
if (load > cpus().length) { console.log('SKIP: one-minute load exceeds CPU count'); process.exit(0); }
const root = mkdtempSync(join(tmpdir(), 'sq-issue234-'));
const clean = s => s.replaceAll(root, '<fixture>').replaceAll(process.env.HOME, '~');
const env = {...process.env, XDG_RUNTIME_DIR: join(root, 'runtime')};
mkdirSync(env.XDG_RUNTIME_DIR);
const run = (...args) => {
  console.log('$ squeal ' + args.join(' '));
  try {
    const out = execFileSync(process.execPath, [resolve(cli), ...args], {cwd: root, env, encoding: 'utf8', timeout: 70000, stdio: ['ignore','pipe','pipe']});
    console.log(clean(out)); console.log('exit=0');
  } catch (e) { console.log(clean(String(e.stdout ?? '') + String(e.stderr ?? ''))); console.log('exit=' + e.status); }
};
execFileSync('git', ['init', '-q', root]);
writeFileSync(join(root, '.gitignore'), 'node_modules/\nruntime/\n');
writeFileSync(join(root, 'package.json'), JSON.stringify({name:'issue234-probe', private:true, type:'module', devDependencies:{vitest:'5.0.3'}}));
symlinkSync(resolve(modules), join(root, 'node_modules'), 'dir');
writeFileSync(join(root, 'vitest.config.ts'), 'export default {test:{include:["test/*.test.ts"], maxWorkers:1}};\n');
writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({baseline:{onStart:'lookup-only'},complexity:{enabled:false},coverage:{enabled:false},checks:[{name:'run-loop',runner:'vitest',tests:['test/**'],at:'manual'}]}));
mkdirSync(join(root, 'test'));
for (const name of ['a','b']) writeFileSync(join(root, `test/${name}.test.ts`), 'import {it,expect} from "vitest"; it("passes",()=>expect(1).toBe(1));\n');
try {
  run('--version'); run('start');
  run('run', 'run-loop', 'test/a.test.ts', 'test/b.test.ts', '--wait', '60000');
  run('status', 'test/a.test.ts', 'test/b.test.ts');
  run('run', 'run-loop', 'test/a.test.ts', 'test/b.test.ts', '--wait', '60000');
} finally { run('stop'); rmSync(root, {recursive:true, force:true}); }
