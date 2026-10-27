// Throwaway research probe. No credentials, model calls, or real Codex home access.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const scratch = mkdtempSync(join(tmpdir(), 'squeal install flow '));
const codex = process.env.PROBE_CODEX ?? '/home/agent/.nvm/versions/node/v24.21.0/bin/codex';
// Allowlist environment: no auth/provider/session values copied from this session.
const baseEnv = { PATH: process.env.PATH, HOME: join(scratch, 'home'), SHELL: '/bin/bash', LANG: 'C.UTF-8' };
mkdirSync(baseEnv.HOME);
const results = { version: '' };
const run = (args, env, cwd) => {
  const p = spawnSync(codex, args, { env, cwd, encoding: 'utf8', timeout: 20000 });
  assert.equal(p.status, 0, `${args.join(' ')}: ${p.stderr}`);
  return p.stdout.trim();
};
results.version = run(['--version'], baseEnv, scratch);
function write(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
async function server(env, cwd, fn) {
  const child = spawn(codex, ['app-server'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let next = 1;
  const pending = new Map();
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const msg = JSON.parse(line);
    if (msg.method === undefined && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 15000);
    pending.set(id, msg => { clearTimeout(timer); pending.delete(id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await request('initialize', { clientInfo: { name: 'stable-hook-approval-probe', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return await fn(request);
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    const killer = setTimeout(() => child.kill('SIGKILL'), 1000);
    await new Promise(r => child.once('close', r));
    clearTimeout(killer);
    lines.close();
  }
}
const home = join(scratch,'codex home'), repo=join(scratch,'market'), cwd=join(scratch,'workspace');
for (const p of [home,repo,cwd]) mkdirSync(p,{recursive:true});
const env={...baseEnv,CODEX_HOME:home,XDG_CONFIG_HOME:join(scratch,'xdg')};
const root=join(repo,'plugins/probe'), data=join(home,'plugins/data/probe-install-probe');
write(join(home,'config.toml'),'');
write(join(repo,'.agents/plugins/marketplace.json'),{name:'install-probe',plugins:[
  {name:'probe',source:'./plugins/probe'}, {name:'required-runtime',source:'./plugins/required-runtime'}
]});
write(join(repo,'plugins/required-runtime/.codex-plugin/plugin.json'),{name:'required-runtime',version:'1.0.0'});
// Deliberately unsupported candidate keys. Their acceptance is not support.
write(join(root,'.codex-plugin/plugin.json'),{name:'probe',version:'1.0.0',dependencies:['required-runtime@install-probe'],scripts:{postinstall:'touch "$HOME/install-script-ran"'}});
write(join(root,'package.json'),{name:'probe',version:'1.0.0',dependencies:{'required-runtime':'1.0.0'},scripts:{postinstall:'touch "$HOME/npm-postinstall-ran"'}});
write(join(root,'hooks/hooks.json'),{hooks:{SessionStart:[{hooks:[{type:'command',command:'node "${PLUGIN_ROOT}/bootstrap.mjs"',timeout:2}]}]}});
write(join(root,'seed/runtime.mjs'),'console.log("seed-runtime-A");\n');
write(join(root,'bootstrap.mjs'),`import {mkdirSync,existsSync,copyFileSync,readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const data=process.env.PLUGIN_DATA, root=process.env.PLUGIN_ROOT;
mkdirSync(data,{recursive:true});
const target=join(data,'runtime.mjs'), seed=join(root,'seed/runtime.mjs');
if (!existsSync(target)) {
  if (!existsSync(seed)) {
    console.log(JSON.stringify({continue:false,stopReason:'Squeal runtime is missing; repair installation.',systemMessage:'Squeal validation is unavailable.',hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'Squeal validation has not started.'}}));
    process.exit(0);
  }
  copyFileSync(seed,target);
  appendFileSync(join(data,'copies'),'copy\\n');
}
const run=spawnSync(process.execPath,[target],{encoding:'utf8'});
if(run.status!==0) throw new Error('fixture runtime failed');
console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'Fixture runtime executed: '+run.stdout.trim()}}));
`);
run(['plugin','marketplace','add',repo],env,cwd);
results.installOutput=run(['plugin','add','probe@install-probe'],env,cwd);
const cache=join(home,'plugins/cache/install-probe');
results.afterInstall={plugins:readdirSync(cache),pluginPostinstall:existsSync(join(baseEnv.HOME,'install-script-ran')),npmPostinstall:existsSync(join(baseEnv.HOME,'npm-postinstall-ran')),bootstrapRan:existsSync(join(data,'runtime.mjs'))};
assert.deepEqual(results.afterInstall,{plugins:['probe'],pluginPostinstall:false,npmPostinstall:false,bootstrapRan:false});
const list=()=>server(env,cwd,async req=>(await req('hooks/list',{cwds:[cwd]})).data[0].hooks.filter(h=>h.pluginId==='probe@install-probe'));
const hooks=await list();
assert.equal(hooks.length,1);
assert.equal(hooks[0].trustStatus,'untrusted');
await server(env,cwd,async req=>req('config/batchWrite',{edits:hooks.map(h=>({keyPath:`hooks.state."${h.key}".trusted_hash`,value:h.currentHash,mergeStrategy:'replace'})),reloadUserConfig:true}));
results.approved=(await list()).map(({trustStatus,currentHash})=>({trustStatus,currentHash}));
await server(env,cwd,async req=>{
  const {thread}=await req('thread/start',{cwd});
  await new Promise(r=>setTimeout(r,300));
  results.afterThreadStart={bootstrapRan:existsSync(join(data,'runtime.mjs'))};
  await req('thread/archive',{threadId:thread.id});
});
assert.equal(results.afterThreadStart.bootstrapRan,false);
const installedRoot=join(cache,'probe/1.0.0');
const replay=()=>{
 const p=spawnSync('/bin/bash',['-c',hooks[0].command],{env:{...env,PLUGIN_ROOT:installedRoot,PLUGIN_DATA:data},cwd,input:'{}',encoding:'utf8',timeout:2000});
 assert.equal(p.status,0,p.stderr); return JSON.parse(p.stdout);
};
results.shellReplayFirstUse=replay();
assert(existsSync(join(data,'runtime.mjs')));
results.shellReplaySecondUse=replay();
assert.equal(readFileSync(join(data,'copies'),'utf8'),'copy\n');
write(join(data,'runtime.mjs'),'console.log("external-runtime-B");\n');
results.shellReplayAfterUpdate=replay();
assert(results.shellReplayAfterUpdate.hookSpecificOutput.additionalContext.includes('external-runtime-B'));
results.afterExternalUpdate=(await list()).map(({trustStatus,currentHash})=>({trustStatus,currentHash}));
assert.deepEqual(results.afterExternalUpdate,results.approved);
// Missing seed is only a shell-policy check: editing the installed bundle invalidates real trust.
rmSync(join(data,'runtime.mjs'));
rmSync(join(installedRoot,'seed/runtime.mjs'));
results.shellReplayMissingSeed=replay();
assert.equal(results.shellReplayMissingSeed.continue,false);
assert(results.shellReplayMissingSeed.systemMessage.includes('unavailable'));
console.log(JSON.stringify(results,null,2).replaceAll(scratch,'<SCRATCH>'));
rmSync(scratch,{recursive:true,force:true});
