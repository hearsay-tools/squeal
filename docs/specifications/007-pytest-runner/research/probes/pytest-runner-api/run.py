"""Throwaway experiments. Expected test failures are evidence, not harness failures."""
import concurrent.futures
import json
from compact import dumps
import os
from pathlib import Path
import platform
import shutil
import signal
import statistics
import subprocess
import sys
import time
from fixture import create, write

BASE = Path(__file__).resolve().parent
VERSION = f"{sys.version_info.major}.{sys.version_info.minor}"
ROOT = BASE / 'work' / VERSION
if ROOT.exists():
    shutil.rmtree(ROOT)
ROOT.mkdir(parents=True)
create(ROOT)
LOGS = ROOT / 'logs'
LOGS.mkdir()
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(BASE),
           UV_CACHE_DIR=str(BASE / '.cache/uv'), UV_PYTHON_INSTALL_DIR=str(BASE / '.python'),
           XDG_CACHE_HOME=str(BASE / '.cache'), TMPDIR=str(BASE / '.tmp'))
for key in ('PYTEST_ADDOPTS', 'PYTEST_PLUGINS', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD'):
    ENV.pop(key, None)
subprocess.run(['uv', 'pip', 'install', '--python', sys.executable, '--no-build-isolation', '-e', str(ROOT), '-e', str(ROOT / 'packages/second')], env=ENV, check=True, capture_output=True)
RESULT = dict(python=platform.python_version(), platform=platform.platform(), cpu_count=os.cpu_count(), load=os.getloadavg(), cases={}, timings={})


def run(name, args, extra=None, cwd=None, kill=None, report=True):
    events = LOGS / (name + '.jsonl')
    junit = LOGS / (name + '.xml')
    js = LOGS / (name + '.json')
    child = LOGS / (name + '.pid')
    env = dict(ENV, PROBE_EVENTS=str(events), PROBE_CHILD=str(child))
    env.update(extra or {})
    command = [sys.executable, '-m', 'pytest', '-p', 'reporter', '-q', '--basetemp', str(LOGS / (name + '-tmp'))]
    if report:
        command += ['--junitxml', str(junit), '--json-report', '--json-report-file', str(js)]
    command += args
    start = time.perf_counter()
    proc = subprocess.Popen(command, cwd=cwd or ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    if kill:
        deadline = time.monotonic() + 15
        while not child.exists() and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(.01)
        if proc.poll() is None:
            os.kill(proc.pid, kill)
    try:
        stdout, _ = proc.communicate(timeout=25)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        stdout, _ = proc.communicate()
        raise RuntimeError(f'probe {name} exceeded harness deadline: {stdout[-1000:]}')
    elapsed = (time.perf_counter() - start) * 1000
    data = [json.loads(line) for line in events.read_text().splitlines()] if events.exists() else []
    child_alive = False
    if child.exists():
        try:
            os.kill(int(child.read_text()), 0)
            child_alive = True
        except ProcessLookupError:
            pass
        # Clean descendants even when pytest returned normally after a timeout.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    item = dict(args=args, code=proc.returncode, wall_ms=round(elapsed, 2), events=data,
                junit_exists=junit.exists(), json_exists=js.exists(), child_alive=child_alive,
                output_tail=stdout[-2400:])
    if js.exists():
        item['json_report'] = json.loads(js.read_text())
    if junit.exists():
        item['junit'] = junit.read_text()
    RESULT['cases'][name] = item
    print(f'{VERSION} {name}: exit={proc.returncode}, events={len(data)}, ms={elapsed:.0f}', flush=True)
    return item


smoke = 'tests/nested/test_smoke.py'
run('smoke', [smoke])
run('outcomes', ['cases/test_outcomes.py'])
run('collect1', ['--collect-only', 'tests'])
run('collect2', ['--collect-only', 'tests'])
run('broken', ['cases/test_broken.py', smoke])
run('broken_continue', ['--continue-on-collection-errors', 'cases/test_broken.py', smoke])
run('empty', ['cases/test_empty.py'])
run('usage', ['--not-a-real-option'])
run('internal', [smoke], {'PROBE_INTERNAL': '1'})
run('keyboard', ['cases/test_keyboard.py'])
for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
    run(f'hang_{sig.name}', ['cases/test_hang.py'], kill=sig)
run('timeout_signal', ['--timeout=0.2', '--timeout-method=signal', 'cases/test_hang.py'])
run('timeout_thread', ['--timeout=0.2', '--timeout-method=thread', 'cases/test_hang.py'])
run('async_unittest', ['cases/test_async.py'])
run('django_missing', ['cases/test_django.py'])
run('django_settings', ['--ds=django_settings', 'cases/test_django.py'])
run('doctest', ['cases/example.txt'])
run('snapshot_missing', ['cases/test_snapshot.py'])
run('snapshot_update', ['--snapshot-update', 'cases/test_snapshot.py'])
run('snapshot_saved', ['cases/test_snapshot.py'])
run('write_no_cache', ['-p', 'no:cacheprovider', 'cases/test_write.py'])
RESULT['writes'] = dict(test_write=(ROOT/'written-by-test.txt').exists(), pyc=list(map(str, ROOT.rglob('*.pyc'))), snapshots=list(map(str, ROOT.rglob('*.ambr'))))
for mode in ('prepend', 'append', 'importlib'):
    run('import_' + mode, ['--import-mode=' + mode, smoke])
run('default_testpaths', ['--collect-only'])
run('second_package', ['tests'], cwd=ROOT / 'packages/second')
run('both_packages', [smoke, 'packages/second/tests/test_second.py'])
run('rootdir_only', ['--rootdir', str(ROOT / 'packages/second'), smoke])
run('x_stop', ['-x', 'cases/test_outcomes.py'])
run('maxfail_override', ['-x', '--maxfail=0', 'cases/test_outcomes.py'])
run('lf', ['--lf', 'cases/test_outcomes.py'])
run('lf_no_cache', ['-p', 'no:cacheprovider', '--lf', smoke])
run('capture_s', ['-s', smoke])
run('cov', ['--cov=probe_pkg', '--cov-report=', smoke], {'COVERAGE_FILE': str(LOGS / '.coverage')})
# Environment addopts can deselect tests. -o addopts= alone does not remove it.
run('env_addopts', ['-o', 'addopts=', 'cases/test_outcomes.py'], {'PYTEST_ADDOPTS': '-k test_pass'})
# Config addopts can be cleared while other ini options remain.
config = ROOT / 'pyproject.toml'
original = config.read_text()
config.write_text(original.replace('addopts = "-ra"', 'addopts = "-x -k test_pass"'))
run('ini_addopts', ['cases/test_outcomes.py'])
run('ini_cleared', ['-o', 'addopts=', 'cases/test_outcomes.py'])
config.write_text(original)
# Config candidates at the same root: one file wins; configs never merge.
for filename, contents in [('setup.cfg', '[tool:pytest]\naddopts = -q\n'), ('tox.ini', '[pytest]\naddopts = -q\n'), ('pytest.ini', '')]:
    write(ROOT, filename, contents)
    run('config_' + filename, ['--collect-only', 'cases/test_empty.py'])
# Explicit -c selects pyproject despite empty pytest.ini winning discovery.
run('config_explicit', ['-c', 'pyproject.toml', '--collect-only', 'cases/test_empty.py'])
for filename in ('setup.cfg', 'tox.ini', 'pytest.ini'):
    (ROOT / filename).unlink()
# Filename matching applies on traversal, not explicitly named Python files.
write(ROOT, 'tests/check_extra.py', 'def test_extra(): pass\n')
write(ROOT, 'tests/odd_name.py', 'def test_odd(): pass\n')
run('python_files', ['--collect-only', 'tests'])
run('explicit_odd', ['tests/odd_name.py'])
# Default prepend/append collide on equal basenames without package __init__.py.
for folder in ('a', 'b'):
    write(ROOT, f'duplicates/{folder}/test_equal.py', 'def test_equal(): pass\n')
for mode in ('prepend', 'append', 'importlib'):
    run('duplicate_' + mode, ['--import-mode=' + mode, 'duplicates'])


def time_command(command, env, repeats=5):
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        completed = subprocess.run(command, cwd=ROOT, env=env, capture_output=True)
        assert completed.returncode == 0, completed.stdout + completed.stderr
        samples.append(round((time.perf_counter()-start)*1000, 2))
    return dict(samples_ms=samples, median_ms=round(statistics.median(samples), 2))


RESULT['timings']['interpreter'] = time_command([sys.executable, '-c', 'pass'], ENV)
RESULT['timings']['import_pytest'] = time_command([sys.executable, '-c', 'import pytest'], ENV)
RESULT['timings']['configure_builtin'] = time_command([sys.executable, '-m', 'pytest', '--version', '--version'], dict(ENV, PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'))
RESULT['timings']['configure_plugins'] = time_command([sys.executable, '-m', 'pytest', '--version', '--version'], ENV)
RESULT['timings']['one_test'] = time_command([sys.executable, '-m', 'pytest', '-q', smoke], ENV)
RESULT['timings']['collect_20'] = time_command([sys.executable, '-m', 'pytest', '-q', '--collect-only', 'bench'], ENV)
# Parallel comparisons: 20 files, one 50-ms body per file, concurrency four.
for label, extra in [('batch', []), ('xdist4', ['-n', '4'])]:
    RESULT['timings'][label] = time_command([sys.executable, '-m', 'pytest', '-q', *extra, 'bench'], ENV, 3)
    run(label + '_reports', [*extra, 'bench'])
for count in (1, 5):
    samples = []
    codes = []
    paths = [f'bench/test_{i:02}.py' for i in range(20)]
    for repeat in range(3):
        start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(subprocess.run, [sys.executable, '-m', 'pytest', '-q', *paths[i:i+count]], cwd=ROOT, env=ENV, capture_output=True) for i in range(0, 20, count)]
            codes.extend(f.result().returncode for f in futures)
        samples.append(round((time.perf_counter()-start)*1000, 2))
    assert set(codes) == {0}, codes
    RESULT['timings'][f'processes_batch_{count}'] = dict(samples_ms=samples, median_ms=round(statistics.median(samples), 2), codes=codes)
# Keep full evidence but normalize checkout paths for readability.
encoded = dumps(RESULT).replace(str(BASE), '<PROBE>')
(BASE / f'results-{VERSION}.json').write_text(encoded + '\n')
print(json.dumps(RESULT['timings'], indent=2))
