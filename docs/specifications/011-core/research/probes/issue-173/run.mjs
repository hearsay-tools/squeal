// Throwaway issue-173 research probe. Never a product test.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, readdirSync, openSync, closeSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
const repo = process.cwd();
const base = resolve(import.meta.dirname, '.scratch', String(Date.now()));
mkdirSync(base, {recursive:true});
const cli = '/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs';
const evidence = { timestamp: new Date().toISOString(), node:process.version, cli, cases:[] };
const pause = ms => new Promise(r=>setTimeout(r,ms));
function call(cwd, env, args) {
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning',cli,...args], {cwd,env,encoding:'utf8',timeout:15000});
 return {args, exit:r.status, stdout:r.stdout, stderr:r.stderr, error:r.error?.message};
}
for (const mode of ['attached','discarded']) {
 const root = join(base, mode); mkdirSync(root);
 const runtime = mkdtempSync('/tmp/i173-');
 const env = {...process.env, XDG_RUNTIME_DIR:runtime, XDG_CONFIG_HOME:join(runtime,'config')};
 for(const key of Object.keys(env)) if(/^(VITEST|GIT_|CEZ_|SQUEAL_)/.test(key) || ['NODE_OPTIONS','NODE_PATH','CODEX_SESSION_ID','PI_SESSION_ID','OPENCODE_SESSION_ID'].includes(key)) delete env[key];
 const files = {
 '.gitignore':'node_modules/\n',
 'package.json':JSON.stringify({name:'issue-173-'+mode,type:'module',private:true}),
 'squeal.config.json':JSON.stringify({baseline:{onStart:'lookup-then-run-missing'},coverage:{enabled:false},complexity:{enabled:false}}),
 'vitest.config.mjs':`export default { test: { name: 'tiny', include: ['tiny.test.js'], globalSetup: ['./setup.js'], maxWorkers: 1 } };\n`,
 'tiny.test.js':`import { test, expect } from 'vitest'; test('never runs', () => expect(1).toBe(1));\n`,
 'child.cjs':`process.stdout.write('CHILD_STDOUT_173\\n'); process.stderr.write('CHILD_STDERR_173\\n'); process.exit(1);\n`,
 'setup.js':`import { spawnSync } from 'node:child_process';\nexport default function setup() {\n console.log('SETUP_CONSOLE_173');\n const child = spawnSync(process.execPath, ['child.cjs'], {encoding:'utf8',stdio:'pipe'});\n const cause = Object.assign(new Error('Command failed: node child.cjs'), {code:child.status${mode==='attached'?', stdout:child.stdout, stderr:child.stderr':''}});\n throw new Error('Fixture bootstrap failed', {cause});\n}\n`
 };
 for(const [name,text] of Object.entries(files)) writeFileSync(join(root,name),text);
 symlinkSync(join(repo,'node_modules'),join(root,'node_modules'),'dir');
 for(const args of [['init','-q'],['add','.'],['-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture']]) {
  const r=spawnSync('git',args,{cwd:root,env,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);
 }
 const gate={at:new Date().toISOString(),load:loadavg()[0],cpus:cpus().length};
 if(gate.load>gate.cpus){evidence.cases.push({mode,gate,skipped:true});rmSync(runtime,{recursive:true});continue;}
 const fd=openSync(join(base,mode+'-daemon.log'),'w');
 const daemon=spawn(process.execPath,['--disable-warning=ExperimentalWarning',cli,'daemon',root],{cwd:root,env,stdio:['ignore',fd,fd]});
 closeSync(fd);
 const entry={mode,gate,root,version:call(root,env,['--version'])};
 try {
  const end=Date.now()+60000;
  do {
   const r=call(root,env,['status','--json']);
   let s;try{s=JSON.parse(r.stdout)}catch{}
   if(s?.knownFailures?.some(f=>f.check.kind==='setup')){entry.status=r;break;}
   await pause(1000);
  } while(Date.now()<end);
  entry.why=call(root,env,['why','setup.js','--include-logs']);
  entry.whyJson=call(root,env,['why','setup.js','--include-logs','--json']);
 } finally {
  daemon.kill('SIGTERM');
  await Promise.race([new Promise(r=>daemon.once('exit',r)),pause(8000)]);
  if(daemon.exitCode===null && daemon.signalCode===null) daemon.kill('SIGKILL');
  entry.daemonExit={code:daemon.exitCode,signal:daemon.signalCode};
  entry.daemonLog=readFileSync(join(base,mode+'-daemon.log'),'utf8');
  rmSync(runtime,{recursive:true,force:true});
 }
 const db=new DatabaseSync(join(root,'.git/squeal/store.sqlite'),{readOnly:true});
 entry.counts={results:db.prepare('select count(*) as n from results').get().n,runs:db.prepare('select count(*) as n from runs').get().n};
 entry.runs=db.prepare('select * from runs').all();db.close();
 entry.logs=[];
 function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const p=join(dir,item.name);if(item.isDirectory())walk(p);else if(/\.(json|log)$/.test(p))entry.logs.push({path:p,text:readFileSync(p,'utf8')});}}
 walk(join(root,'.git/squeal/runs'));
 evidence.cases.push(entry);
 console.log(JSON.stringify({mode,gate,counts:entry.counts,why:entry.why.stdout,daemonExit:entry.daemonExit}));
}
writeFileSync(join(base,'evidence.json'),JSON.stringify(evidence,null,2));
console.log('Evidence: '+join(base,'evidence.json'));
