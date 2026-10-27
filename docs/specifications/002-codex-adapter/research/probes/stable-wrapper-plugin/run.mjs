// Throwaway research probe. No credentials, model calls, or real Codex home access.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const scratch = mkdtempSync(join(tmpdir(), 'squeal wrapper '));
const codex = process.env.PROBE_CODEX ?? '/home/agent/.nvm/versions/node/v24.21.0/bin/codex';
// Allowlist environment: no auth/provider/session values copied from this session.
const baseEnv = { PATH: process.env.PATH, HOME: join(scratch, 'home'), SHELL: '/bin/bash', LANG: 'C.UTF-8' };
mkdirSync(baseEnv.HOME);
const source = JSON.parse(readFileSync(new URL('../../../../../../plugins/codex/hooks/hooks.json', import.meta.url), 'utf8'));
const results = { version: '', scenarios: [] };
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
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function tree(path, prefix = '') {
  return readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(e => {
    const relative = prefix + e.name, full = join(path, e.name);
    return e.isDirectory() ? tree(full, relative + '/') : [{ path: relative, sha256: digest(full) }];
  });
}
const wrapper = `#!/bin/sh
runtime=$(cat "$PLUGIN_DATA/runtime/current.txt" 2>/dev/null) || exit 0
[ -f "$PLUGIN_DATA/runtime/versions/$runtime/runtime.mjs" ] || exit 0
exec node "$PLUGIN_DATA/runtime/versions/$runtime/runtime.mjs" "$@"
`;
const summary = hs => hs.map(({key, currentHash, trustStatus, command, sourcePath}) => ({key, currentHash, trustStatus, command, sourcePath}));
for (const mode of ['fixed-plugin', 'changing-plugin']) {
  const dir = join(scratch, mode), home = join(dir, 'codex home'), repo = join(dir, 'market'), cwd = join(dir, 'workspace');
  for (const path of [home, repo, cwd]) mkdirSync(path, { recursive: true });
  const env = { ...baseEnv, CODEX_HOME: home, XDG_CONFIG_HOME: join(dir, 'xdg') };
  write(join(home, 'config.toml'), '');
  const root = join(repo, 'plugins/probe');
  const data = join(home, 'plugins/data/probe-wrapper-probe');
  write(join(repo, '.agents/plugins/marketplace.json'), {name:'wrapper-probe',plugins:[{name:'probe',source:'./plugins/probe'}]});
  const hooks = structuredClone(source);
  let index = 0;
  for (const [event, groups] of Object.entries(hooks.hooks)) for (const group of groups) for (const h of group.hooks) {
    h.command = `sh "\${PLUGIN_ROOT}/wrapper.sh" ${event} ${index++}`;
  }
  write(join(root, 'hooks/hooks.json'), hooks);
  write(join(root, 'wrapper.sh'), wrapper);
  const manifest = version => write(join(root, '.codex-plugin/plugin.json'), {name:'probe',version,description:'Fixed wrapper probe; harmless external runtime'});
  manifest('1.0.0');
  run(['plugin','marketplace','add',repo],env,cwd);
  run(['plugin','add','probe@wrapper-probe'],env,cwd);
  let installedRoot = join(home, 'plugins/cache/wrapper-probe/probe/1.0.0');
  const listWith = async req => summary((await req('hooks/list',{cwds:[cwd]})).data[0].hooks.filter(h=>h.pluginId==='probe@wrapper-probe'));
  const list = () => server(env,cwd,listWith);
  const installRuntime = version => {
    write(join(data, 'runtime/versions', version, 'runtime.mjs'), `import {readFileSync,appendFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8') || '{}');
const record={version:${JSON.stringify(version)},event:process.argv[2],handler:process.argv[3],inputEvent:input.hook_event_name??null,session:input.session_id??null,root:process.env.PLUGIN_ROOT??null,data:process.env.PLUGIN_DATA??null,file:import.meta.url};
appendFileSync(process.env.PLUGIN_DATA+'/executions.jsonl',JSON.stringify(record)+'\\n');
console.log('{}');
`);
    write(join(data, 'runtime/current.next'), version);
    renameSync(join(data, 'runtime/current.next'), join(data, 'runtime/current.txt'));
  };
  const executions = () => existsSync(join(data,'executions.jsonl')) ? readFileSync(join(data,'executions.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const boundary = () => server(env,cwd,async req => {
    const before = executions().length;
    const first = await req('thread/start',{cwd,experimentalRawEvents:false,persistExtendedHistory:false});
    const threadId=first.thread.id;
    await req('thread/archive',{threadId});
    await new Promise(r=>setTimeout(r,500));
    return {method:'thread/start then thread/archive; no turn/start',threadId,records:executions().slice(before)};
  });
  installRuntime('A');
  const scenario = {mode, initial:await list(), initialTree:tree(installedRoot)};
  assert.equal(scenario.initial.length,10);
  assert(scenario.initial.every(h=>h.trustStatus==='untrusted'));
  scenario.untrustedBoundary=await boundary();
  assert.equal(scenario.untrustedBoundary.records.length,0);
  await server(env,cwd,async req => {
    await req('config/batchWrite',{edits:scenario.initial.map(h=>({keyPath:`hooks.state."${h.key}".trusted_hash`,value:h.currentHash,mergeStrategy:'replace'})),reloadUserConfig:true});
  });
  scenario.approved = await list();
  assert(scenario.approved.every(h=>h.trustStatus==='trusted'));
  scenario.boundaryA = await boundary();
  assert.equal(scenario.boundaryA.records.length, 1);
  assert.equal(scenario.boundaryA.records[0].version, 'A');
  const trustBefore = digest(join(home,'config.toml'));
  const replay = hs => hs.map(h => {
    const before = executions().length;
    const p=spawnSync('/bin/bash',['-c',h.command],{env:{...env,PLUGIN_ROOT:installedRoot,PLUGIN_DATA:data},cwd,encoding:'utf8',input:'{"hook_event_name":"shell-replay"}',timeout:5000});
    assert.equal(p.status,0,p.stderr);
    return {key:h.key,status:p.status,stdout:p.stdout.trim(),records:executions().slice(before)};
  });
  scenario.replayA = replay(scenario.approved);
  assert(scenario.replayA.every(x=>x.records.length===1&&x.records[0].version==='A'));
  // This first update changes no byte within the hook-owning plugin.
  installRuntime('B');
  scenario.afterRuntimeOnly = await list();
  scenario.afterRuntimeTree = tree(installedRoot);
  assert.deepEqual(scenario.afterRuntimeTree,scenario.initialTree);
  assert.deepEqual(scenario.afterRuntimeOnly,scenario.approved);
  scenario.replayB = replay(scenario.afterRuntimeOnly);
  assert(scenario.replayB.every(x=>x.records.length===1&&x.records[0].version==='B'));
  scenario.trustUnchangedAfterRuntime = digest(join(home,'config.toml'))===trustBefore;
  assert(scenario.trustUnchangedAfterRuntime);
  scenario.boundaryB = await boundary();
  assert.equal(scenario.boundaryB.records.length, 1);
  assert.equal(scenario.boundaryB.records[0].version, 'B');
  // A process already open across an external update keeps the same approved declarations.
  scenario.liveServer = await server(env,cwd,async req => {
    const before=await listWith(req);
    const first = await req('thread/start',{cwd});
    const count = executions().length;
    installRuntime('C');
    await req('thread/archive',{threadId:first.thread.id});
    await new Promise(r=>setTimeout(r,500));
    const records=executions().slice(count);
    assert.equal(records.length,1);
    assert.equal(records[0].version,'C');
    assert.equal(records[0].session,first.thread.id);
    const after=await listWith(req);
    assert.deepEqual(after,before);
    return {before,after,threadStartedOn:'B',threadId:first.thread.id,records,replay:replay(after)};
  });
  assert(scenario.liveServer.replay.every(x=>x.records[0].version==='C'));
  if(mode==='changing-plugin') {
    manifest('1.0.1');
    run(['plugin','add','probe@wrapper-probe'],env,cwd);
    const previousRoot=installedRoot;
    installedRoot=join(home,'plugins/cache/wrapper-probe/probe/1.0.1');
    scenario.oldRootRemoved=!existsSync(previousRoot);
    assert(scenario.oldRootRemoved);
    assert.equal(readFileSync(join(installedRoot,'wrapper.sh'),'utf8'),wrapper);
    scenario.afterPluginUpdate=await list();
    assert(scenario.afterPluginUpdate.every(h=>h.trustStatus==='modified'));
    assert(scenario.afterPluginUpdate.every(h=>h.currentHash.split('/')[0]===scenario.approved.find(old=>old.key===h.key).currentHash.split('/')[0]));
    scenario.wrapperUnchanged=true;
    scenario.modifiedBoundary=await boundary();
    assert.equal(scenario.modifiedBoundary.records.length,0);
  }
  // Missing runtime: approval stays as it was; the deliberate guard returns silence.
  const statusBeforeMissing=await list();
  rmSync(join(data,'runtime/current.txt'));
  scenario.missingRuntime={hooks:await list(),replay:replay(statusBeforeMissing)};
  assert.deepEqual(scenario.missingRuntime.hooks,statusBeforeMissing);
  assert(scenario.missingRuntime.replay.every(x=>x.records.length===0&&x.stdout===''));
  scenario.missingRuntime.boundary=await boundary();
  assert.equal(scenario.missingRuntime.boundary.records.length,0);
  scenario.trustUnchangedBeforeWrapperEdit=digest(join(home,'config.toml'))===trustBefore;
  assert(scenario.trustUnchangedBeforeWrapperEdit);
  if(mode==='fixed-plugin') {
    write(join(installedRoot,'wrapper.sh'),wrapper+'# wrapper changed\n');
    scenario.changedWrapper=await list();
    assert(scenario.changedWrapper.every(h=>h.trustStatus==='modified'));
    assert(scenario.changedWrapper.every(h=>h.currentHash.split('/')[0]===scenario.approved.find(old=>old.key===h.key).currentHash.split('/')[0]));
  }
  if(mode==='fixed-plugin') {
    installRuntime('C');
    scenario.modifiedBoundary=await boundary();
    assert.equal(scenario.modifiedBoundary.records.length,0);
  }
  scenario.finalTrustUnchanged=digest(join(home,'config.toml'))===trustBefore;
  assert(scenario.finalTrustUnchanged);
  results.scenarios.push(scenario);
  console.error(`${mode}: runtime-only trusted=10/10; shell A/B/C=10/10; boundary records=${scenario.boundaryB.records.length}; missing runtime silent=10/10; ${mode==='fixed-plugin'?'wrapper edit':'plugin update'} modified=10/10`);
}
console.log(JSON.stringify(results,null,2).replaceAll(new URL('file://' + scratch).href,'<SCRATCH_URL>').replaceAll(scratch,'<SCRATCH>'));
rmSync(scratch,{recursive:true,force:true});
