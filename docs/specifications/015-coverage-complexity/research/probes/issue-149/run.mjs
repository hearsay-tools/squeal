// Throwaway issue-149 research probe. Uses installed dependencies and committed CLI.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
const repo = process.cwd();
const cli = resolve('plugins/claude-code/dist/cli/squeal.mjs');
const destination = resolve(process.argv[2] ?? 'docs/specifications/015-coverage-complexity/research/probes/issue-149/results.json');
const scratch = mkdtempSync(join(tmpdir(), 'sq-issue-149-'));
const sourcePath = '.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/source.ts';
const fixtureDir = sourcePath.slice(0, sourcePath.lastIndexOf('/'));
const output = { utc: new Date().toISOString(), node: process.version, cli, scratch,
  commit: spawnSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).stdout.trim(),
  vitest: JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version, cases: [] };
const pause = ms => new Promise(done => setTimeout(done, ms));
function gate() {
  const info = { utc: new Date().toISOString(), load1: loadavg()[0], cpus: cpus().length };
  if (info.load1 > info.cpus) throw new Error(`Skipped live probe: ${JSON.stringify(info)}`);
  return info;
}
function run(cwd, env, command, args) {
  const r = spawnSync(command, args, { cwd, env, encoding:'utf8', timeout:45000 });
  return { command:[command,...args], exit:r.status, stdout:r.stdout, stderr:r.stderr, error:r.error?.message };
}
for (const name of ['separate-config', 'in-process', 'excluded', 'snapshot-reader']) {
  const load = gate();
  const root = join(scratch, name);
  for (const dir of [fixtureDir, 'test', 'runtime', 'home', 'config']) mkdirSync(join(root, dir), { recursive:true });
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  const env = { PATH:process.env.PATH, HOME:join(root,'home'), XDG_RUNTIME_DIR:join(root,'runtime'), XDG_CONFIG_HOME:join(root,'config') };
  const childArgs = [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', join(root, fixtureDir, 'vitest.config.mjs'), '--root', join(root, fixtureDir), '--maxWorkers', '1'];
  const call = name === 'in-process' ? `assert.equal(single(), 42);` : name === 'snapshot-reader' ?
    `assert.match(readFileSync(${JSON.stringify(sourcePath)}, 'utf8'), /single/);` :
    `const child = spawnSync(process.execPath, ${JSON.stringify(childArgs)}, { encoding:'utf8', timeout:30000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /1 passed/);
  assert.match(child.stdout, /FIXTURE_EXECUTED/);`;
  const files = {
    '.gitignore':'runtime/\nhome/\nconfig/\nnode_modules/\n',
    'package.json': JSON.stringify({ name:`issue-149-${name}`, private:true, type:'module' }),
    'squeal.config.json': JSON.stringify({ baseline:{ onStart:'lookup-then-run-missing' },
      nodeTest:[{ name:'probe', cwd:'.', node:process.execPath, include:['test/*.test.mjs'] }],
      complexity:{ enabled:true, include:[sourcePath] },
      coverage:{ enabled:true, exclude:name === 'excluded' ? [fixtureDir+'/**'] : [] },
      crap:{ enabled:true }, lint:{ enabled:false } }),
    [sourcePath]: 'export const single = (): number => 42;\n',
    [fixtureDir+'/source.test.ts']: `import { test, expect } from 'vitest';
import { single } from './source';
test('executes fixture', () => { expect(single()).toBe(42); console.log('FIXTURE_EXECUTED'); });
`,
    [fixtureDir+'/vitest.config.mjs']: `export default { test: { include:['source.test.ts'], maxWorkers:1 } };\n`,
    'test/parent.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
${name === 'in-process' ? `import { single } from '../${sourcePath}';` : ''}
test('parent proves fixture behavior', () => { ${call} });
`,
  };
  for (const [path,body] of Object.entries(files)) writeFileSync(join(root,path),body);
  const commands=[];
  for (const args of [['init','-q'],['add','.gitignore','package.json','squeal.config.json','.ai','test'],['-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture']]) {
    const r=run(root,env,'git',args); if(r.exit!==0) throw new Error(JSON.stringify(r));
  }
  commands.push(run(root,env,process.execPath,[cli,'--version']));
  const launchLoad=gate();
  const daemon=spawn(process.execPath,[cli,'daemon',root],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let daemonLog=''; daemon.stdout.on('data',b=>daemonLog+=b); daemon.stderr.on('data',b=>daemonLog+=b);
  try {
    await pause(1500);
    commands.push(run(root,env,process.execPath,[cli,'status','--wait','30000','test/parent.test.mjs']));
    let code;
    for(let i=0;i<25;i++) {
      code=run(root,env,process.execPath,[cli,'code',sourcePath]);
      if(code.stdout.includes('single') && (/CRAP [0-9]/.test(code.stdout)||code.stdout.includes('coverage not checked')) && !code.stdout.includes('pending')) break;
      await pause(1000);
    }
    commands.push(code);
    commands.push(run(root,env,process.execPath,[cli,'code',sourcePath,'--json']));
    commands.push(run(root,env,process.execPath,[cli,'code']));
  } finally {
    const ended=once(daemon,'exit'); daemon.kill('SIGTERM');
    await Promise.race([ended,pause(5000)]);
    if(daemon.exitCode===null&&daemon.signalCode===null) { daemon.kill('SIGKILL'); await ended; }
  }
  output.cases.push({name,load,launchLoad,files,commands,daemonLog,daemonExit:daemon.exitCode,daemonSignal:daemon.signalCode});
  writeFileSync(destination,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({name,load,commands:commands.map(c=>({command:c.command.slice(1),exit:c.exit,stdout:c.stdout}))}));
}
console.log(`Scratch retained: ${scratch}`);
