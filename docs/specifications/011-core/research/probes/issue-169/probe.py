"""Throwaway, read-only selection probe; run from the Squeal repository root."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--output', default='results.json')
args = parser.parse_args()
OUT = Path(__file__).resolve().parent / args.output
SQUEAL = '/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal'
PREFIX = 'test/cli/named-file'
EXACT = ['test/cli/named-file-lines.test.ts', 'test/cli/named-file-end.test.ts']
DIRECTORY = 'test/commit'
commands = [
    ['git', 'rev-parse', 'HEAD'],
    [SQUEAL, '--version'],
    ['pnpm', 'exec', 'vitest', '--version'],
    ['pnpm', 'exec', 'vitest', 'list', '--filesOnly', PREFIX],
    [SQUEAL, 'status', PREFIX],
    ['pnpm', 'exec', 'vitest', 'list', '--filesOnly', *EXACT],
    [SQUEAL, 'status', *EXACT],
    ['pnpm', 'exec', 'vitest', 'list', '--filesOnly', DIRECTORY],
    [SQUEAL, 'status', DIRECTORY],
    [SQUEAL, 'status', PREFIX, EXACT[0]],
]
results = {'cwd': os.getcwd(), 'cpus': os.cpu_count(), 'paths': {
    PREFIX: {'exists': Path(PREFIX).exists()},
    DIRECTORY: {'is_directory': Path(DIRECTORY).is_dir()},
}, 'commands': []}
for argv in commands:
    load = os.getloadavg()[0]
    if load > os.cpu_count():
        results['skipped'] = {'load_1m': load, 'remaining': commands[len(results['commands']):]}
        break
    result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
    row = {'argv': argv, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'load_1m': load, 'exit_code': result.returncode,
           'stdout': result.stdout, 'stderr': result.stderr}
    results['commands'].append(row)
    print(json.dumps(row), flush=True)
OUT.write_text(json.dumps(results, indent=2) + '\n')
