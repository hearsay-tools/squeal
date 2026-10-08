"""Throwaway real-file edit during a run; compare finish/discard with scope cancellation.
Uses a freshly named owned systemd scope per run so detached fixture daemons
are killed with their owner. Never targets a pre-existing scope or process.
"""
import json,os,pathlib,subprocess,sys,time,uuid,hashlib
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(__file__).parent
node=subprocess.check_output(['which','node'],text=True).strip()
results=[]
for copy,file in [('sq-b','shipped-plugin.test.ts'),('cz-b','application-update.test.ts')]:
    cwd=root/copy/('' if copy.startswith('sq') else 'packages/cezar')
    path=cwd/'test/e2e'/file;original=path.read_text()
    def command():
        if copy.startswith('sq'):return [node,'node_modules/vitest/vitest.mjs','run','test/e2e/'+file,'--reporter=dot']
        return [node,'--import','../../scripts/test-git-env.mjs','--import','tsx','--test','test/e2e/'+file]
    def trial(label,edit=False,cancel=False):
        unit='sqr-'+uuid.uuid4().hex
        env={k:os.environ[k] for k in ['PATH','HOME','USER','LANG','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS'] if k in os.environ}
        env.update(TMPDIR=str(root/(copy+'-tmp')),npm_config_cache=str(root/'npm-cache'))
        log=(root/(copy+'-'+label+'.log')).open('w');before=hashlib.sha256(path.read_bytes()).hexdigest();start=time.monotonic()
        child=subprocess.Popen(['systemd-run','--user','--scope','--unit='+unit,*command()],cwd=cwd,env=env,stdout=log,stderr=log)
        stopped=None
        if edit:
            time.sleep(3)
            if child.poll() is not None:raise RuntimeError('File completed before planned edit')
            path.write_text(original+'\n// slow-suite-runtime harmless revision '+label+'\n')
            if cancel:
                t=time.monotonic()
                subprocess.run(['systemctl','--user','stop',unit+'.scope'],check=True,capture_output=True)
                stopped=time.monotonic()-t
        try:code=child.wait(timeout=240)
        finally:
            if child.poll() is None:subprocess.run(['systemctl','--user','stop',unit+'.scope'],check=True,capture_output=True);child.wait(timeout=10)
        elapsed=time.monotonic()-start
        result=dict(copy=copy,file=file,label=label,edit_at_s=3 if edit else None,cancel=cancel,exit=code,wall_s=round(elapsed,3),stop_s=round(stopped,3) if stopped else None,input_changed=before!=hashlib.sha256(path.read_bytes()).hexdigest())
        results.append(result);print(json.dumps(result),flush=True)
    try:
        trial('finish-discard',edit=True);trial('finish-retry')
        trial('cancel',edit=True,cancel=True);trial('cancel-retry')
    finally:path.write_text(original)
(out/'interruption.json').write_text(json.dumps(results,indent=2)+'\n')
