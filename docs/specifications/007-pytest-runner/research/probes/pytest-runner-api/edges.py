"""Additional isolated edge probes against the generated fixture."""
import json
from compact import dumps
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
VERSION = f'{sys.version_info.major}.{sys.version_info.minor}'
ROOT = BASE/'work'/VERSION
LOG = ROOT/'logs'
RESULT = {}
ENV = dict(os.environ, PYTHONPATH=str(BASE), PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(BASE/'.tmp'))
for name in ('PYTEST_ADDOPTS', 'PYTEST_PLUGINS', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD'):
    ENV.pop(name, None)


def run(name, args, extra=None):
    dest = LOG/(name+'.jsonl')
    dest.unlink(missing_ok=True)
    completed = subprocess.run([sys.executable, '-m', 'pytest', '-p', 'reporter', '-q', '--basetemp', str(LOG/(name+'-tmp')), *args], cwd=ROOT, env=dict(ENV, PROBE_EVENTS=str(dest), **(extra or {})), capture_output=True, text=True, timeout=30)
    events = [json.loads(line) for line in dest.read_text().splitlines()] if dest.exists() else []
    RESULT[name] = dict(code=completed.returncode, events=events, stdout=completed.stdout, stderr=completed.stderr)
    print(VERSION, name, completed.returncode, flush=True)


run('xdist_outcomes', ['-n', '2', 'cases/test_outcomes.py'])
run('xdist_unstable_ids', ['-n', '2', 'tests/test_ids.py'])
run('xdist_override', ['-n', '2', '-n', '0', 'cases/test_async.py'])
run('cov_override', ['--cov=probe_pkg', '--no-cov', 'tests/nested/test_smoke.py'], {'COVERAGE_FILE': str(LOG/'.coverage-edge')})
run('reporter_blocked', ['-p', 'no:reporter', 'cases/test_async.py'])
# Collection itself executes module-level writes, but does not execute tests.
(ROOT/'cases/test_collect_sideeffect.py').write_text('from pathlib import Path\nPath("collection-write.txt").write_text("collected")\ndef test_not_run():\n    Path("body-write.txt").write_text("ran")\n')
run('collect_sideeffect', ['--collect-only', 'cases/test_collect_sideeffect.py'])
RESULT['collect_sideeffects'] = dict(collection=(ROOT/'collection-write.txt').exists(), body=(ROOT/'body-write.txt').exists())
(ROOT/'cases/test_module_skip.py').write_text('import pytest\npytest.skip("module skipped", allow_module_level=True)\n')
run('module_skip', ['cases/test_module_skip.py'])
# Packaged conftest modules are retained on repeated main calls.
PKG = ROOT/'warm_package'
PKG.mkdir(exist_ok=True)
(PKG/'__init__.py').write_text('')
(PKG/'test_packaged.py').write_text('import os\ndef test_value(value): assert value == int(os.environ["EXPECTED"])\n')
code = r'''
import contextlib, io, json, os, pathlib, pytest
results=[]
for value in (1,2):
    pathlib.Path('warm_package/conftest.py').write_text('import pytest\n@pytest.fixture\ndef value(): return '+str(value)+'\n')
    os.environ['EXPECTED']=str(value)
    out=io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        result=pytest.main(['-q','-p','no:cacheprovider','warm_package'])
    results.append(dict(edit=value,code=int(result),output=out.getvalue()))
print(json.dumps(results))
'''
p = subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=dict(ENV, PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'), capture_output=True, text=True, check=True)
RESULT['packaged_conftest'] = json.loads(p.stdout)
# A per-process group ends a normally inherited descendant along with pytest.
pidpath=LOG/'group-child.pid'
pidpath.unlink(missing_ok=True)
proc=subprocess.Popen([sys.executable,'-m','pytest','-q','cases/test_hang.py'],cwd=ROOT,env=dict(ENV,PROBE_CHILD=str(pidpath)),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
try:
    deadline=time.monotonic()+15
    while not pidpath.exists() and proc.poll() is None and time.monotonic()<deadline: time.sleep(.01)
    assert pidpath.exists(), 'child did not start'
    os.killpg(proc.pid, signal.SIGTERM)
    parent_code=proc.wait(timeout=3)
    child_pid=int(pidpath.read_text())
    time.sleep(.05)
    stat=Path(f'/proc/{child_pid}/stat')
    state=stat.read_text().split()[2] if stat.exists() else 'gone'
    RESULT['group_term']=dict(parent_code=parent_code,child_state=state)
finally:
    try: os.killpg(proc.pid,signal.SIGKILL)
    except ProcessLookupError: pass
(BASE/f'edges-{VERSION}.json').write_text(dumps(RESULT).replace(str(BASE),'<PROBE>')+'\n')
