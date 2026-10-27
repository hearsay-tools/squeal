"""Throwaway, bounded probe. Run from the Squeal checkout root."""
import datetime
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time

source = Path.cwd()
cli = Path('/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.368/dist/cli/squeal.mjs')
command = ['node', '--disable-warning=ExperimentalWarning', str(cli)]
print(json.dumps({'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'load': os.getloadavg(), 'cpus': os.cpu_count()}), flush=True)
if os.getloadavg()[0] > os.cpu_count():
    raise SystemExit('SKIPPED: one-minute load exceeds CPU count')

with tempfile.TemporaryDirectory(prefix='squeal-issue112-owned-') as temp:
    root = Path(temp)
    repo = root / 'repo'
    repo.mkdir()
    (repo / 'test').mkdir()
    (repo / 'node_modules').symlink_to(source / 'node_modules', target_is_directory=True)
    (repo / '.gitignore').write_text('node_modules\nmarkers\n')
    (repo / 'markers').mkdir()
    (repo / 'package.json').write_text('{"name":"issue-112-probe","private":true,"type":"module"}\n')
    policy = {'baseline': {'onStart': 'lookup-then-run-missing'},
              'coverage': {'enabled': False}, 'complexity': {'enabled': False},
              'observe': {'runtimeInputs': False},
              'runner': {'tierSize': 1, 'backlogTierSize': 1},
              'vitest': {'exclude': []}}
    def config():
        (repo / 'squeal.config.json').write_text(json.dumps(policy) + '\n')
    config()
    (repo / 'vitest.config.js').write_text(
        'export default {test: {include: ["test/*.test.js"], maxWorkers: 1, testTimeout: 5000}};\n')
    (repo / 'test/unrelated.test.js').write_text(
        'import {test, expect} from "vitest";\n'
        'import {appendFileSync} from "node:fs";\n'
        'test("unrelated", () => { appendFileSync("markers/unrelated", "run\\n"); expect(2+2).toBe(4); });\n')
    (repo / 'test/cleanup.test.js').write_text('''import {test, expect} from "vitest";
import {mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, appendFileSync} from "node:fs";
import {resolve, join} from "node:path";
test("fixture-owned cleanup leaves synthetic outsider", () => {
  const arena = mkdtempSync(resolve("markers", "arena-"));
  try {
    const owned = join(arena, "owned"); mkdirSync(owned);
    const outsider = join(arena, "outsider"); writeFileSync(outsider, "keep");
    for (const name of ["orphan-1", "orphan-2"]) mkdirSync(join(owned, name));
    const removed = readdirSync(owned).sort();
    for (const name of removed) rmSync(join(owned, name), {recursive: true});
    expect(removed).toEqual(["orphan-1", "orphan-2"]);
    expect(existsSync(outsider)).toBe(true);
    appendFileSync("markers/cleanup", "run\\n");
  } finally { rmSync(arena, {recursive: true, force: true}); }
});
''')
    env = dict(os.environ)
    (root / 'runtime').mkdir(mode=0o700)
    env['XDG_RUNTIME_DIR'] = str(root / 'runtime')
    for key in ('CEZ_TASK_ID', 'CEZ_HANDOFF_FILE', 'SQUEAL_COMMAND'):
        env.pop(key, None)

    def run(args, timeout=40, verbose=True):
        p = subprocess.run(list(map(str, args)), cwd=repo, env=env, text=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if verbose:
            print('$ ' + shlex.join(map(str, args)), flush=True)
            print(p.stdout + p.stderr, end='', flush=True)
            print('exit', p.returncode, flush=True)
        return p

    def count(name):
        p = repo / 'markers' / name
        return len(p.read_text().splitlines()) if p.exists() else 0

    def edit(name, label):
        p = repo / 'test' / (name + '.test.js')
        p.write_text(p.read_text() + '\n// ' + label + '\n')

    def wait(paths, ms='20000'):
        return run(command + ['status', '--wait', ms] + paths)

    for args in (['git', 'init', '-q'], ['git', 'add', '.'],
                 ['git', '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']):
        assert run(args, verbose=False).returncode == 0
    run(command + ['--version'])
    run(['node', '-p', 'JSON.stringify({node:process.version,vitest:require("vitest/package.json").version})'])
    # Unsupported forms must be rejected before executing the synthetic child.
    for args in (['pause', 'test/cleanup.test.js'],
                 ['hold', '--file', 'test/cleanup.test.js', '--', 'node', '-e', 'process.exit(91)']):
        result = run(command + args)
        assert result.returncode == 2
    print('$ ' + shlex.join(command + ['daemon', str(repo)]), flush=True)
    logpath = root / 'daemon.log'
    holder = None
    with logpath.open('w') as log:
        daemon = subprocess.Popen(command + ['daemon', str(repo)], cwd=repo, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 35
            while min(count('cleanup'), count('unrelated')) < 1 and time.monotonic() < deadline:
                if daemon.poll() is not None:
                    raise AssertionError(logpath.read_text())
                time.sleep(.2)
            paths = ['test/cleanup.test.js', 'test/unrelated.test.js']
            assert wait(paths).returncode == 0
            holder_code = ('const fs=require("node:fs"); fs.writeFileSync("markers/held","yes"); '
                           'const t=setInterval(()=>{if(fs.existsSync("markers/release")){clearInterval(t)}},50); '
                           'setTimeout(()=>{clearInterval(t)},25000).unref();')
            holdargs = command + ['hold', '--max', '30s', '--', 'node', '-e', holder_code]
            print('$ ' + shlex.join(holdargs), flush=True)
            holder = subprocess.Popen(holdargs, cwd=repo, env=env, text=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            deadline = time.monotonic() + 8
            while not (repo / 'markers/held').exists() and time.monotonic() < deadline:
                time.sleep(.1)
            assert (repo / 'markers/held').exists(), 'hold child did not start'
            before = {name: count(name) for name in ('cleanup', 'unrelated')}
            for name in before:
                edit(name, 'edit during worktree hold')
            held = wait(['test/unrelated.test.js'], '3000')
            assert held.returncode == 3 and 'hold' in held.stdout.lower()
            assert before == {name: count(name) for name in before}
            print('PASS: whole-worktree hold prevents both files from running, including unrelated validation.', flush=True)
            (repo / 'markers/release').write_text('release')
            out, err = holder.communicate(timeout=10)
            print(out + err + 'hold exit ' + str(holder.returncode), flush=True)
            assert holder.returncode == 0
            assert wait(paths).returncode == 0

            # Apply exclusion while no synthetic file is running. Never touch any existing daemon.
            policy['vitest']['exclude'] = ['test/cleanup.test.js']
            config()
            excluded = None
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                excluded = run(command + ['status', 'test/cleanup.test.js', '--json'], verbose=False)
                if 'not-run' in excluded.stdout:
                    break
                time.sleep(.2)
            assert excluded is not None and 'not-run' in excluded.stdout, excluded.stdout
            print('$ ' + shlex.join(command + ['status', 'test/cleanup.test.js', '--json']), flush=True)
            print(excluded.stdout + 'exit ' + str(excluded.returncode), flush=True)
            before = {name: count(name) for name in ('cleanup', 'unrelated')}
            for name in before:
                edit(name, 'edit with cleanup excluded')
            assert wait(['test/unrelated.test.js']).returncode == 0
            assert count('unrelated') > before['unrelated']
            assert count('cleanup') == before['cleanup']
            assert wait(['test/cleanup.test.js'], '1000').returncode == 3
            print('PASS: exclusion leaves unrelated validation running; cleanup is not run, not a retained blocked file.', flush=True)
            policy['vitest']['exclude'] = []
            config()
            edit('cleanup', 'explicit safe fixture resumption')
            assert wait(paths).returncode == 0
            assert count('cleanup') > before['cleanup']
            print('PASS: removing exclusion restores the safe synthetic cleanup; outsider guard passed.', flush=True)
        finally:
            (repo / 'markers/release').write_text('release')
            if holder is not None and holder.poll() is None:
                holder.communicate(timeout=10)
            stopped = run(command + ['stop', '--until-start', str(repo)], timeout=45)
            if stopped.returncode != 0:
                print('WARNING: stop did not confirm clean exit', flush=True)
            try:
                daemon.wait(timeout=10)
            except subprocess.TimeoutExpired:
                daemon.terminate()
                daemon.wait(timeout=10)
            print('daemon exit', daemon.returncode, flush=True)
            print('Daemon log:\n' + logpath.read_text(), flush=True)
    print('Removed only this probe-owned temporary directory. Existing holds unchanged.', flush=True)
