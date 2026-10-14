"""Throwaway local-package and trust matrix, only under the isolated test account."""
import os, json, pathlib, subprocess
assert os.getuid() == 1002
ROOT=pathlib.Path('/home/squeal-e2e/pi-sessions-packaging-probe')
PI='/home/squeal-e2e/.npm-global/bin/pi'
ENV={**os.environ,'PI_CODING_AGENT_DIR':str(ROOT/'agent'),'PI_OFFLINE':'1','PI_TELEMETRY':'0','PI_SKIP_VERSION_CHECK':'1'}
project=ROOT/'project'; project.mkdir(exist_ok=True)
marker=ROOT/'marker-package';marker.mkdir(exist_ok=True)
(marker/'package.json').write_text(json.dumps({'name':'marker-probe','version':'0.0.0','type':'module','pi':{'extensions':['./marker.mjs']}}))
code="import {appendFileSync} from 'node:fs'; export default pi => { pi.on('session_start', () => appendFileSync(process.env.PROBE_MARKER, 'loaded\\n')); };"
(marker/'marker.mjs').write_text(code)
results={}
def call(name,args,cwd=project):
    log=ROOT/(name+'.jsonl'); log.unlink(missing_ok=True)
    seen=ROOT/(name+'.marker'); seen.unlink(missing_ok=True)
    p=subprocess.run([PI,*args],cwd=cwd,env={**ENV,'PROBE_LOG':str(log),'PROBE_MARKER':str(seen)},capture_output=True,text=True,timeout=8)
    assert p.returncode==0,(name,p.stderr)
    results[name]={'exit':p.returncode,'marker_loaded':seen.exists(),'output':p.stdout.strip()}
    return p
call('local-install',['install',str(marker),'-l','--approve'])
results['local-install']['settings']=json.loads((project/'.pi/settings.json').read_text())
base=['-p','--provider','squeal-fake','--model','scripted','seed']
for name,flags in [('trust-default',[]),('trust-refused',['--no-approve']),('trust-approved',['--approve'])]:
    call(name,flags+base)
assert not results['trust-default']['marker_loaded'] and not results['trust-refused']['marker_loaded'] and results['trust-approved']['marker_loaded']
call('local-remove',['remove',str(marker),'-l','--approve'])
# Automatic extension directory discovery does not recognize .mjs by itself.
extensions=ROOT/'agent/extensions';extensions.mkdir(exist_ok=True)
(extensions/'implicit.mjs').write_text(code)
call('implicit-mjs',base,cwd=ROOT)
(extensions/'implicit.mjs').rename(extensions/'implicit.js')
call('implicit-js',base,cwd=ROOT)
(extensions/'implicit.js').unlink()
assert not results['implicit-mjs']['marker_loaded'] and results['implicit-js']['marker_loaded']
(ROOT/'packaging-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
