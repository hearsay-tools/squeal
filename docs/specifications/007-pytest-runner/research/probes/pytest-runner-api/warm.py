"""Throwaway repeat-main/fork/reload probe; all mutations stay in work/."""
import contextlib
import importlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
VERSION = f'{sys.version_info.major}.{sys.version_info.minor}'
ROOT = BASE / 'work' / ('warm-' + VERSION)
ROOT.mkdir(parents=True, exist_ok=True)
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ.pop('PYTEST_ADDOPTS', None)
os.environ.pop('PYTEST_PLUGINS', None)


def files(value):
    (ROOT/'app.py').write_text(f'VALUE = {value}\n')
    (ROOT/'conftest.py').write_text('import pytest\nCOUNT = 0\n@pytest.fixture(scope="session")\ndef session_value():\n    global COUNT\n    COUNT += 1\n    return COUNT\n@pytest.fixture\ndef conftest_value():\n    return '+str(value)+'\n')
    (ROOT/'installed_plugin.py').write_text('import pytest\n@pytest.fixture\ndef plugin_value():\n    return '+str(value)+'\n')
    (ROOT/'test_repeat.py').write_text('import os, app\ndef test_values(session_value, conftest_value, plugin_value):\n    expected = int(os.environ["EXPECTED"])\n    print(f"VALUES app={app.VALUE} conf={conftest_value} plugin={plugin_value} session={session_value}")\n    assert (app.VALUE, conftest_value, plugin_value) == (expected, expected, expected)\n')


files(1)
import pytest
args = ['-q', '-s', '-p', 'installed_plugin', '-p', 'no:cacheprovider', 'test_repeat.py']
RESULT = dict(python=sys.version, pytest=pytest.__version__, repeat=[], fork=[])
for value in (1, 2, 3):
    files(value)
    os.environ['EXPECTED'] = str(value)
    output = io.StringIO()
    start = time.perf_counter()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        code = pytest.main(args)
    RESULT['repeat'].append(dict(edit=value, code=int(code), ms=(time.perf_counter()-start)*1000, output=output.getvalue()))
    fresh = subprocess.run([sys.executable, '-m', 'pytest', *args], env=dict(os.environ, PYTHONPATH=str(ROOT)), capture_output=True, text=True)
    RESULT['repeat'][-1]['fresh_code'] = fresh.returncode
    RESULT['repeat'][-1]['fresh_output'] = fresh.stdout
# A fork inherits already imported application/conftest/plugin modules.
for value in (4, 5):
    files(value)
    os.environ['EXPECTED'] = str(value)
    output_path = ROOT/f'fork-{value}.json'
    started = time.perf_counter()
    pid = os.fork()
    if pid == 0:
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            code = pytest.main(args)
        output_path.write_text(json.dumps(dict(code=int(code), output=output.getvalue())))
        os._exit(0)
    os.waitpid(pid, 0)
    RESULT['fork'].append(dict(edit=value, ms=(time.perf_counter()-started)*1000, **json.loads(output_path.read_text())))
# reload cannot update an earlier from-import binding, and retains deleted names.
import app
from app import VALUE as old_reference
app.OBSOLETE = 'retained'
importlib.reload(app)
RESULT['reload'] = dict(module_value=app.VALUE, earlier_from_import=old_reference, deleted_name=app.OBSOLETE)
# Clean fork server: only pytest imported; a new subprocess hosts the server.
clean = r'''
import contextlib, io, json, os, pathlib, time, pytest
root = pathlib.Path.cwd()
results = []
for value in (6, 7):
    (root/'app.py').write_text(f'VALUE = {value}\n')
    os.environ['EXPECTED'] = str(value)
    (root/'test_fork_clean.py').write_text('import app, os\ndef test_fresh(): assert app.VALUE == int(os.environ["EXPECTED"])\n')
    start = time.perf_counter()
    pid = os.fork()
    if pid == 0:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = pytest.main(['-q', '-p', 'no:cacheprovider', 'test_fork_clean.py'])
        os._exit(int(code))
    _, status = os.waitpid(pid, 0)
    results.append(dict(edit=value, code=os.waitstatus_to_exitcode(status), ms=(time.perf_counter()-start)*1000))
print(json.dumps(results))
'''
completed = subprocess.run([sys.executable, '-c', clean], env=dict(os.environ, PYTHONPATH=str(ROOT)), capture_output=True, text=True, check=True)
RESULT['clean_fork'] = json.loads(completed.stdout)
(BASE/f'warm-{VERSION}.json').write_text(json.dumps(RESULT, indent=2).replace(str(BASE), '<PROBE>')+'\n')
print(json.dumps({k:v for k,v in RESULT.items() if k in ('reload', 'clean_fork')}, indent=2))
print('repeat codes', [r['code'] for r in RESULT['repeat']], 'fork codes', [r['code'] for r in RESULT['fork']])
