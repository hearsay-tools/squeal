#!/usr/bin/env python3
"""Throwaway issue 130 probe. Owns only its temporary fixture and daemon."""
import json, os, pathlib, signal, socket, sqlite3, subprocess, sys, tempfile, time

cli = str(pathlib.Path(sys.argv[1]).resolve())
modules = str(pathlib.Path(sys.argv[2]).resolve())
wait_ms = int(sys.argv[3]) if len(sys.argv) > 3 else 60000
load = os.getloadavg()
cpus = os.cpu_count()
print(json.dumps({'load': load, 'cpus': cpus, 'cli': cli, 'node': subprocess.check_output(['node', '--version'], text=True).strip()}), flush=True)
if load[0] > cpus:
    sys.exit('SKIP: load exceeds CPUs')
with tempfile.TemporaryDirectory(prefix='issue130-') as temp:
    base = pathlib.Path(temp)
    root = base / 'repo'
    root.mkdir()
    (root / 'test').mkdir()
    runtime = base / 'run'
    runtime.mkdir(mode=0o700)
    env = dict(os.environ)
    env['XDG_RUNTIME_DIR'] = str(runtime)
    for name in ('CEZ_TASK_ID', 'CEZ_HANDOFF_FILE', 'SQUEAL_COMMAND'):
        env.pop(name, None)
    (root / 'package.json').write_text('{"name":"issue130-fixture","private":true,"type":"module"}\n')
    (root / '.gitignore').write_text('node_modules\n')
    (root / 'node_modules').symlink_to(modules, target_is_directory=True)
    (root / 'test/one.test.js').write_text('import { test, expect } from "vitest";\ntest("one", () => expect(1).toBe(1));\n')
    for args in (['init', '-q'], ['config', 'user.email', 'probe@example.invalid'], ['config', 'user.name', 'Probe'], ['add', 'package.json', '.gitignore', 'test/one.test.js'], ['commit', '-qm', 'fixture']):
        subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
    def cli_run(args):
        start = time.monotonic()
        p = subprocess.run(['node', '--disable-warning=ExperimentalWarning', cli, *args], cwd=root, env=env, capture_output=True, text=True, timeout=wait_ms/1000+20)
        return {'command': ['node', cli, *args], 'exit': p.returncode, 'seconds': round(time.monotonic()-start, 3), 'stdout': p.stdout, 'stderr': p.stderr}
    def emit(label, value):
        print(json.dumps({'case': label, **value}), flush=True)
    def request(path, payload):
        accepted = False
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(2)
            try:
                client.connect(path)
                accepted = True
                client.sendall((json.dumps(payload)+'\n').encode())
                data = b''
                while b'\n' not in data:
                    chunk = client.recv(65536)
                    if not chunk: break
                    data += chunk
                return {'accepted': accepted, 'reply': data.decode()}
            except (TimeoutError, OSError) as error:
                return {'accepted': accepted, 'error': str(error)}
    emit('version', cli_run(['--version']))
    log = open(base / 'daemon.err', 'w+')
    daemon = subprocess.Popen(['node', '--disable-warning=ExperimentalWarning', cli, 'daemon', str(root)], cwd=root, env=env, stdout=log, stderr=log, start_new_session=True)
    db = None
    try:
        for _ in range(60):
            result = cli_run(['status', '--json'])
            try:
                status = json.loads(result['stdout'])
                if status.get('testFilesListed') is True:
                    break
            except json.JSONDecodeError: pass
            time.sleep(1)
        emit('baseline-snapshot', result)
        baseline = cli_run(['status', '--wait', str(max(wait_ms, 30000)), 'test/one.test.js', '--json'])
        emit('baseline-wait', baseline)
        assert baseline['exit'] == 0, 'baseline must pass before stalling'
        db = sqlite3.connect(root / '.git/squeal/store.sqlite', timeout=5)
        sock, interval = db.execute('SELECT daemon_socket, daemon_heartbeat_interval_ms FROM worktrees').fetchone()
        emit('live-ping', request(sock, {'type': 'ping'}))
        daemon.send_signal(signal.SIGSTOP)
        time.sleep(interval*2/1000 + 1)
        emit('stopped-ping', request(sock, {'type': 'ping'}))
        emit('stopped-sync', request(sock, {'type': 'sync'}))
        emit('stopped-wait', cli_run(['status', '--wait', str(wait_ms), 'test/one.test.js', '--json']))
        daemon.send_signal(signal.SIGCONT)
        time.sleep(interval/1000 + 1)
        emit('recovered-wait', cli_run(['status', '--wait', str(wait_ms), 'test/one.test.js', '--json']))
        # Force only the isolated fixture's heartbeat timestamp to stay old.
        # This separates the heartbeat rule from a stalled socket or sync pass.
        old = int(time.time()*1000) - 30000
        db.execute('UPDATE worktrees SET daemon_heartbeat_at = ?', (old,))
        db.execute(f'''CREATE TRIGGER probe_freeze_heartbeat AFTER UPDATE OF daemon_heartbeat_at ON worktrees
          WHEN NEW.daemon_heartbeat_at != {old}
          BEGIN UPDATE worktrees SET daemon_heartbeat_at = {old} WHERE id = NEW.id; END''')
        db.commit()
        emit('forced-stale-ping', request(sock, {'type': 'ping'}))
        sync = request(sock, {'type': 'sync'})
        emit('forced-stale-sync', sync)
        answer = json.loads(sync['reply'])
        if 'requestId' in answer:
            time.sleep(1)
            emit('forced-stale-sync-status', request(sock, {'type': 'sync-status', 'requestId': answer['requestId']}))
        emit('forced-stale-wait', cli_run(['status', '--wait', str(wait_ms), 'test/one.test.js', '--json']))
        emit('forced-stale-text', cli_run(['status', '--wait', '3000', 'test/one.test.js']))
        db.execute('DROP TRIGGER probe_freeze_heartbeat')
        db.commit()
        time.sleep(interval/1000 + 1)
        emit('final-wait', cli_run(['status', '--wait', str(wait_ms), 'test/one.test.js', '--json']))
    finally:
        if db: db.close()
        if daemon.poll() is None:
            os.killpg(daemon.pid, signal.SIGCONT)
            os.killpg(daemon.pid, signal.SIGTERM)
            try: daemon.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(daemon.pid, signal.SIGKILL)
                daemon.wait()
        log.seek(0)
        emit('cleanup', {'daemonExit': daemon.returncode, 'daemonLog': log.read(), 'load': os.getloadavg(), 'fixtureRemovedOnExit': temp})
        log.close()
