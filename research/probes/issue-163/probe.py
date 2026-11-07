#!/usr/bin/env python3
"""Throwaway issue-163 lifecycle probe. Only its new temporary repos are touched."""
import datetime, json, os, pathlib, shutil, signal, sqlite3, subprocess, sys, tempfile, time

REPO = pathlib.Path(__file__).resolve().parents[3]
NODE = '/home/agent/.nvm/versions/node/v24.22.1/bin/node'
CLI = str(REPO / 'plugins/claude-code/dist/cli/squeal.mjs')
BASE = [NODE, '--disable-warning=ExperimentalWarning', CLI]

def emit(kind, **data):
    print(json.dumps(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(), kind=kind, **data)), flush=True)

def run(args, cwd, env):
    p = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=40)
    emit('command', cwd=str(cwd), argv=args, code=p.returncode, stdout=p.stdout, stderr=p.stderr)
    return p

def snapshot(db):
    with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as con:
        con.row_factory = sqlite3.Row
        emit('store', consumers=[dict(r) for r in con.execute('select * from consumers')],
             worktrees=[dict(r) for r in con.execute('select * from worktrees')],
             notes=[dict(r) for r in con.execute("select * from meta where key like '%notes%' or key like '%departure%'")])

def case(name, minutes, pause):
    load = os.getloadavg()[0]
    cpus = len(os.sched_getaffinity(0))
    emit('load-gate', case=name, load1=load, cpus=cpus)
    if load > cpus:
        emit('skipped', case=name, reason='one-minute load above CPU count')
        return
    scratch = pathlib.Path(tempfile.mkdtemp(prefix='squeal-issue-163-'))
    main, root = scratch/'main', scratch/'linked'
    main.mkdir()
    runtime, config = scratch/'runtime', scratch/'config'
    runtime.mkdir(mode=0o700); config.mkdir()
    # Keep credentials in the inherited environment; never print the environment.
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(('SQUEAL_', 'CODEX_')) or key in ('CLAUDE_SESSION_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID'):
            env.pop(key)
    env.update(XDG_RUNTIME_DIR=str(runtime), XDG_CONFIG_HOME=str(config), PI_SESSION_ID='issue-163-cli-only')
    policy = dict(nodeTest=[dict(name='tiny', include=['tiny.test.mjs'], argv=[], env={})],
                  baseline=dict(onStart='lookup-only'), complexity=dict(enabled=False), coverage=dict(enabled=False))
    if minutes is not None:
        policy['daemon'] = dict(idleExitMinutes=minutes)
    (main/'squeal.config.json').write_text(json.dumps(policy)+'\n')
    (main/'package.json').write_text('{"type":"module","private":true}\n')
    (main/'tiny.test.mjs').write_text("import { test } from 'node:test'; test('tiny', () => {});\n")
    emit('fixture', case=name, policy=policy, pi_session_id=env['PI_SESSION_ID'], runtime=str(runtime), config=str(config))
    run(['git', 'init', '-q', str(main)], main, env)
    run(['git', 'add', 'squeal.config.json', 'package.json', 'tiny.test.mjs'], main, env)
    run(['git', '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'throwaway fixture'], main, env)
    run(['git', 'worktree', 'add', '-qb', 'probe', str(root)], main, env)
    run(BASE+['--version'], root, env)
    logpath = scratch/'daemon.log'
    child = None
    try:
        with logpath.open('w') as log:
            child = subprocess.Popen(BASE+['daemon', str(root)], cwd=root, env=env, stdout=log, stderr=log)
            emit('spawn', argv=BASE+['daemon', str(root)], pid=child.pid)
            db = main/'.git/squeal/store.sqlite'
            deadline = time.monotonic()+30
            while time.monotonic() < deadline:
                if child.poll() is not None: break
                if db.exists():
                    try:
                        with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as con:
                            if con.execute('select daemon_heartbeat_at from worktrees where daemon_socket is not null').fetchone(): break
                    except sqlite3.Error: pass
                time.sleep(.1)
            run(BASE+['status'], root, env)
            run(BASE+['status', '--json'], root, env)
            snapshot(db)
            emit('quiet-begin', seconds=pause, child_code=child.poll())
            time.sleep(pause)
            emit('quiet-end', child_code=child.poll(), load1=os.getloadavg()[0])
            run(BASE+['status'], root, env)
            run(BASE+['status', '--json'], root, env)
            snapshot(db)
            run(BASE+['status', '--full'], root, env)
            run(['git', 'status', '--porcelain'], root, env)
            if child.poll() is None:
                emit('cleanup-signal', signal='SIGTERM', pid=child.pid, after_observation=True)
                child.send_signal(signal.SIGTERM)
                child.wait(timeout=30)
                run(BASE+['status'], root, env)
                snapshot(db)
            emit('exit', code=child.poll())
        emit('daemon-log', text=logpath.read_text())
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait(timeout=30)
        shutil.rmtree(scratch)
        emit('cleanup', removed=str(scratch))

if '--short-only' not in sys.argv:
    case('default-no-consumer-130s', None, 130)
case('artificial-idle-3s', .05, 8)
