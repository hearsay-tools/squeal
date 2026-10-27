"""Refetch only named official sources and their official links. Save hashes, not sites."""
import datetime
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

TM = '94150742345d0bc3fb00a10c19c0ae26a0064c4e'
STABLE = 'dccc58d2ed8edec98096ff1974acb7c07d3e3482'
STRYKER = 'c48089a6f027db28ddad078d3407b356d3fa18bb'
WALLABY = '89262b7ff3da0bd0c9d5909e4f0d1a4de69aee5a'
urls = [
 'https://www.testmon.org/',
 'https://www.testmon.org/blog/determining-affected-tests/',
 'https://www.testmon.org/blog/hidden-test-dependencies/',
 'https://wallabyjs.com/docs/',
 'https://wallabyjs.com/docs/features/ai/',
 'https://wallabyjs.com/docs/features/streaming-caching/',
 'https://wallabyjs.com/docs/integration/vitest/',
 'https://wallabyjs.com/docs/support/license/',
 'https://registry.npmjs.org/@wallabyjs/cli/1.0.28',
 f'https://raw.githubusercontent.com/wallabyjs/skills/{WALLABY}/skills/wallaby-cli/SKILL.md',
 'https://raw.githubusercontent.com/coveragepy/coveragepy/master/doc/trouble.rst',
]
for path in ['testmon/process_code.py','testmon/testmon_core.py','testmon/pytest_testmon.py',
             'testmon/configure.py','testmon/db.py','testmon/common.py','pyproject.toml','LICENSE','tox.ini']:
    urls.append(f'https://raw.githubusercontent.com/tarpas/pytest-testmon/{TM}/{path}')
for path in ['testmon/process_code.py','testmon/configure.py','pyproject.toml','tests/test_process_code.py']:
    urls.append(f'https://raw.githubusercontent.com/tarpas/pytest-testmon/{STABLE}/{path}')
for issue in [178,191,192,270]:
    urls.append(f'https://api.github.com/repos/tarpas/pytest-testmon/issues/{issue}')
for path in ['docs/incremental.md','docs/configuration.md','docs/vitest-runner.md',
             'packages/core/src/mutants/mutant-test-planner.ts',
             'packages/core/src/mutants/test-coverage.ts',
             'packages/core/test/unit/mutants/mutant-test-planner.spec.ts',
             'packages/vitest-runner/package.json', 'packages/vitest-runner/src/vitest-test-runner.ts','LICENSE']:
    urls.append(f'https://raw.githubusercontent.com/stryker-mutator/stryker-js/{STRYKER}/{path}')
rows = []
for url in urls:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read()
            rows.append({'url': url, 'resolved': response.url, 'bytes': len(data),
                         'sha256': hashlib.sha256(data).hexdigest(), 'status': response.status})
    except Exception as error:
        rows.append({'url': url, 'error': str(error)})
    print(rows[-1]['url'], rows[-1].get('status', rows[-1].get('error')), flush=True)
Path(sys.argv[1]).write_text(json.dumps({'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                       'sources': rows}, indent=2)+'\n')
