// Throwaway research probe. No credentials, model calls, or real Codex home access.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const scratch = mkdtempSync(join(tmpdir(), 'squeal approval '));
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
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
function declarationHash(event, group, h) {
  const labels = { SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', Stop: 'stop', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop', Interrupt: 'interrupt', SessionEnd: 'session_end' };
  const identity = { event_name: labels[event], hooks: [{ type: 'command', command: h.command, timeout: h.timeout, async: false }] };
  if (group.matcher !== undefined) identity.matcher = group.matcher;
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canonical(identity))).digest('hex');
}
for (const form of ['braced', 'shell']) {
  const dir = join(scratch, form), home = join(dir, 'codex home'), repo = join(dir, 'market'), cwd = join(dir, 'workspace');
  for (const path of [home, repo, cwd]) mkdirSync(path, { recursive: true });
  const env = { ...baseEnv, CODEX_HOME: home, XDG_CONFIG_HOME: join(dir, 'xdg') };
  write(join(home, 'config.toml'), '');
  write(join(cwd, 'squeal.config.json'), '{}'); // enables the real per-tool fast paths
  const root = join(repo, 'plugins', 'probe');
  write(join(repo, '.agents/plugins/marketplace.json'), { name: 'approval-probe', plugins: [{ name: 'probe', source: './plugins/probe' }] });
  const hooks = structuredClone(source);
  if (form === 'shell') for (const groups of Object.values(hooks.hooks)) for (const g of groups) for (const h of g.hooks) h.command = h.command.replaceAll('${PLUGIN_ROOT}', '$PLUGIN_ROOT');
  write(join(root, 'hooks/hooks.json'), hooks);
  for (const groups of Object.values(hooks.hooks)) for (const g of groups) for (const h of g.hooks) {
    const file = h.command.match(/dist\/([^" ]+\.mjs)/)[1];
    write(join(root, 'dist', file), 'import {readFileSync} from "node:fs";\nconst manifest=JSON.parse(readFileSync(new URL("../.codex-plugin/plugin.json",import.meta.url)));\nconsole.log(JSON.stringify({file:import.meta.url,version:manifest.version,root:process.env.PLUGIN_ROOT??null}));\n');
  }
  const manifest = version => write(join(root, '.codex-plugin/plugin.json'), { name: 'probe', version, description: 'Harmless hook approval probe' });
  manifest('1.0.0');
  run(['plugin', 'marketplace', 'add', repo], env, cwd);
  run(['plugin', 'add', 'probe@approval-probe'], env, cwd);
  const list = () => server(env, cwd, async req => (await req('hooks/list', { cwds: [cwd] })).data[0].hooks.filter(h => h.pluginId === 'probe@approval-probe'));
  const trust = () => server(env, cwd, async req => {
    const hs = (await req('hooks/list', { cwds: [cwd] })).data[0].hooks.filter(h => h.pluginId === 'probe@approval-probe');
    await req('config/batchWrite', { edits: hs.map(h => ({ keyPath: `hooks.state."${h.key}".trusted_hash`, value: h.currentHash, mergeStrategy: 'replace' })), reloadUserConfig: true });
  });
  const summarize = hs => hs.map(h => ({ key: h.key, command: h.command, currentHash: h.currentHash, trustStatus: h.trustStatus, sourcePath: h.sourcePath }));
  const scenario = { form, installed: summarize(await list()) };
  assert.equal(scenario.installed.length, 10);
  await trust();
  scenario.approved = summarize(await list());
  assert(scenario.approved.every(h => h.trustStatus === 'trusted'));
  manifest('1.0.1');
  run(['plugin', 'add', 'probe@approval-probe'], env, cwd);
  scenario.upgraded = summarize(await list());
  for (const old of scenario.approved) {
    const now = scenario.upgraded.find(h => h.key === old.key);
    assert(now);
    assert.equal(now.currentHash.split('/')[0], old.currentHash.split('/')[0]);
    assert.notEqual(now.currentHash.split('/')[1], old.currentHash.split('/')[1]);
    assert.equal(now.trustStatus, 'modified');
  }
  scenario.savedTrust = readFileSync(join(home, 'config.toml'), 'utf8').split('\n').filter(line => /trusted_(content_)?hash/.test(line));
  const installedRoot = join(home, 'plugins/cache/approval-probe/probe/1.0.1');
  assert(existsSync(installedRoot));
  scenario.oldVersionRemoved = !existsSync(join(home, 'plugins/cache/approval-probe/probe/1.0.0'));
  assert(scenario.oldVersionRemoved);
  scenario.execution = [];
  // Execute exactly the commands Codex lists, with its documented plugin environment.
  // This is shell execution evidence, not evidence that Codex runs modified hooks.
  for (const h of scenario.upgraded) {
    const p = spawnSync('/bin/bash', ['-c', h.command], { env: { ...env, PLUGIN_ROOT: installedRoot }, cwd, encoding: 'utf8', timeout: 5000 });
    assert.equal(p.status, 0, p.stderr);
    const record = JSON.parse(p.stdout);
    assert.equal(record.version, '1.0.1');
    assert(record.file.includes('/1.0.1/'));
    scenario.execution.push({ key: h.key, ...record });
  }
  scenario.rawHashMatches = [];
  for (const [event, groups] of Object.entries(hooks.hooks)) for (const g of groups) for (const h of g.hooks) {
    const hash = declarationHash(event, g, h);
    scenario.rawHashMatches.push({ event, hash, matches: scenario.upgraded.some(listed => listed.currentHash.split('/')[0] === hash) });
  }
  assert(scenario.rawHashMatches.every(h => h.matches));
  scenario.listedCommandHashMatches = [];
  for (const [event, groups] of Object.entries(hooks.hooks)) for (const g of groups) for (const h of g.hooks) {
    const raw = declarationHash(event, g, h);
    const listed = scenario.upgraded.find(entry => entry.currentHash.split('/')[0] === raw);
    scenario.listedCommandHashMatches.push({ event, matches: declarationHash(event, g, { ...h, command: listed.command }) === raw });
  }
  assert(scenario.listedCommandHashMatches.every(h => h.matches === (form === 'shell')));
  await trust();
  scenario.upgradeApproved = summarize(await list());
  assert.equal(scenario.upgradeApproved.length, 10);
  assert(scenario.upgradeApproved.every(h => h.trustStatus === 'trusted'));
  hooks.hooks.PostToolUse[0].hooks[0].command += ' # definition changed';
  write(join(installedRoot, 'hooks/hooks.json'), hooks);
  scenario.changedDefinition = summarize(await list());
  assert(scenario.changedDefinition.every(h => h.trustStatus === 'modified'));
  scenario.changedDeclarations = scenario.changedDefinition.filter(h => h.currentHash.split('/')[0] !== scenario.upgradeApproved.find(old => old.key === h.key).currentHash.split('/')[0]).map(h => h.key);
  assert.equal(scenario.changedDeclarations.length, 1);
  assert(scenario.changedDeclarations[0].includes(':post_tool_use:'));
  results.scenarios.push(scenario);
  console.error(`${form}: installed=${scenario.installed.length}, approved=${scenario.approved.filter(h => h.trustStatus === 'trusted').length}, upgrade trusted=${scenario.upgraded.filter(h => h.trustStatus === 'trusted').length}, executed=${scenario.execution.length}, changed modified=${scenario.changedDefinition.filter(h => h.trustStatus === 'modified').length}`);
}
console.log(JSON.stringify(results, null, 2).replaceAll(scratch, '<SCRATCH>'));
rmSync(scratch, { recursive: true, force: true });
