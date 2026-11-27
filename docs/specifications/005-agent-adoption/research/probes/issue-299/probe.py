"""Throwaway launcher-only probe: no real runtime, daemon or test execution."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
SOURCE = ROOT / "plugins/claude-code/bin/squeal-launcher"


def put(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def snapshot(path):
    if path.is_dir():
        return "directory (rename blocked)"
    return json.loads(path.read_text()) if path.exists() else "absent"


def main():
    cpus = os.cpu_count()
    load = Path('/proc/loadavg').read_text().strip()
    if float(load.split()[0]) > cpus:
        raise SystemExit(f"SKIPPED: load {load}, CPUs {cpus}")
    print(json.dumps({"kind": "environment", "loadavg": load, "cpus": cpus,
                      "node": subprocess.check_output(['node', '--version'], text=True).strip(),
                      "launcherSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest()}))
    with tempfile.TemporaryDirectory(prefix="fixture-", dir=HERE) as folder:
        base = Path(folder)
        launcher = base / 'bin/squeal'
        put(launcher, SOURCE.read_text())
        claude = base / 'claude-plugin'
        codex = base / 'codex/plugins/cache/hearsay/squeal/0.1.647'
        antigravity = base / 'home/.gemini/config/plugins/squeal'
        for path, version in [(claude, '0.1.654'), (codex, '0.1.647'), (antigravity, '0.1.640')]:
            put(path / 'dist/cli/squeal.mjs', 'console.log(JSON.stringify({syntheticRuntime:'
                + json.dumps(version) + ',args:process.argv.slice(2)}));\n')
        put(antigravity / 'plugin.json', json.dumps({'version': '0.1.640'}))
        put(base / 'claude-config/plugins/installed_plugins.json', json.dumps({'plugins': {
            'squeal@hearsay': [{'scope': 'user', 'version': '0.1.654', 'installPath': str(claude)}]}}))
        # Fresh child environment: no real plugin paths, session pins or preloads.
        env = {'PATH': str(Path(shutil.which('node')).parent) + ':/usr/bin:/bin',
               'HOME': str(base / 'home'), 'CODEX_HOME': str(base / 'codex'),
               'CLAUDE_CONFIG_DIR': str(base / 'claude-config'),
               'XDG_STATE_HOME': str(base / 'state'), 'XDG_DATA_HOME': str(base / 'data'),
               'XDG_CACHE_HOME': str(base / 'cache'), 'CLAUDE_CODE_SESSION_ID': 'issue-299-session'}
        mark = base / 'state/squeal/launcher-notices.json'
        commands = [['status', '--wait', '60000', '.github/scripts/baseline-growth.test.cjs'],
                    ['lint'], ['status', '--json']]
        for scenario in ['writable', 'blocked']:
            if scenario == 'blocked':
                mark.unlink()
                mark.mkdir()
            for index, args in enumerate(commands):
                load = Path('/proc/loadavg').read_text().strip()
                if float(load.split()[0]) > cpus:
                    raise SystemExit(f"SKIPPED remaining calls: load {load}")
                before = snapshot(mark)
                result = subprocess.run(['/bin/sh', str(launcher), *args], cwd=base,
                                        env=env, capture_output=True, text=True, timeout=10)
                print(json.dumps({'kind': 'call', 'scenario': scenario, 'call': index + 1,
                    'command': ['/bin/sh', '<fixture>/bin/squeal', *args], 'loadavg': load,
                    'scope': env['CLAUDE_CODE_SESSION_ID'], 'marker': '<fixture>/state/squeal/launcher-notices.json',
                    'markerBefore': before, 'markerAfter': snapshot(mark),
                    'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}))


if __name__ == '__main__':
    main()
