"""Throwaway bounded #252 reproduction, run from the repository root."""
import json, pathlib, subprocess, shutil
root = pathlib.Path.cwd()
out = root / 'docs/specifications/011-core/research/probes/issue-252'
fixture = out / 'fixture'
if fixture.exists():
    shutil.rmtree(fixture)
fixture.mkdir(exist_ok=True)
(fixture / 'workflows').mkdir(exist_ok=True)
(fixture / 'package.json').write_text('{"name":"issue-252-probe","private":true,"type":"module"}\n')
(fixture / '.gitignore').write_text('node_modules/\n')
(fixture / 'squeal.config.json').write_text('{"baseline":{"onStart":"lookup-only"}}\n')
(fixture / 'vitest.config.ts').write_text("import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { maxWorkers: 1 } });\n")
if not (fixture / 'node_modules').exists():
    (fixture / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
content = "import { expect, test } from 'vitest';\ntest('records input', () => expect(1).toBe(1));\n"
file = fixture / 'workflows/input-receipt-setup.test.ts'
file.write_text(content)
subprocess.run(['git','init','-q'], cwd=fixture, check=True)
subprocess.run(['git','add','.gitignore','package.json','squeal.config.json','vitest.config.ts','workflows/input-receipt-setup.test.ts'], cwd=fixture, check=True)
cli = ['node', '--disable-warning=ExperimentalWarning', str(root / 'plugins/claude-code/dist/cli/squeal.mjs')]
rows = []
def run(*args):
    load = pathlib.Path('/proc/loadavg').read_text().strip()
    cpus = int(subprocess.check_output(['getconf','_NPROCESSORS_ONLN']))
    if float(load.split()[0]) > cpus and args[0] != 'stop':
        raise RuntimeError('load guard: '+load)
    p = subprocess.run(cli + list(args), cwd=fixture, text=True, capture_output=True, timeout=70)
    row = {'command':'squeal '+' '.join(args), 'load':load, 'cpus':cpus, 'exit':p.returncode, 'stdout':p.stdout.replace(str(root),'<checkout>'), 'stderr':p.stderr.replace(str(root),'<checkout>')}
    rows.append(row)
    (out / 'output.json').write_text(json.dumps(rows, indent=2)+'\n')
    print(json.dumps(row), flush=True)
try:
    run('--version')
    run('checks')
    run('start')
    run('retry','workflows/input-receipt-setup.test.ts')
    run('status','--wait','60000','workflows/input-receipt-setup.test.ts')
    file.rename(fixture / 'workflows/input-receipt-process-record.test.ts')
    run('status','--wait','60000','workflows/input-receipt-process-record.test.ts')
    file.write_text(content.replace('records input', 'new setup named test'))
    run('status','--wait','60000','workflows/input-receipt-setup.test.ts')
    (fixture / 'squeal.config.json').write_text('{"baseline":{"onStart":"lookup-only"},"vitest":{"exclude":["**/*setup*"]}}\n')
    run('status','--wait','60000','workflows/input-receipt-setup.test.ts')
finally:
    run('stop','--until-start')
