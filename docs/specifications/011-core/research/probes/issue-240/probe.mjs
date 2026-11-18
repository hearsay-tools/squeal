// Throwaway reproduction, not a product regression test.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cpus, loadavg, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const dir = import.meta.dirname;
const repo = resolve(dir, '../../../../../..');
const cli = process.env.SQUEAL_CLI || join(homedir(), '.codex/plugins/data/squeal-hearsay/bin/squeal');
// OBSERVE selects a runtime-read control; observation is enabled in both legs.
const runtimeRead = process.env.OBSERVE === '1';
const observe = true;
const load = loadavg()[0];
console.log(JSON.stringify({ node: process.version, observe, load1: load, cpus: cpus().length }));
if (load > cpus().length) process.exit(0);
const root = mkdtempSync(join(dir, '.fixture-'));
const delay = ms => new Promise(r => setTimeout(r, ms));
const clean = text => text.replaceAll(root, '<fixture>').replaceAll(homedir(), '~');
function cmd(bin, args) {
  const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 45000 });
  return { code: r.status, out: clean(r.stdout || ''), err: clean(r.stderr || ''), error: r.error?.message };
}
function squeal(args) { const r = cmd(cli, args); console.log(JSON.stringify({ command: `squeal ${args.join(' ')}`, ...r })); return r; }
function git(args) { const r = cmd('git', args); if (r.code !== 0) throw Error(JSON.stringify(r)); return r.out; }
function write(path, text) { mkdirSync(resolve(root, path, '..'), {recursive:true}); writeFileSync(join(root,path),text); }
function snapshot(step) {
  const dbDir = join(root,'.git/squeal');
  const file = readdirSync(dbDir).find(p=>p.endsWith('.db') || p.endsWith('.sqlite'));
  const db = new DatabaseSync(join(dbDir,file), {readOnly:true});
  const all = sql => db.prepare(sql).all();
  console.log(clean(JSON.stringify({step, load1:loadavg()[0], gitStatus:git(['status','--porcelain']),
    revisions:all('select number,trigger,changes from revisions order by number'),
    keys:all('select path,key,revision,pending from test_file_keys order by path'),
    runs:all('select revision,test_files,end_state from runs order by started_at'),
    closures:all('select path,closure_paths from test_files order by path'),
    observed:all("select key,value from meta where key like 'observed.%' or key like '%glob%'")
  })));
  db.close();
}
let stopped = false;
try {
  git(['init','-q']);
  write('.gitignore','node_modules\n');
  write('.git/info/exclude','packages/pkg/src/lint-base/\npackages/pkg/src/known.ts\n');
  symlinkSync(join(repo,'node_modules'),join(root,'node_modules'));
  write('package.json',JSON.stringify({type:'module',devDependencies:{vitest:'5.0.3'}}));
  write('squeal.config.json',JSON.stringify({baseline:{onStart:'lookup-only'},observe:{runtimeInputs:observe},complexity:{enabled:false},coverage:{enabled:false}}));
  write('vitest.config.js',`export default {test:{include:['test/*.test.ts'],maxWorkers:1}};\n`);
  write('packages/pkg/src/value.ts','export const value = 1;\n');
  write('packages/pkg/src/known.ts','export const known = 1;\n');
  write('test/basic.test.ts',`import {test,expect} from 'vitest'; import {value} from '../packages/pkg/src/value'; test('basic',()=>expect(value).toBeGreaterThan(0));\n`);
  write('test/known.test.ts', runtimeRead
    ? `import {test,expect} from 'vitest'; import {readFileSync} from 'node:fs'; test('known',()=>expect(readFileSync('packages/pkg/src/known.ts','utf8')).toContain('export const known'));\n`
    : `import {test,expect} from 'vitest'; import {known} from '../packages/pkg/src/known'; test('known',()=>expect(known).toBeGreaterThan(0));\n`);
  git(['add','.']); git(['-c','user.name=probe','-c','user.email=probe@example.invalid','commit','-qm','fixture']);
  squeal(['--version']);
  squeal(['start']);
  squeal(['run','tests','test/basic.test.ts','test/known.test.ts','--wait','30000']);
  snapshot('baseline');
  for (let round=1;round<=2;round++) {
    for (let i=0;i<120;i++) write(`packages/pkg/src/lint-base/file-${i}.ts`,`export const value${i} = ${i};\n`);
    console.log(JSON.stringify({step:`add-${round}-git-ignore`,result:git(['check-ignore','packages/pkg/src/lint-base/file-0.ts'])}));
    await delay(4000); squeal(['status','--json']); snapshot(`add-${round}`);
    rmSync(join(root,'packages/pkg/src/lint-base'),{recursive:true});
    await delay(4000); squeal(['status','--json']); snapshot(`delete-${round}`);
  }
  write('packages/pkg/src/value.ts','export const value = 2;\n');
  await delay(4000); squeal(['status','--wait','10000','test/basic.test.ts']); snapshot('tracked-control');
  write('packages/pkg/src/known.ts','export const known = 2;\n');
  await delay(4000); squeal(['status','--wait','10000','test/known.test.ts']); snapshot('ignored-closure-control');
} finally {
  stopped = squeal(['stop']).code === 0;
  if (stopped) { await delay(500); rmSync(root,{recursive:true,force:true}); }
  else console.log('Fixture retained because stop did not succeed.');
}
