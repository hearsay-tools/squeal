"""Throwaway terminal session-picker check; uses only this probe's own session."""
import json, os, pathlib, pty, select, shutil, subprocess, time
assert os.getuid()==1002
root=pathlib.Path('/home/squeal-e2e/pi-sessions-packaging-probe')
result=json.loads((root/'results.json').read_text())
original=result['identity']['initial']
source=next((root/'sessions').glob('*_'+original+'.jsonl'))
target=root/'resume-only';target.mkdir(exist_ok=True)
shutil.copy2(source,target/source.name)
log=root/'resume.jsonl';log.unlink(missing_ok=True)
master,slave=pty.openpty()
env={**os.environ,'TERM':'xterm-256color','PI_CODING_AGENT_DIR':str(root/'agent'),'PI_OFFLINE':'1','PI_TELEMETRY':'0','PI_SKIP_VERSION_CHECK':'1','PROBE_LOG':str(log)}
p=subprocess.Popen(['/home/squeal-e2e/.npm-global/bin/pi','--resume','--session-dir',str(target),'--provider','squeal-fake','--model','scripted'],cwd=root,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
os.close(slave)
terminal=bytearray()
def pump(seconds):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        ready,_,_=select.select([master],[],[],.02)
        if ready:
            try: terminal.extend(os.read(master,65536))
            except OSError: break
try:
    pump(2)
    os.write(master,b'\r')
    pump(2)
    entries=[json.loads(line) for line in log.read_text().splitlines()]
    starts=[x for x in entries if x['type']=='session_start']
    (root/'resume-terminal.txt').write_bytes(terminal)
    assert starts and starts[-1]['session']==original, starts
    os.write(master,b'\x04');pump(.5)
    p.wait(timeout=5)
    output={'exit':p.returncode,'selected':starts[-1]['session'],'original':original,'same':True}
    (root/'resume-results.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps(output))
finally:
    if p.poll() is None: p.terminate();p.wait(timeout=5)
    os.close(master)
