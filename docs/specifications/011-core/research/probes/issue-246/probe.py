"""Throwaway one-file probe; pass the pinned squeal.mjs and node_modules paths."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import time

base = Path(__file__).resolve().parent
fixture = base / 'fixture'
if os.getloadavg()[0] > os.cpu_count():
    raise SystemExit('Skipped: one-minute load exceeds CPU count')
if fixture.exists():
    raise SystemExit('Remove the previous probe fixture after confirming its daemon stopped')
fixture.mkdir()
cli = Path(sys.argv[1]).resolve()
modules = Path(sys.argv[2]).resolve()
log = []

def command(args, timeout=40):
    start = time.monotonic()
    proc = subprocess.run(args, cwd=fixture, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout)
    output = proc.stdout.replace(str(fixture), '<fixture>').replace(str(Path.home()), '~')
    item = {'command': args[2:] if args[:2] == ['node', str(cli)] else args,
            'exit': proc.returncode, 'seconds': round(time.monotonic()-start, 3),
            'output': output}
    log.append(item)
    print(json.dumps(item), flush=True)
    (base / 'results.json').write_text(json.dumps(log, indent=2)+'\n')
    return proc

def squeal(*args):
    return command(['node', str(cli), *args])

def test(revision):
    (fixture/'tiny.test.ts').write_text(
        "import { test, expect } from 'vitest';\n"
        f"test('serves every named query from its index', () => expect({revision}).toBe({revision}));\n")

command(['git', 'init', '--quiet'])
(fixture/'.gitignore').write_text('node_modules/\n')
(fixture/'package.json').write_text(json.dumps({'name':'issue-246-probe','private':True,'type':'module'}))
(fixture/'vitest.config.ts').write_text("export default { test: { include: ['tiny.test.ts'], maxWorkers: 1 } };\n")
(fixture/'squeal.config.json').write_text(json.dumps({'baseline':{'onStart':'lookup-only'}, 'coverage': {'enabled': False}, 'complexity': {'enabled': False}}))
if not (fixture/'node_modules').exists():
    (fixture/'node_modules').symlink_to(modules, target_is_directory=True)
test(1)
try:
    squeal('--version')
    squeal('start')
    squeal('status', '--wait', '15000', 'tiny.test.ts')
    squeal('stop')
    test(2)
    squeal('start')
    squeal('status', 'tiny.test.ts')
    squeal('status', '--wait', '5000', 'tiny.test.ts', '--check', 'serves every named query from its index')
    squeal('status', '--wait', '15000', 'tiny.test.ts')
    squeal('stop')
    test(3)
    squeal('start')
    squeal('status', '--wait', '5000', 'tiny.test.ts', '--check', 'serves every named query from its index')
    squeal('retry', 'tiny.test.ts')
    squeal('status', '--wait', '15000', 'tiny.test.ts')
finally:
    squeal('stop')
    shutil.rmtree(fixture)
