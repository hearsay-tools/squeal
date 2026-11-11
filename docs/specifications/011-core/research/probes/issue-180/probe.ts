// Throwaway research probe. No product files or existing daemon stores are changed.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const checkout = process.cwd();
const temp = mkdtempSync('/tmp/sq180-');
const source = join(temp, 'source');
const root = join(temp, 'fixture');
const runtime = join(temp, 'runtime');
for (const p of [source, root, runtime]) mkdirSync(p);
const tag = 'squeal--v0.1.426';
const cli = '/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs';
const log = (what: string, data: unknown) => console.log(JSON.stringify({what, data}));
log('environment', {date: new Date().toISOString(), node: process.version, load: loadavg(), cpus: cpus().length, tag, commit: execFileSync('git', ['rev-parse', tag], {encoding:'utf8'}).trim(), cli});
if (loadavg()[0] > cpus().length) { log('skip', 'load exceeds CPU count'); rmSync(temp,{recursive:true,force:true}); process.exit(0); }
// Read the exact reported release. No compilation/build and no dependency install.
const archive = execFileSync('git', ['archive', tag, 'src', 'package.json'], {maxBuffer: 30_000_000});
execFileSync('tar', ['-x', '-C', source], {input:archive});
symlinkSync(join(checkout, 'node_modules'), join(source, 'node_modules'), 'dir');
const mod = async (p: string) => import(pathToFileURL(join(source, p)).href);
const { main } = await mod('src/cli/main.ts');
const { openStore, isStoreOpenFailure } = await mod('src/core/store/open.ts');
const { worktreeIdFor } = await mod('src/core/fs/git-layout.ts');
const { socketPathFor } = await mod('src/core/daemon/paths.ts');
const { requestDaemon } = await mod('src/core/daemon/client.ts');
const { refinedMetaKey } = await mod('src/core/types/scheduler.ts');
process.env.XDG_RUNTIME_DIR = runtime;
writeFileSync(join(root, 'package.json'), JSON.stringify({name:'issue-180-probe',type:'module',private:true}));
writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({complexity:{enabled:false},coverage:{enabled:false},baseline:{onStart:'lookup-only'},vitest:{exclude:['**/*']},nodeTest:[{name:'nt',include:['test/*.test.mjs']}]}));
mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
writeFileSync(join(root, 'src/value.mjs'), 'export const value = 1;\n');
const paths = ['a','b','c'].map(n => `test/${n}.test.mjs`);
for (const p of paths) writeFileSync(join(root,p), `import { test } from 'node:test';\nimport { strictEqual } from 'node:assert';\nimport { value } from '../src/value.mjs';\ntest('value', () => strictEqual(value, 1));\n`);
for (const args of [['init','-q'],['add','.'],['-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture']]) execFileSync('git', args,{cwd:root});
const id = worktreeIdFor(root);
const socket = socketPathFor(id, {XDG_RUNTIME_DIR: runtime});
log('daemon command', ['node',cli,'daemon',root]);
const daemon = spawn(process.execPath, [cli, 'daemon', root], {cwd:root, env:process.env, stdio:['ignore','pipe','pipe']});
let daemonOutput='';
daemon.stdout.on('data', b=>daemonOutput+=b); daemon.stderr.on('data', b=>daemonOutput+=b);
// The module comes from the extracted historical tag, so this throwaway probe has no static store type.
let store: any;
async function run(args: string[]) {
 let stdout='',stderr=''; const started=Date.now();
 const code=await main(args,{cwd:root,env:process.env,stdout:(s:string)=>stdout+=s,stderr:(s:string)=>stderr+=s});
 const result={args,code,ms:Date.now()-started,stdout,stderr}; log('CLI',result); return result;
}
try {
 let ready=false;
 for (const end=Date.now()+30000; Date.now()<end;) {
  try { const p=await requestDaemon(socket,{type:'ping'},500); if(p.phase==='ready'){log('ready',p);ready=true;break;} } catch {}
  if(daemon.exitCode!==null) break;
  await sleep(100);
 }
 if(!ready) throw new Error('Daemon did not become ready');
 await run(['--version']);
 const base=await run(['run','tests',...paths,'--wait','20000']);
 if(base.code!==0) throw new Error('Baseline did not pass');
 store=openStore(join(root,'.git')); if(isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
 log('live race before', {revision:(store.revisions.latest(id) ?? {number:0}), load:loadavg()});
 if(loadavg()[0]>cpus().length) throw new Error('Load rose above CPU count; no further live probes');
 writeFileSync(join(root,'src/value.mjs'),'export const value = 2;\n');
 // In-process CLI avoids a new process masking the watcher debounce window.
 await run(['run','tests',...paths,'--wait','1000']);
 await sleep(1200);
 await run(['status',...paths,'--json']);
 await run(['run','tests',...paths,'--wait','10000']);
 // Restore passing content and let a synced named wait settle it before injection.
 writeFileSync(join(root,'src/value.mjs'),'export const value = 1;\n');
 await run(['status','--wait','10000',...paths]);
 const key=refinedMetaKey(id); const prior=store.meta.get(key);
 const revision=store.revisions.latest(id).number;
 log('synthetic injection', {key,prior,replacement:String(revision-1),note:'Only listing metadata is injected. The actual daemon and stored results remain real. This does not prove the natural scheduler can reach this state.'});
 store.meta.set(key,String(revision-1));
 try {
  await run(['run','tests',...paths]);
  await run(['run','tests',...paths,'--wait','1000']);
  await run(['status',...paths,'--json']);
 } finally { store.meta.set(key,prior); }
 log('restored', {key,value:store.meta.get(key)});
} catch(error) { log('error', String(error)); process.exitCode=1; }
finally {
 store?.close?.();
 daemon.kill('SIGTERM');
 await Promise.race([new Promise(r=>daemon.once('exit',r)),sleep(5000)]);
 if(daemon.exitCode===null) daemon.kill('SIGKILL');
 log('daemon output',daemonOutput);
 rmSync(temp,{recursive:true,force:true});
}
