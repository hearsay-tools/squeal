"""Throwaway fixture: kill only the Vitest fork which identifies itself."""
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

repo = Path.cwd()
cli = repo / 'plugins/claude-code/dist/cli/squeal.mjs'
load_text = Path('/proc/loadavg').read_text().strip()
print(json.dumps({'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'host': os.uname().nodename, 'loadavg': load_text,
                  'cpus': os.cpu_count(), 'revision': subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
                  'vitest': json.loads((repo/'node_modules/vitest/package.json').read_text())['version']}), flush=True)
if float(load_text.split()[0]) > os.cpu_count():
    raise SystemExit('SKIP: one-minute load exceeds CPU count')
root = Path(tempfile.mkdtemp(prefix='squeal-issue-253-'))
def clean(value):
    return value.replace(str(root), '<fixture>').replace(str(repo), '<checkout>').replace(str(Path.home()), '~')
def cmd(label, command, timeout=25):
    started=time.monotonic()
    result=subprocess.run(command,cwd=root,text=True,capture_output=True,timeout=timeout)
    print(json.dumps({'label':label,'command':clean(' '.join(command)),'exit':result.returncode,
                      'seconds':round(time.monotonic()-started,3),'stdout':clean(result.stdout),'stderr':clean(result.stderr)}),flush=True)
    return result

def sq(label,*args):
    return cmd(label,['node','--disable-warning=ExperimentalWarning',str(cli),*args])

def test(blocked):
    body="writeFileSync('worker.json', JSON.stringify({pid:process.pid,ppid:process.ppid})); await new Promise(() => {});" if blocked else 'expect(1).toBe(1);'
    (root/'small.test.ts').write_text("import { test, expect } from 'vitest';\nimport { writeFileSync } from 'node:fs';\ntest('small', async () => {"+body+"}, 600000);\n")

(root/'node_modules').symlink_to(repo/'node_modules',target_is_directory=True)
(root/'.gitignore').write_text('node_modules/\nworker.json\n')
(root/'package.json').write_text('{"name":"issue-253-probe","type":"module"}\n')
(root/'vitest.config.ts').write_text("export default {test:{maxWorkers:1,pool:'forks'}};\n")
(root/'squeal.config.json').write_text('{"baseline":{"onStart":"lookup-only"},"complexity":{"enabled":false}}\n')
test(False)
cmd('git-init',['git','init','-q'])
cmd('git-add',['git','add','.gitignore','package.json','vitest.config.ts','squeal.config.json','small.test.ts'])
cmd('git-commit',['git','-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','fixture'])
try:
    sq('version','--version')
    cmd('node-version',['node','--version'])
    sq('checks','checks')
    sq('start','start')
    assert sq('control','status','--wait','10000','small.test.ts').returncode==0
    sq('control-why','why','small.test.ts')
    test(True)
    sq('blocked-wait','status','--wait','1500','small.test.ts')
    deadline=time.monotonic()+10
    while not (root/'worker.json').exists() and time.monotonic()<deadline:
        time.sleep(.1)
    worker=json.loads((root/'worker.json').read_text())
    pid=worker['pid']
    assert Path(f'/proc/{pid}/cwd').resolve()==root, 'refuse to signal a process outside fixture'
    assert 'vitest' in Path(f'/proc/{pid}/cmdline').read_text(), 'refuse to signal non-Vitest process'
    sq('before-kill-json','status','--json')
    print(json.dumps({'label':'kill-fixture-worker','worker':worker,'command':f'os.kill({pid}, signal.SIGKILL)',
                      'cmdline':clean(Path(f'/proc/{pid}/cmdline').read_text().replace('\0',' '))}),flush=True)
    os.kill(pid,signal.SIGKILL)
    sq('after-kill-wait','status','--wait','10000','small.test.ts')
    sq('after-kill-json','status','--json')
    sq('after-kill-why','why','small.test.ts')
    print(json.dumps({'killed_pid_exists':Path(f'/proc/{pid}').exists()}),flush=True)
    test(False)
    sq('recovery','status','--wait','10000','small.test.ts')
    sq('recovery-why','why','small.test.ts')
finally:
    result=sq('cleanup','stop','--until-start')
    if result.returncode==0:
        shutil.rmtree(root)
    print(json.dumps({'fixture_removed':result.returncode==0,'loadavg_end':Path('/proc/loadavg').read_text().strip()}),flush=True)
