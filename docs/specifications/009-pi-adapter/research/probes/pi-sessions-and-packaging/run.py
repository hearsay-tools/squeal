"""Throwaway probes. Run only as squeal-e2e with an empty environment. No network."""
import json, os, pathlib, subprocess, time, select, pty, signal, atexit

assert os.getuid() == 1002, 'must run as squeal-e2e'
ROOT = pathlib.Path('/home/squeal-e2e/pi-sessions-packaging-probe')
PI = '/home/squeal-e2e/.npm-global/bin/pi'
BASE = [PI, '--no-skills', '--no-prompt-templates', '--no-themes', '--provider', 'squeal-fake', '--model', 'scripted']
ENV = {**os.environ, 'PI_CODING_AGENT_DIR': str(ROOT / 'agent'), 'PI_OFFLINE': '1', 'PI_TELEMETRY': '0', 'PI_SKIP_VERSION_CHECK': '1'}
ROOT.mkdir(exist_ok=True)
results = {}
atexit.register(lambda: (ROOT/'results.json').write_text(json.dumps(results,indent=2)+'\n'))

def records(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

def env(name, **extra):
    log = ROOT / (name + '.jsonl')
    log.unlink(missing_ok=True)
    return {**ENV, 'PROBE_LOG': str(log), **extra}, log

def requests(log):
    return [r for r in records(log) if r['type'] == 'request']

def wait_for(predicate, timeout=8):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate(): return
        time.sleep(.02)
    raise AssertionError('wait timed out')

class Rpc:
    def __init__(self, name, extra=None, args=None, cwd=ROOT, extension=True):
        self.env, self.log = env(name, **(extra or {}))
        cmd = BASE + ['--mode', 'rpc'] + (['-e', str(ROOT/'package')] if extension else []) + (args or [])
        self.p = subprocess.Popen(cmd, cwd=cwd, env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.events, self.buffer, self.serial = [], b'', 0
        self.call('get_state')
    def drain(self, seconds=.1):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            ready, _, _=select.select([self.p.stdout], [], [], max(0, end-time.monotonic()))
            if not ready: break
            data=os.read(self.p.stdout.fileno(), 65536)
            if not data: break
            self.buffer+=data
            while b'\n' in self.buffer:
                line,self.buffer=self.buffer.split(b'\n',1)
                self.events.append(json.loads(line))
    def call(self, kind, **fields):
        self.serial+=1
        rid=str(self.serial)
        self.p.stdin.write((json.dumps({'id':rid,'type':kind,**fields})+'\n').encode()); self.p.stdin.flush()
        end=time.monotonic()+8
        while time.monotonic()<end:
            self.drain(.1)
            for ev in self.events:
                if ev.get('id')==rid and ev.get('type')=='response':
                    assert ev.get('success'), ev
                    return ev.get('data')
        raise AssertionError((kind,'response timeout',self.p.poll()))
    def close(self, how='eof'):
        if self.p.poll() is None:
            if how=='eof': self.p.stdin.close()
            else: self.p.send_signal(signal.SIGTERM if how=='term' else signal.SIGKILL)
        self.p.wait(timeout=8)
        self.drain(.05)
        err=self.p.stderr.read().decode()
        assert not err.strip(), err
        return self.p.returncode

# Local package installs through Pi's own commands into the isolated agent directory.
e, log=env('install')
proc=subprocess.run([PI, 'install', str(ROOT/'package')], cwd=ROOT, env=e, capture_output=True, text=True, timeout=15)
assert proc.returncode == 0, proc.stderr
settings=json.loads((ROOT/'agent/settings.json').read_text())
results['install']={'exit':proc.returncode,'packages':settings.get('packages'), 'stdout':proc.stdout.strip()}

for kind in ['custom-steer','custom-followUp','custom-silent','custom-nextTurn','user-steer','user-followUp']:
    r=Rpc('rpc-'+kind, {'PROBE_WAKE':kind}, extension=False)
    r.call('prompt', message='seed')
    r.drain(.65)
    before=len(requests(r.log))
    automatic=[x['type'] for x in r.events if x['type'] in ['agent_start','agent_settled']]
    if kind in ['custom-silent','custom-nextTurn']: r.call('prompt',message='manual-next'); r.drain(.15)
    req=requests(r.log)
    matches=[{'role':m['role'], 'content':m.get('content')} for m in req[-1]['messages'] if 'WAKE_' in json.dumps(m)]
    results['rpc-'+kind]={'before_manual_requests':before,'requests':len(req),'wake_messages_in_last_request':matches,'events_before_manual':automatic,'exit':r.close()}
    assert before == (1 if kind in ['custom-silent','custom-nextTurn'] else 2), (kind,before)
    assert matches, kind

# Print mode exits before the delayed wake; graceful exit still emits shutdown.
e, log=env('print', PROBE_WAKE='custom-steer', PROBE_DAEMON=str(ROOT/'print-child'))
p=subprocess.run(BASE+['-p','seed'],cwd=ROOT,env=e,capture_output=True,text=True,timeout=8)
results['print']={'exit':p.returncode,'output':p.stdout.strip(),'requests':len(requests(log)),'wake_fired':any(x['type']=='wake' for x in records(log)),'shutdown':any(x['type']=='session_shutdown' for x in records(log))}
assert p.returncode==0 and len(requests(log))==1

def child_check(name):
    pid=int((ROOT/(name+'.pid')).read_text())
    time.sleep(.15)
    alive=True
    try: os.kill(pid,0)
    except ProcessLookupError: alive=False
    # A heartbeat change rules out counting a zombie as alive.
    file=ROOT/name
    a=file.read_text() if file.exists() else None
    time.sleep(.2)
    b=file.read_text() if file.exists() else None
    if alive: os.kill(pid,signal.SIGTERM)
    return alive and a!=b
results['print']['detached_child_survived']=child_check('print-child')

for how in ['eof','term','kill']:
    r=Rpc('shutdown-'+how, {'PROBE_DAEMON':str(ROOT/('rpc-child-'+how))}, extension=False)
    wait_for(lambda:(ROOT/('rpc-child-'+how)).exists())
    rc=r.close(how)
    results['shutdown-'+how]={'exit':rc,'shutdown':[x['event'] for x in records(r.log) if x['type']=='session_shutdown'],'detached_child_survived':child_check('rpc-child-'+how)}

# A terminal-backed real TUI, provider scripted exactly as the RPC probe.
for kind in ['custom-steer','custom-followUp','custom-silent','custom-nextTurn','user-steer','user-followUp']:
    e,log=env('tui-'+kind,PROBE_WAKE=kind,TERM='xterm-256color',PROBE_DAEMON=str(ROOT/'tui-child'))
    master,slave=pty.openpty()
    p=subprocess.Popen(BASE+['seed'],cwd=ROOT,env=e,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
    os.close(slave)
    terminal=b''
    def pump(duration):
        global terminal
        end=time.monotonic()+duration
        while time.monotonic()<end:
            ready,_,_=select.select([master],[],[],.02)
            if ready:
                try: terminal+=os.read(master,65536)
                except OSError: break
    end=time.monotonic()+8
    while time.monotonic()<end and not any(x['type']=='wake' for x in records(log)): pump(.1)
    pump(.5)
    n=len(requests(log))
    os.write(master,b'\x04')
    pump(.5)
    if p.poll() is None:
        os.write(master,b'/quit\r');pump(.5)
    if p.poll() is None: p.terminate()
    p.wait(timeout=8);os.close(master)
    results['tui-'+kind]={'requests':n,'wake_messages_in_last_request':[{'role':m['role'],'content':m.get('content')} for m in requests(log)[-1]['messages'] if 'WAKE_' in json.dumps(m)],'shutdown':any(x['type']=='session_shutdown' for x in records(log)),'detached_child_survived':child_check('tui-child'),'custom_visible':'squeal-probe'.encode() in terminal,'exit':p.returncode}
    assert n==(1 if kind in ['custom-silent','custom-nextTurn'] else 2),(kind,n)

# Native shell session environment and PATH, using an actual fake-provider tool call.
e,log=env('bash',PROBE_BASH='1')
p=subprocess.run(BASE+['-p','shell probe'],cwd=ROOT,env=e,capture_output=True,text=True,timeout=8)
results['bash']={'exit':p.returncode,'toolResults':[m for m in requests(log)[-1]['messages'] if m['role']=='toolResult']}
assert p.returncode==0 and len(requests(log))==2

# Session continuity, compaction and in-process replacement.
settings['compaction']={'enabled':False,'reserveTokens':1000,'keepRecentTokens':1}
(ROOT/'agent/settings.json').write_text(json.dumps(settings))
r=Rpc('identity', extension=False, args=['--session-dir',str(ROOT/'sessions')])
r.call('prompt',message='first ' * 1000); r.drain(.15)
s1=r.call('get_state')
r.call('prompt',message='second'); r.drain(.15)
compacted=r.call('compact',customInstructions='Return brief fixture summary')
sc=r.call('get_state')
users=r.call('get_fork_messages')
entries=users['messages']
r.call('fork', entryId=entries[-1]['entryId']); sf=r.call('get_state')
r.call('new_session'); sn=r.call('get_state')
r.call('switch_session', sessionPath=s1['sessionFile']); ss=r.call('get_state')
results['identity']={'initial':s1['sessionId'],'compact':sc['sessionId'],'fork':sf['sessionId'],'new':sn['sessionId'],'switch_back':ss['sessionId'],'events':[{'type':x['type'],'session':x.get('session'),'factory':x.get('factory'),'event_reason':x.get('event',{}).get('reason')} for x in records(r.log) if x['type'].startswith('session_')], 'compacted':bool(compacted)}
r.close()
assert s1['sessionId']==sc['sessionId']==ss['sessionId'] and sf['sessionId']!=s1['sessionId'] and sn['sessionId']!=sf['sessionId']
for name,args in [('session',['--session',s1['sessionFile']]),('continue',['--continue']),('fork',['--fork',s1['sessionFile']])]:
    e,log=env('cli-'+name)
    p=subprocess.run(BASE+['-p','--session-dir',str(ROOT/'sessions'),*args,'continued'],cwd=ROOT,env=e,capture_output=True,text=True,timeout=8)
    starts=[x for x in records(log) if x['type']=='session_start']
    results['cli-'+name]={'exit':p.returncode,'session':starts[-1]['session'] if starts else None,'stderr':p.stderr.strip()}
    assert p.returncode==0,(name,p.stderr)
    assert (starts[-1]['session']==s1['sessionId']) == (name!='fork'),name

(ROOT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
