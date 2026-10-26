"""015-14 part B, D10: one arm of an A/B pair. A fresh reflink copy of the
0.1.349 clone with its own store and a scratch HOME, coverage off or on; a
daemon started with `squeal start`; then the fixed edit script, each edit
measured as the daemon's process-tree CPU from the edit to the verdict of
`squeal status --wait <path>` and on to quiet.
Usage: python3 -I ab.py <off|on> <arm label> <out.jsonl>"""
import json, os, shutil, subprocess, sys, threading, time

B = '/tmp/dogfood-015-14/w-327524f0'
mode, label, out = sys.argv[1], sys.argv[2], sys.argv[3]
root = f'{B}/runs/{label}-{mode}'
home = f'{root}.home'
CLK = os.sysconf('SC_CLK_TCK')


def load1():
    return float(open('/proc/loadavg').read().split()[0])


def snapshot():
    procs = {}
    for p in os.listdir('/proc'):
        if not p.isdigit():
            continue
        try:
            st = open(f'/proc/{p}/stat').read()
        except OSError:
            continue
        f = st[st.rfind(')') + 2:].split()
        procs[int(p)] = (int(f[1]), sum(int(x) for x in f[11:15]))
    return procs


def tree_cpu(pid):
    """utime + stime + cutime + cstime of `pid` and every live descendant, in seconds."""
    procs = snapshot()
    kids = {}
    for p, (pp, _) in procs.items():
        kids.setdefault(pp, []).append(p)
    total, todo, n = 0, [pid], 0
    while todo:
        p = todo.pop()
        if p in procs:
            total += procs[p][1]
            n += 1
        todo.extend(kids.get(p, []))
    return total / CLK, n


def run(*args, timeout=1200):
    t = time.time()
    r = subprocess.run(['node', f'{root}/plugins/claude-code/dist/cli/squeal.mjs', *args], cwd=root, env=env,
                       capture_output=True, text=True, timeout=timeout)
    return r, time.time() - t


def daemon_pid():
    for p in os.listdir('/proc'):
        if p.isdigit():
            try:
                cmd = open(f'/proc/{p}/cmdline', 'rb').read().split(b'\0')
            except OSError:
                continue
            if b'daemon' in cmd and root.encode() in cmd and any(c.endswith(b'squeal.mjs') for c in cmd):
                return int(p)
    return None


def quiet(pid, start_cpu, window=4.0, floor=0.08, limit=300):
    """Waits until the tree used under `floor` s of CPU in the last `window` s; returns (cpu, seconds)."""
    t0 = time.time()
    samples = [(t0, tree_cpu(pid)[0])]
    while time.time() - t0 < limit:
        time.sleep(0.5)
        samples.append((time.time(), tree_cpu(pid)[0]))
        old = [s for s in samples if s[0] <= samples[-1][0] - window]
        if old and samples[-1][1] - old[-1][1] < floor:
            return samples[-1][1] - start_cpu, samples[-1][0] - t0
    return samples[-1][1] - start_cpu, limit


shutil.rmtree(root, ignore_errors=True)
shutil.rmtree(home, ignore_errors=True)
subprocess.run(['cp', '-a', '--reflink=always', f'{B}/tmpl', root], check=True)
for d in ('', '/run', '/tmp', '/config', '/cache'):
    os.makedirs(home + d, exist_ok=True)
os.chmod(home + '/run', 0o700)
env = {**os.environ, 'HOME': home, 'XDG_RUNTIME_DIR': home + '/run', 'TMPDIR': home + '/tmp',
       'XDG_CONFIG_HOME': home + '/config', 'XDG_CACHE_HOME': home + '/cache'}
for k in [k for k in env if k.startswith(('SQUEAL', 'CLAUDE', 'CODEX', 'CEZ'))]:
    del env[k]
cfg_path = f'{root}/squeal.config.json'
cfg = json.load(open(cfg_path))
cfg['coverage'] = {'enabled': mode == 'on'}
open(cfg_path, 'w').write(json.dumps(cfg, indent=2) + '\n')
git = ['git', '-c', 'user.name=dogfood', '-c', 'user.email=d@x']
subprocess.run(git + ['commit', '-qam', f'coverage {mode}'], cwd=root, env=env, check=True)

rec = {'arm': label, 'mode': mode, 'root': root, 'load_start': load1(), 'at': time.strftime('%FT%TZ', time.gmtime())}
t0 = time.time()
r, _ = run('start', root)
pid = None
for _ in range(100):
    pid = daemon_pid()
    if pid:
        break
    time.sleep(0.2)
rec['pid'] = pid
r, waited = run('status', '--wait', '900000')
rec['start_wait_s'] = round(waited, 1)
cpu, q = quiet(pid, 0)
rec['start_cpu_s'] = round(tree_cpu(pid)[0], 2)
rec['start_wall_s'] = round(time.time() - t0, 1)
rec['edits'] = []
for e in json.load(open(f'{B}/bin/edits.json')):
    p = f'{root}/{e["path"]}'
    src = open(p).read()
    assert src.count(e['find']) == 1, e['name']
    before, _ = tree_cpu(pid)
    l0 = load1()
    t = time.time()
    open(p, 'w').write(src.replace(e['find'], e['replace']))
    r, waited = run('status', '--wait', '900000', e['path'])
    at_verdict, n = tree_cpu(pid)
    head = (r.stdout.strip().split('\n') or [''])[0][:200]
    settled, after = quiet(pid, before)
    rec['edits'].append({'name': e['name'], 'path': e['path'], 'load1': l0, 'exit': r.returncode, 'verdict': head,
                         'verdict_s': round(waited, 1), 'cpu_to_verdict_s': round(at_verdict - before, 2),
                         'cpu_to_quiet_s': round(settled, 2), 'quiet_after_verdict_s': round(after, 1),
                         'procs_at_verdict': n, 'load1_end': load1()})
    print(json.dumps(rec['edits'][-1]), flush=True)
r, _ = run('status', '--full')
rec['status_full'] = r.stdout[-6000:]
r, _ = run('code', '--json')
rec['code_json_bytes'] = len(r.stdout)
rec['code_head'] = r.stdout[:3000]
rec['load_end'] = load1()
rec['total_cpu_s'] = round(tree_cpu(pid)[0], 2)
run('stop', root)
for f in ('code.sqlite', 'store.sqlite'):
    path = f'{root}/.git/squeal/{f}'
    rec[f + '_bytes'] = os.path.getsize(path) if os.path.exists(path) else None
open(out, 'a').write(json.dumps(rec) + '\n')
print(json.dumps({k: v for k, v in rec.items() if k not in ('status_full', 'code_head', 'edits')}))
