#!/usr/bin/env python3
"""Throwaway issue-168 probe. Uses only a private temporary Git repository."""
import json, os, pathlib, shlex, subprocess, tempfile, time
REPO = pathlib.Path(__file__).resolve().parents[6]
RUNTIME = pathlib.Path('/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.422')
NODE = '/home/agent/.nvm/versions/node/v24.22.1/bin/node'
slow_lint = os.environ.get('ISSUE168_SLOW_LINT') == '1'
load = os.getloadavg()[0]
cpus = int(subprocess.check_output(['nproc'], text=True))
print(json.dumps({'load1': load, 'cpus': cpus, 'utc': time.strftime('%FT%TZ', time.gmtime())}), flush=True)
if load > cpus:
    raise SystemExit('SKIP: load above CPU count')
base = pathlib.Path(tempfile.mkdtemp(prefix='sq168-'))
root = base/'repo'; root.mkdir()
env = os.environ.copy()
for k in ['CLAUDE_SESSION_ID', 'CODEX_THREAD_ID', 'SQUEAL_SESSION_ID', 'SQUEAL_AGENT_ID']:
    env.pop(k, None)
for k, p in [('XDG_RUNTIME_DIR', base/'runtime'), ('XDG_CONFIG_HOME', base/'config')]:
    p.mkdir(mode=0o700); env[k] = str(p)
env['SQUEAL_CLI'] = str(RUNTIME/'dist/cli/squeal.mjs')
print('PRIVATE_ROOT', root, flush=True)
def run(args, stdin=None, cwd=root, timeout=25):
    print('$', shlex.join([str(x) for x in args]), flush=True)
    p = subprocess.run(args, cwd=cwd, env=env, input=stdin, text=True, capture_output=True, timeout=timeout)
    print(p.stdout, end='', flush=True)
    if p.stderr: print('STDERR:', p.stderr, end='', flush=True)
    print('EXIT', p.returncode, flush=True)
    return p

def git(*args): return run(['git', *args])
def cli(*args): return run([NODE, '--disable-warning=ExperimentalWarning', str(RUNTIME/'dist/cli/squeal.mjs'), *args])
def hook(name, event, **kw):
    payload = dict(session_id='issue-168-probe', cwd=str(root), hook_event_name=event, **kw)
    print('INPUT', json.dumps(payload), flush=True)
    return run([NODE, '--disable-warning=ExperimentalWarning', str(base/(name+'.mjs'))], json.dumps(payload))
# Use Claude Code hook bytes from the same release as the installed CLI.
for name in ['session-start','user-prompt-submit','post-tool-batch','stop','session-end']:
    data = subprocess.check_output(['git','show',f'squeal--v0.1.422:plugins/claude-code/dist/{name}.mjs'], cwd=REPO)
    (base/(name+'.mjs')).write_bytes(data)
git('init','-b','main'); git('config','user.name','Probe'); git('config','user.email','probe@example.invalid')
(root/'src').mkdir(); (root/'test').mkdir(); (root/'node_modules').mkdir()
# Only ESLint is linked; node:test uses Node itself. No dependency install.
(root/'node_modules/eslint').symlink_to((REPO/'node_modules/eslint').resolve(), target_is_directory=True)
(root/'.gitignore').write_text('node_modules/\n')
(root/'package.json').write_text(json.dumps({'name':'issue-168-probe','type':'module','private':True}))
(root/'eslint.config.js').write_text(
    "export default [{files:['src/**/*.js'], rules:{'no-unused-vars':'error'}}];\n" if not slow_lint else
    "export default [{files:['src/**/*.js'], plugins:{probe:{rules:{wait:{create(c){return {Program(){if(c.sourceCode.text.includes('x === 6')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);}}}}}}}, rules:{'no-unused-vars':'error','probe/wait':'error'}}];\n")
(root/'squeal.config.json').write_text(json.dumps({'nodeTest':[{'name':'node','include':['test/*.test.js']}], 'baseline':{'onStart':'lookup-then-run-missing'},'lint':{'enabled':True,'tools':['eslint'],'include':['src/**/*.js']},'complexity':{'include':['src/**/*.js']},'coverage':{'enabled':True,'exclude':['test/**']},'checks':[{'name':'lint','lint':True,'at':'stop'}]}))
(root/'src/a.js').write_text('export function cold(x) { return x; }\n')
(root/'test/a.test.js').write_text("import {test} from 'node:test';\nimport {cold} from '../src/a.js';\ntest('loads source without calling cold', () => {});\n")
git('add','.'); git('commit','-m','base A')
a=git('rev-parse','HEAD').stdout.strip()
(root/'src/a.js').write_text('export function cold(x) {\n'+''.join(f'  if (x === {i}) return {i};\n' for i in range(7))+'  return -1;\n}\n')
git('add','src/a.js'); git('commit','-m','upstream B increases uncovered complexity')
git('update-ref','refs/remotes/origin/main','HEAD'); git('checkout','-b','worker',a)
try:
    cli('start')
    time.sleep(3)
    cli('status','--wait','15000')
    cli('run','lint','--wait','15000')
    cli('code','src/a.js','--json')
    hook('session-start','SessionStart',source='startup')
    hook('user-prompt-submit','UserPromptSubmit')
    hook('post-tool-batch','PostToolBatch',tool_name='Bash')
    print('CONTROL STOP BEFORE MERGE', flush=True)
    hook('stop','Stop')
    hook('user-prompt-submit','UserPromptSubmit')
    git('status','--porcelain')
    print('ONLY SESSION MUTATION: CLEAN FAST-FORWARD', flush=True)
    git('merge','--ff-only','origin/main')
    git('status','--porcelain')
    time.sleep(0.4 if slow_lint else 2)
    if not slow_lint: cli('status','--wait','15000')
    cli('lint','src/a.js','--json')
    print('STOP AFTER MERGE', flush=True)
    hook('stop','Stop')
    if slow_lint:
        time.sleep(6)
        cli('status','--wait','15000')
    print('TOOL DELIVERY AFTER MERGE', flush=True)
    hook('post-tool-batch','PostToolBatch',tool_name='Bash')
    cli('code','--changed','--json')
    cli('code','src/a.js','--json')
    time.sleep(1)
    print('UNCHANGED REPEAT DELIVERY', flush=True)
    hook('post-tool-batch','PostToolBatch',tool_name='Bash')
    git('status','--porcelain')
finally:
    hook('session-end','SessionEnd')
    cli('stop')
    print('Fixture retained for inspection:', root, flush=True)
