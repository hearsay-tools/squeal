"""Throwaway black-box probe; does not import Squeal implementation code."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CLI = os.environ.get('ISSUE195_CLI', '/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal')
CLI_COMMAND = ['node', '--disable-warning=ExperimentalWarning', CLI] if CLI.endswith('.mjs') else [CLI]
RUNS = HERE / '.runs'
RUNS.mkdir(exist_ok=True)
ROOT = Path(tempfile.mkdtemp(prefix='probe-', dir=RUNS))
BASE_CONFIG = '--no-base-config' not in sys.argv


def call(args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True,
                          timeout=90, check=True).stdout.strip()


summary = {'root': str(ROOT), 'squeal': call(CLI_COMMAND + ['--version']),
           'node': call(['node', '--version']),
           'vitest': json.loads((REPO / 'node_modules/vitest/package.json').read_text())['version'],
           'cpus': os.cpu_count(), 'base_config': BASE_CONFIG, 'cases': []}
for mode in ('missing', 'existing'):
    case = ROOT / mode
    fixture = case / 'fixture'
    fixture.mkdir(parents=True)
    tmp = case / 'tmp'
    if mode == 'existing':
        tmp.mkdir()
    (fixture / 'package.json').write_text('{"type":"module","private":true}\n')
    (fixture / '.gitignore').write_text('node_modules/\n*.marker\n')
    (fixture / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    (fixture / 'squeal.config.json').write_text(json.dumps({
        'nodeTest': [{'name': 'node', 'include': ['node.test.mjs']}]}))
    (fixture / 'vitest.config.mjs').write_text(
        "export default {test:{include:['vitest.test.mjs'],maxWorkers:1}};\n")
    (fixture / 'value.mjs').write_text('export function value() { return 1; }\n')
    for runner in ('node', 'vitest'):
        imports = ("import {test} from 'node:test';\n" if runner == 'node'
                   else "import {test} from 'vitest';\n")
        (fixture / f'{runner}.test.mjs').write_text(imports +
            "import {writeFileSync} from 'node:fs';\n"
            "import {strict as assert} from 'node:assert';\n"
            "import {value} from './value.mjs';\n"
            f"test('marker', () => {{ writeFileSync('{runner}.marker', 'ran'); "
            "assert.equal(value(), 2); });\n")
    call(['git', 'init', '-q'], fixture)
    config = (fixture / 'squeal.config.json').read_text()
    if not BASE_CONFIG:
        (fixture / 'squeal.config.json').unlink()
    call(['git', 'add', '.'], fixture)
    call(['git', '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid',
          '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base'], fixture)
    if not BASE_CONFIG:
        (fixture / 'squeal.config.json').write_text(config)
    (fixture / 'value.mjs').write_text('export function value() { return 2; }\n')
    env = dict(os.environ, TMPDIR=str(tmp))
    command = CLI_COMMAND + ['code', '--base', 'HEAD', '--json', '--timeout', '30']
    load = os.getloadavg()[0]
    start = time.monotonic()
    result = subprocess.run(command, cwd=fixture, env=env, capture_output=True,
                            text=True, timeout=75)
    (case / 'stdout.txt').write_text(result.stdout)
    (case / 'stderr.txt').write_text(result.stderr)
    entry = {'mode': mode, 'command': command, 'cwd': str(fixture), 'TMPDIR': str(tmp),
             'load1': load, 'exit': result.returncode,
             'seconds': round(time.monotonic() - start, 3),
             'markers': {r: (fixture / f'{r}.marker').exists() for r in ('node', 'vitest')},
             'tmp_exists_after': tmp.exists(), 'stdout_bytes': len(result.stdout.encode()),
             'stderr': result.stderr}
    try:
        report = json.loads(result.stdout)
        entry.update(json_parse=True, format=report.get('format'),
                     verdict=report.get('verdict'), runs=report.get('runs'))
    except json.JSONDecodeError as error:
        entry.update(json_parse=False, json_error=str(error))
    summary['cases'].append(entry)
    print(json.dumps(entry), flush=True)
(ROOT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print('RESULTS ' + str(ROOT / 'summary.json'))
