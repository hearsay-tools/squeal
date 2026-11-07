// Throwaway real-daemon probe. Generated state stays under this directory.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const base = import.meta.dirname;
const mode = process.argv[2] ?? 'idle';
if (!['idle','running','excluded'].includes(mode)) throw Error('unknown mode');
const repo = resolve(base, '../../../../../..');
const root = join(base, '.fixture');
const cli = '/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs';
const emit = x => console.log(JSON.stringify(x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = loadavg()[0];
emit({mode, date: new Date().toISOString(), node: process.version, load, cpus: cpus().length, cli, sha256: createHash('sha256').update(readFileSync(cli)).digest('hex'), vitest: JSON.parse(readFileSync(join(repo,'node_modules/vitest/package.json'))).version});
if (load > cpus().length) { emit({skipped:'one-minute load exceeds CPU count'}); process.exit(0); }
if (existsSync(root)) throw Error('fixture already exists');
mkdirSync(root); // A nested Git repository gives the fixture its own Squeal store.
const env = {...process.env};
function git(args) {
 const r = spawnSync('git', args, {cwd:root, encoding:'utf8'});
 emit({command:['git',...args], code:r.status, out:r.stdout, err:r.stderr});
 if(r.status !== 0) throw Error(r.stderr);
 return r.stdout.trim();
}
async function command(args, label, timeout=20000) {
 const started=Date.now();
 const child=spawn(process.execPath,[cli,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let out='',err=''; child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 const code=await new Promise(r=>child.once('close',r)); clearTimeout(timer);
 emit({label, command:[process.execPath,cli,...args], code, elapsedMs:Date.now()-started, out,err});
 try{return JSON.parse(out);}catch{return null;}
}
let daemon, log='';
try {
 git(['init','-q']);
 symlinkSync(join(repo,'node_modules'),join(root,'node_modules'));
 writeFileSync(join(root,'.gitignore'),'node_modules\n');
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(join(root,'squeal.config.json'),JSON.stringify({baseline:{onStart:'lookup-only'},observe:{runtimeInputs:true},complexity:{enabled:false},coverage:{enabled:false},lint:{enabled:false},runner:{tierSize:1}}));
 writeFileSync(join(root,'vitest.config.js'),'export default '+JSON.stringify({test:{name:'server',include:['src/**/*.test.ts'],maxWorkers:1,...(mode==='excluded'?{exclude:['src/added.test.ts']}: {})}})+';\n');
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'src/reader.test.ts'),"import {test,expect} from 'vitest';import {readFileSync,existsSync,writeFileSync} from 'node:fs';test('reads new test bytes',async()=>{let text='';try{text=readFileSync(new URL('./added.test.ts',import.meta.url),'utf8')}catch{};expect(typeof text).toBe('string');if(existsSync('.git/hold')){writeFileSync('.git/entered','yes');const end=Date.now()+20000;while(!existsSync('.git/release') && Date.now()<end)await new Promise(r=>setTimeout(r,50))}},25000);\n");
 git(['add','.gitignore','package.json','squeal.config.json','vitest.config.js','src/reader.test.ts']);
 git(['-c','user.name=probe','-c','user.email=probe@example.invalid','commit','-qm','initial fixture']);
 emit({daemonCommand:[process.execPath,cli,'daemon',root]});
 daemon=spawn(process.execPath,[cli,'daemon',root],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 daemon.stdout.on('data',b=>log+=b);daemon.stderr.on('data',b=>log+=b);
 await sleep(2500);
 await command(['status','--wait','10000','--json','src/reader.test.ts'],'baseline-reader');
 if(mode==='running') {
  writeFileSync(join(root,'.git/hold'),'hold');
  const file=join(root,'src/reader.test.ts');writeFileSync(file,readFileSync(file,'utf8')+'// edit starts the held reader\n');
  for(let i=0;i<100 && !existsSync(join(root,'.git/entered'));i++)await sleep(100);
  if(!existsSync(join(root,'.git/entered')))throw Error('reader gate not reached');
  emit({readerGateEntered:true});
 }
 writeFileSync(join(root,'src/added.test.ts'),"import {test,expect} from 'vitest';test('own new test',()=>expect(2+2).toBe(4));\n");
 await command(['status','--json','src/added.test.ts'],'immediate-added');
 if(mode==='idle')await command(['status','--wait','15000','--json','src/added.test.ts'],'uncommitted-added');
 git(['add','src/added.test.ts']);
 git(['-c','user.name=probe','-c','user.email=probe@example.invalid','commit','-qm','add included test']);
 if(mode==='running') {
  await command(['status','--wait','1000','--json','src/added.test.ts'],'committed-while-reader-held');
  writeFileSync(join(root,'.git/release'),'go');
 }
 await command(['status','--wait','15000','--json','src/added.test.ts'],'committed-added');
 await command(['status','--wait','10000','--json','src/reader.test.ts'],'reader-after-add');
 await sleep(32000); // One idle reconciliation interval, bounded.
 await command(['status','--wait','10000','--json','src/added.test.ts'],'after-reconcile');
 emit({endLoad:loadavg()[0]});
} finally {
 if(existsSync(join(root,'.git')))writeFileSync(join(root,'.git/release'),'go');
 if(daemon && daemon.exitCode===null) {
  await command(['stop',root],'stop-owned-fixture');
  for(let i=0;i<50 && daemon.exitCode===null;i++) await sleep(100);
  if(daemon.exitCode===null) daemon.kill('SIGTERM');
  for(let i=0;i<50 && daemon.exitCode===null;i++) await sleep(100);
  if(daemon.exitCode===null) daemon.kill('SIGKILL');
 }
 emit({daemonExit:daemon?.exitCode,daemonLog:log});
 if(daemon?.exitCode===null) throw Error('fixture daemon did not exit; inspect before cleanup');
 rmSync(root,{recursive:true,force:true});
}
