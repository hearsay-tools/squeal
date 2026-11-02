// Throwaway public-CLI contention probe. Run from the repository root.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
const host = { at: new Date().toISOString(), load: loadavg(), cpus: cpus().length, node: process.version };
console.log(JSON.stringify({ host }));
if (host.load[0] > host.cpus) { console.log('not reproduced, because one-minute load exceeds CPU count'); process.exit(0); }
const repo = process.cwd();
const cli = resolve(process.argv[2] ?? 'plugins/claude-code/dist/cli/squeal.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'sq138-'));
const root = join(scratch, 'repo');
const runtime = join(scratch, 'runtime');
mkdirSync(root); mkdirSync(runtime);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|GIT_)/.test(k) && !['NODE_OPTIONS','NODE_PATH','CODEX_SESSION_ID','PI_SESSION_ID','OPENCODE_SESSION_ID'].includes(k)));
env.XDG_RUNTIME_DIR = runtime; env.XDG_CONFIG_HOME = join(scratch,'config');
const write = (name, bytes) => writeFileSync(join(root,name),bytes);
const git = (...args) => execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
function start(args) {
 const child = spawn(process.execPath,['--disable-warning=ExperimentalWarning',cli,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let out='', err=''; child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);
 const done = new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal,out,err})));
 return {child,done};
}
async function status(label, wait) {
 const t=Date.now(); const args=['status',...(wait?['--wait',String(wait)]:[]),'pair.test.ts','--json'];
 const r=await start(args).done;
 let value; try {value=JSON.parse(r.out)} catch {value={raw:r.out}};
 console.log(JSON.stringify({label,ms:Date.now()-t,code:r.code,revision:value.revision,head:value.head,selection:value.selection,notes:value.daemonNotes,error:r.err,raw:value.raw}));
 return value;
}
let daemon, db;
try {
 write('package.json',JSON.stringify({type:'module',devDependencies:{vitest:'4.1.0'}}));
 write('.gitignore','node_modules/\n');
 symlinkSync(join(repo,'node_modules'),join(root,'node_modules'),'dir');
 write('vitest.config.ts',`import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['*.test.ts'],maxWorkers:1}});\n`);
 write('squeal.config.json',JSON.stringify({baseline:{onStart:'lookup-then-run-missing'},complexity:{enabled:false},coverage:{enabled:false}}));
 write('a.ts','export const a = 1;\n'); write('b.ts','export const b = 1;\n');
 write('pair.test.ts',`import {test,expect} from 'vitest'; import {a} from './a'; import {b} from './b'; test('both edits remain visible',()=>{expect(a).toBe(1);expect(b).toBe(1)});\n`);
 git('init','-q'); git('add','.'); git('-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture');
 console.log(JSON.stringify({cli,version:(await start(['--version']).done).out,fixtureHead:git('rev-parse','HEAD')}));
 daemon=start(['daemon',root]);
 let baseline;
 for(let n=0;n<30;n++){ await sleep(1000); baseline=await status('baseline'); if(baseline.selection?.result==='pass') break; }
 if(baseline.selection?.result!=='pass') throw new Error('baseline did not pass');
 db=new DatabaseSync(join(root,'.git/squeal/store.sqlite')); db.exec('PRAGMA busy_timeout=10000; BEGIN IMMEDIATE');
 const held=Date.now(); console.log(JSON.stringify({lockHeld:held}));
 write('a.ts','export const a = 2;\n');
 await sleep(1500); write('b.ts','export const b = 3;\n');
 const during=status('during-lock',1500);
 await sleep(Math.max(0,held+12000-Date.now()));
 db.exec('ROLLBACK'); db.close(); db=undefined;
 console.log(JSON.stringify({lockFreed:Date.now(),heldMs:Date.now()-held}));
 await during;
 await status('after-release',60000);
 write('pair.test.ts',`import {test,expect} from 'vitest'; import {a} from './a'; import {b} from './b'; test('both edits remain visible',()=>{expect(a).toBe(2);expect(b).toBe(3)});\n`);
 await status('both-edits-asserted',60000);
} finally {
 if(db){db.exec('ROLLBACK');db.close();}
 if(daemon){daemon.child.kill('SIGTERM'); const r=await Promise.race([daemon.done,sleep(10000).then(()=>null)]); if(!r)daemon.child.kill('SIGKILL'); console.log(JSON.stringify({daemonExit:r}));}
 rmSync(scratch,{recursive:true,force:true});
}
