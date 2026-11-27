"""Throwaway read-only reproduction for issue 298."""
import json
import os
from pathlib import Path
import subprocess

home = str(Path.home())
cli = str(Path.home() / '.codex/plugins/data/squeal-hearsay/bin/squeal')
path = 'test/bench/deps.test.ts'
print('load1:', os.getloadavg()[0], 'cpus:', len(os.sched_getaffinity(0)))
if os.getloadavg()[0] > len(os.sched_getaffinity(0)):
    raise SystemExit('Skipped: load exceeds available CPUs')
commands = [
    ['--version'],
    ['status', '--json', path],
    ['why', '--json', path],
    ['why', '--json', '[isolated] ' + path],
    ['why', '--json', '[isolated] ' + path +
     " > the bench project's pinned dependencies > pins vite exactly beside vitest and @vitest/coverage-v8"],
]
for args in commands:
    result = subprocess.run([cli, *args], capture_output=True, text=True)
    print('\nargv:', json.dumps([cli.replace(home, '~'), *args]))
    print('exit:', result.returncode)
    if args == ['--version']:
        print(result.stdout.strip())
        print(result.stderr.strip())
        continue
    data = json.loads(result.stdout)
    if args[0] == 'status':
        shown = {'revision': data['revision'], 'selection': data['selection']}
    else:
        shown = {key: data[key] for key in
                 ['found', 'check', 'candidates', 'candidateDurations', 'durations']
                 if key in data}
        if data.get('results'):
            row = data['results'][0]['result']
            shown['firstResult'] = {key: row[key] for key in
                                    ['check', 'outcome', 'durationMs', 'provenance']}
    print(json.dumps(shown, indent=2).replace(home, '~'))
