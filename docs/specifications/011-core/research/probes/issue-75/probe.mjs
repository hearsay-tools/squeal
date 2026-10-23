// Throwaway issue-75 probe. Uses committed release bundles; no build or dependency install.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const base = import.meta.dirname;
const source = process.cwd();
const mode = process.argv[2] ?? 'natural';
// Row 011-133: three versions in one worktree, on the 0.1.271 to 0.1.273 bundles (three-versions.mjs).
if (mode === 'mislabeled' || mode === 'control') { await import('./three-versions.mjs'); process.exit(0); }
const load = loadavg()[0];
console.log(JSON.stringify({ event: 'host', at: new Date().toISOString(), load, cpus: cpus().length, node: process.version, mode }));
if (load > cpus().length) { console.log('NOT REPRODUCED: one-minute load exceeds CPU count'); process.exit(0); }
const scratch = join(base, '.scratch', randomUUID());
const root = join(scratch, 'repo');
mkdirSync(root, {recursive:true});
const env = { PATH: process.env.PATH, XDG_RUNTIME_DIR: join(scratch, 'runtime'), XDG_CONFIG_HOME: join(scratch, 'config'), TMPDIR: join(scratch, 'tmp') };
for (const dir of [env.XDG_RUNTIME_DIR, env.XDG_CONFIG_HOME, env.TMPDIR]) mkdirSync(dir,{recursive:true,mode:0o700});
const log = (data) => console.log(JSON.stringify({at:new Date().toISOString(), ...data}));
function command(bin, args, options = {}) {
  const r = spawnSync(bin,args,{cwd:root,env,encoding:'utf8',...options});
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const bundles = {};
for (const version of ['0.1.260','0.1.261']) {
  const dest = join(scratch, version); mkdirSync(dest);
  const archive = spawnSync('git',['archive',`squeal--v${version}`,'plugins/codex/dist'],{cwd:source,maxBuffer:64*1024*1024});
  if (archive.status !== 0) throw Error(archive.stderr.toString());
  command('tar',['-x','-C',dest],{input:archive.stdout});
  bundles[version] = join(dest,'plugins/codex/dist');
  log({event:'release',version,commit:command('git',['rev-parse',`squeal--v${version}^{commit}`],{cwd:source}).trim()});
}
writeFileSync(join(root,'squeal.config.json'),JSON.stringify({baseline:{onStart:'lookup-only'},nodeTest:[{name:'node',include:['test/**/*.test.mjs']}],observe:{runtimeInputs:false}}));
writeFileSync(join(root,'package.json'),'{"type":"module"}\n');
writeFileSync(join(root,'README.md'),'Read-only fixture.\n');
command('git',['init','-q']); command('git',['add','.']);
command('git',['-c','user.name=Issue 75 probe','-c','user.email=probe@example.invalid','commit','-qm','fixture']);
const cli = (version) => join(bundles[version],'cli/squeal.mjs');
const dbfile = join(root,'.git/squeal/store.sqlite');
function snapshot(label) {
  if (!existsSync(dbfile)) return null;
  let db;
  try {
    db = new DatabaseSync(dbfile,{readOnly:true});
    db.exec('PRAGMA busy_timeout=200');
    const worktree = db.prepare('SELECT * FROM worktrees').get();
    const meta = db.prepare("SELECT key,value FROM meta WHERE key LIKE '%handoff%' OR key LIKE '%Handoff%' OR key LIKE '%liveness%' OR key LIKE '%exit%' OR key LIKE '%notes%'").all();
    const revision = db.prepare('SELECT MAX(number) AS revision FROM revisions').get();
    const data = {event:'snapshot',label,worktree,meta,revision}; log(data); return data;
  } catch(e) { log({event:'snapshot-error',label,error:String(e)}); return null; }
  finally { db?.close(); }
}
const wait = (ms) => new Promise(r=>setTimeout(r,ms));
const session = randomUUID();
async function hook(version,name,iteration) {
  const start=Date.now();
  const payload={session_id:session,transcript_path:join(scratch,`rollout-${session}.jsonl`),cwd:root,hook_event_name:name==='session-start'?'SessionStart':'PostToolUse',source:'startup',tool_name:'Bash',tool_input:{command:'cat README.md'},tool_response:'Read-only fixture.',tool_use_id:randomUUID()};
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',join(bundles[version],`${name}.mjs`)],{cwd:root,env,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.stdin.end(JSON.stringify(payload));
  const timer=setTimeout(()=>child.kill('SIGKILL'),2500);
  await new Promise(r=>child.on('close',(code,signal)=>{clearTimeout(timer);log({event:'hook',version,name,iteration,ms:Date.now()-start,code,signal,stdout,stderr});r();}));
}
const daemon=spawn(process.execPath,['--disable-warning=ExperimentalWarning',cli('0.1.260'),'daemon',root],{cwd:root,env,stdio:['ignore','pipe','pipe']});
daemon.stdout.on('data',d=>log({event:'daemon-stdout',text:d.toString()}));
let held = false;
daemon.stderr.on('data',d=>{
  log({event:'daemon-stderr',text:d.toString()});
  if (mode.startsWith('blocked') && !held && d.toString().includes('daemon stopped: hooks')) {
    held = true;
    setTimeout(() => { try { process.kill(daemon.pid,'SIGSTOP'); log({event:'hold',pid:daemon.pid}); } catch(e) { log({event:'hold-missed',error:String(e)}); } }, mode === 'blocked-delay' ? 10 : 0);
  }
});
log({event:'start',pid:daemon.pid,root});
try {
  for(let i=0;i<100;i++) { if(existsSync(dbfile)) {const s=snapshot('startup');if(s?.worktree?.daemon_socket)break;} await wait(50); }
  await hook('0.1.260','session-start',-1);
  if(mode==='settled') await wait(1500);
  snapshot('before-upgrade');
  for(let round=0;round<20;round++) {
    await Promise.all(Array.from({length:4},(_,i)=>hook(mode==='mixed' && i%2===0?'0.1.260':'0.1.261','post-tool-use',round*4+i)));
    snapshot(`round-${round}`);
    if (mode.startsWith('blocked') && round === 0) await wait(11000);
    await wait(100);
  }
  if (mode.startsWith('blocked')) {
    try { process.kill(daemon.pid,'SIGCONT'); log({event:'release',pid:daemon.pid}); } catch(e) { log({event:'release-missed',error:String(e)}); }
    await wait(1000);
    for(let i=0;i<4;i++) await hook('0.1.261','post-tool-use',80+i);
    snapshot('after-release');
  }
  log({event:'clean-tree',output:command('git',['status','--porcelain'])});
} finally {
  // Stop only daemons whose argv contains this unique fixture root.
  const owned=[];
  for(const entry of readdirSync('/proc')) {
    if(!/^\d+$/.test(entry))continue;
    try {const args=readFileSync(`/proc/${entry}/cmdline`,'utf8').split('\0');if(args.includes('daemon')&&args.includes(root))owned.push(Number(entry));}catch{}
  }
  for(const pid of owned) {try{process.kill(pid,'SIGCONT');process.kill(pid,'SIGTERM');}catch{}}
  await wait(2000);
  const remaining=owned.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
  for(const pid of remaining){try{process.kill(pid,'SIGKILL');}catch{}}
  log({event:'cleanup',owned,forced:remaining});
}
