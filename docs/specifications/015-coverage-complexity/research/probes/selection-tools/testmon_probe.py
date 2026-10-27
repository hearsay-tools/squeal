"""Throwaway bounded real-testmon comparison. No Squeal stores or repository tests."""
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time
import importlib.metadata

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
BASE = '''TAX = 2

def shipping(weight):
    if weight > 20:
        return 100
    return weight * 3

def tax(amount):
    return amount * TAX

def discount(amount):
    return amount // 10

def label(value):
    return str(value).upper()

def cents(amount):
    return round(amount * 100)

def available(stock):
    return stock > 0

def total(items):
    return sum(items)

def currency():
    return "USD"

def unused(x):
    return "old"
'''
CHECKS = ['shipping(2) == 6', 'tax(10) == 20', 'discount(100) == 10',
          'label("box") == "BOX"', 'cents(1.5) == 150', 'available(2) is True',
          'total([1, 2]) == 3', 'currency() == "USD"']
HOOK = '''import json
from pathlib import Path
reports = []
def pytest_runtest_logreport(report):
    if report.when == 'call' or report.failed:
        reports.append({'id': report.nodeid, 'phase': report.when, 'outcome': report.outcome})
def pytest_collectreport(report):
    if report.failed:
        reports.append({'id': report.nodeid, 'phase': 'collect', 'outcome': report.outcome})
def pytest_sessionfinish(session, exitstatus):
    Path('probe-report.json').write_text(json.dumps(reports))
'''
CASES = [
 ('unchanged', BASE, {}),
 ('body-refactor', BASE.replace('return weight * 3', 'rate = 3\n    return weight * rate'), {}),
 ('body-regression', BASE.replace('return weight * 3', 'return weight * 4'), {}),
 ('insert-branch', BASE.replace('    if weight > 20:', '    if weight == 2:\n        return 0\n    if weight > 20:'), {}),
 ('uncovered-branch', BASE.replace('return 100', 'return 101'), {}),
 ('comments-shift', '# comment\n\n' + BASE, {}),
 ('module-value', BASE.replace('TAX = 2', 'TAX = 3'), {}),
 ('top-level-throw', BASE + '\nraise RuntimeError("added")\n', {}),
 ('delete-declaration', BASE.replace('def currency():\n    return "USD"\n', ''), {}),
 ('signature', BASE.replace('unused(x)', 'unused(x, y)'), {'extra': 'import rates\nassert rates.unused.__code__.co_argcount == 1'}),
 ('reflection', BASE.replace('return "old"', 'return "new"'), {'extra': 'import rates\nassert "old" in rates.unused.__code__.co_consts'}),
 ('data', BASE, {'extra': 'from pathlib import Path\nassert Path("rate.txt").read_text() == "old"', 'files': {'rate.txt': 'new'}}),
 ('child', BASE.replace('return "old"', 'return "new"'), {'extra': 'import subprocess, sys\nassert subprocess.check_output([sys.executable, "-B", "-c", "import rates; print(rates.unused(1))"], text=True).strip() == "old"'}),
 ('syntax', BASE.replace('return "old"', 'return ('), {}),
 ('stale-dependency', BASE.replace('return "old"', 'return "new"'), {'extra': 'import rates, gate\nassert (rates.unused(1) if gate.ENABLED else "old") == "old"', 'files': {'gate.py': 'ENABLED = True\n'}}),
 ('environment-unkeyed', BASE, {'extra': 'import os\nassert os.environ["PROBE_MODE"] == "old"', 'env': {'PROBE_MODE': 'new'}}),
 ('environment-keyed', BASE, {'extra': 'import os\nassert os.environ["PROBE_MODE"] == "old"', 'env': {'PROBE_MODE': 'new'}, 'key_env': True}),
 ('new-test', BASE, {'files': {'test_new.py': 'def test_new():\n    assert False\n'}}),
]

CASES += [(f'body-refactor-repeat-{i}', BASE.replace('return weight * 3', 'rate = 3\n    return weight * rate'), {}) for i in range(1, 5)]
START_LOAD = os.getloadavg()

def run(root, args, env):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    start = time.perf_counter()
    command = [sys.executable, '-B', '-m', 'pytest', '-q', *args]
    p = subprocess.run(command, cwd=root, env=env, text=True, capture_output=True, timeout=30)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return {'command': command, 'exit': p.returncode,
            'wall_ms': (time.perf_counter()-start)*1000,
            'cpu_ms': ((after.ru_utime+after.ru_stime)-(before.ru_utime+before.ru_stime))*1000,
            'reports': json.loads((root/'probe-report.json').read_text()) if (root/'probe-report.json').exists() else [],
            'output': p.stdout+p.stderr}

results = []
for name, changed, options in CASES:
    with tempfile.TemporaryDirectory(prefix='selection-testmon-') as tmp:
        root = Path(tmp)
        (root/'pytest.ini').write_text('[pytest]\n')
        (root/'conftest.py').write_text(HOOK)
        (root/'rates.py').write_text(BASE)
        (root/'rate.txt').write_text('old')
        (root/'gate.py').write_text('ENABLED = False\n')
        for i, check in enumerate(CHECKS):
            (root/f'test_{i}.py').write_text(f'import rates\ndef test_case():\n    sum(i * i for i in range(200000))\n    assert rates.{check}\n')
        if 'extra' in options:
            (root/'test_extra.py').write_text('def test_extra():\n'+'\n'.join('    '+line for line in options['extra'].splitlines())+'\n')
        env = {**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1', 'PYTHONDONTWRITEBYTECODE': '1', 'PROBE_MODE': 'old'}
        tm = ['-p', 'testmon.pytest_testmon', '--testmon']
        if options.get('key_env'): tm += ['--testmon-env', 'old']
        baseline = run(root, tm, env)
        assert baseline['exit'] == 0, (name, baseline)
        (root/'rates.py').write_text(changed)
        for f, content in options.get('files', {}).items(): (root/f).write_text(content)
        env.update(options.get('env', {}))
        if options.get('key_env'): tm[-1] = 'new'
        selected = run(root, tm, env)
        full = run(root, [], env)
        selected_ids = {r['id'] for r in selected['reports']}
        failure_ids = {r['id'] for r in full['reports'] if r['outcome'] == 'failed'}
        missed = failure_ids - {r['id'] for r in selected['reports'] if r['outcome'] == 'failed'}
        result = {'case': name, 'baseline': baseline, 'selected': selected, 'exhaustive': full,
                  'selected_count': len(selected_ids), 'full_count': len({r['id'] for r in full['reports']}),
                  'missed_failures': sorted(missed)}
        results.append(result)
        print(name, result['selected_count'], '/', result['full_count'], 'missed', sorted(missed), flush=True)
metadata = {'python': sys.version, 'packages': {p: importlib.metadata.version(p) for p in ['pytest','pytest-testmon','coverage']},
            'start_load': START_LOAD, 'end_load': os.getloadavg(), 'cpus': os.cpu_count()}
(OUT/'testmon-results.json').write_text(json.dumps({'metadata':metadata,'cases': results},indent=2)+'\n')
