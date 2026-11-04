#!/usr/bin/env python3
"""Throwaway synthetic lease probe. Uses only two generated Vitest files."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

source = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
cli = source / 'plugins/claude-code/dist/cli/squeal.mjs'
node = shutil.which('node')
slow = '--slow' in sys.argv[2:]
load = os.getloadavg()
print(json.dumps({'event': 'environment', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'source': str(source), 'load': load, 'cpus': os.cpu_count(), 'slow': slow,
                  'version': json.loads((source / 'package.json').read_text())['version'],
                  'vitest': json.loads((source / 'node_modules/vitest/package.json').read_text())['version'],
                  'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()}), flush=True)
if load[0] > os.cpu_count():
    print('SKIPPED: one-minute load exceeds CPU count', flush=True)
    sys.exit(77)

with tempfile.TemporaryDirectory(prefix='squeal-issue-148-') as scratch:
    base = Path(scratch)
    root = base / 'repo'
    root.mkdir()
    (root / 'node_modules').symlink_to(source / 'node_modules', target_is_directory=True)
    (root / '.gitignore').write_text('node_modules/\n')
    (root / 'package.json').write_text(json.dumps({'type': 'module', 'devDependencies': {'vitest': '5.0.3'}}))
    (root / 'squeal.config.json').write_text(json.dumps({
        'baseline': {'onStart': 'lookup-then-run-missing'},
        'runner': {'tierSize': 2, 'backlogTierSize': 2, 'timeoutMs': 15000},
        'slow': {'include': ['*.test.ts'] if slow else []},
        'coverage': {'enabled': False}, 'complexity': {'enabled': False}, 'lint': {'enabled': False}}))
    (root / 'vitest.config.ts').write_text("export default { test: { name: 'lease', include: ['*.test.ts'], globalSetup: './setup.ts', maxWorkers: 1 } };\n")
    lease = base / 'external.lease'
    attempts = base / 'setup-attempts.txt'
    (root / 'setup.ts').write_text("import { execFileSync } from 'node:child_process';\n"
        "import { appendFileSync } from 'node:fs';\n"
        "export default function setup() {\n"
        f"  appendFileSync({json.dumps(str(attempts))}, Date.now() + '\\n');\n"
        f"  try {{ execFileSync('flock', ['-w', '0.2', {json.dumps(str(lease))}, 'true']); }}\n"
        f"  catch {{ throw new Error('synthetic test-env lease timeout: held by probe pid {os.getpid()}'); }}\n"
        "}\n")
    for name in ['a', 'b']:
        (root / f'{name}.test.ts').write_text(f"import {{ test, expect }} from 'vitest';\ntest('{name}', () => expect(1).toBe(1));\n")
    subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
    subprocess.run(['git', 'add', '.'], cwd=root, check=True)
    subprocess.run(['git', '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture'], cwd=root, check=True)

    def run(*args, record=True):
        command = [node, '--disable-warning=ExperimentalWarning', str(cli), *args]
        began = time.monotonic()
        result = subprocess.run(command, cwd=root, text=True, capture_output=True, timeout=45)
        if record:
            print(json.dumps({'event': 'command', 'cwd': str(root), 'argv': command,
                              'elapsed': round(time.monotonic() - began, 3),
                              'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}), flush=True)
        return result

    def count():
        return len(attempts.read_text().splitlines()) if attempts.exists() else 0

    with lease.open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            run('--version')
            run('start')
            if slow:
                run('run', '--slow', '--wait', '15000')
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                result = run('status', record=False)
                if 'synthetic test-env lease timeout' in result.stdout:
                    break
                time.sleep(0.2)
            else:
                raise RuntimeError('no setup failure within 30 seconds: ' + result.stdout)
            run('status', '--full')
            print(json.dumps({'event': 'lease-release', 'attempts': count(), 'load': os.getloadavg()}), flush=True)
            fcntl.flock(lock, fcntl.LOCK_UN)
            time.sleep(3)
            run('status', '--full')
            print(json.dumps({'event': 'after-release-3s', 'attempts': count()}), flush=True)
            run('retry', 'setup.ts', '--reason', 'environment')
            run('retry', 'a.test.ts', '--reason', 'environment')
            run('status', '--wait', '15000', 'a.test.ts')
            run('status', '--full')
            print(json.dumps({'event': 'after-test-file-retry', 'attempts': count()}), flush=True)
            run('status', '--wait', '15000', 'b.test.ts')
            run('status', '--full')
            print(json.dumps({'event': 'after-named-wait', 'attempts': count()}), flush=True)
            # Positive control: the released lease is usable, and a new revision recovers.
            with (root / 'setup.ts').open('a') as setup:
                setup.write('// recovery control: new revision after external lease release\n')
            print(json.dumps({'event': 'edit-setup-control', 'load': os.getloadavg()}), flush=True)
            if slow:
                run('run', '--slow', '--wait', '15000')
            result = run('status', '--wait', '15000', 'a.test.ts', 'b.test.ts')
            run('status', '--full')
            print(json.dumps({'event': 'after-edit-control', 'attempts': count()}), flush=True)
            assert result.returncode == 0, 'edit recovery control did not pass'
        finally:
            run('stop')
