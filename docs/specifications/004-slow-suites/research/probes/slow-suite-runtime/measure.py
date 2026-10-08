"""Throwaway Linux resource sampler; run only against the prepared private copies."""
import concurrent.futures, json, os, pathlib, subprocess, sys, time
ROOT = pathlib.Path(sys.argv[1]).resolve()
OUT = pathlib.Path(__file__).parent
NODE = subprocess.check_output(['which','node'],text=True).strip()

def run(name, copy, files=None, prefix=(), concurrency=None):
    repo=ROOT/copy
    tmp=ROOT/(copy+'-tmp');tmp.mkdir(exist_ok=True)
    env={k:os.environ[k] for k in ['PATH','HOME','USER','LANG','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS'] if k in os.environ}
    env.update(TMPDIR=str(tmp),TMP=str(tmp),TEMP=str(tmp),npm_config_cache=str(ROOT/'npm-cache'),NO_COLOR='1')
    if copy.startswith('sq'):
        cwd=repo
        cmd=[NODE,'node_modules/vitest/vitest.mjs','run',*(files or ['test/e2e']), '--reporter=json','--outputFile='+str(ROOT/(name+'.json'))]
        if concurrency:cmd+=['--maxWorkers='+str(concurrency)]
    else:
        cwd=repo/'packages/cezar'
        cmd=[NODE,'--import','../../scripts/test-git-env.mjs','--import','tsx','--test','--test-reporter=tap','--test-reporter-destination=stdout','--test-reporter='+str(ROOT/'sq-a/src/runners/node-test/runtime/reporter.mjs'),'--test-reporter-destination='+str(ROOT/(name+'-events.ndjson'))]
        if concurrency:cmd+=['--test-concurrency='+str(concurrency)]
        cmd+=files or [str(p.relative_to(cwd)) for p in sorted((cwd/'test/e2e').glob('*.test.ts'))]
    log=ROOT/(name+'.log'); timing=ROOT/(name+'.time')
    before=os.getloadavg(); start=time.monotonic()
    with log.open('w') as stream:
        p=subprocess.Popen(['/usr/bin/time','-f','%e %U %S %M','-o',str(timing),*prefix,*cmd],cwd=cwd,env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        peak=0;seen={p.pid};peak_count=0
        while p.poll() is None:
            procs={}
            for d in pathlib.Path('/proc').iterdir():
                if not d.name.isdigit():continue
                try:
                    fields=(d/'stat').read_text().rsplit(')',1)[1].split()
                    procs[int(d.name)]=(int(fields[1]),int(fields[21])*os.sysconf('SC_PAGE_SIZE'))
                except (OSError,ValueError,IndexError):pass
            owned={p.pid}
            while True:
                new={pid for pid,(parent,rss) in procs.items() if parent in owned}
                if new<=owned:break
                owned|=new
            seen|=owned
            alive=seen & procs.keys()
            peak=max(peak,sum(procs[pid][1] for pid in alive));peak_count=max(peak_count,len(alive))
            time.sleep(.1)
    result=dict(name=name,copy=copy,files=files or 'full',prefix=list(prefix),concurrency=concurrency,exit=p.returncode,wall_s=round(time.monotonic()-start,3),gnu_time=timing.read_text().strip(),peak_tree_rss_mib=round(peak/1024**2,1),peak_processes=peak_count,load_before=before,load_after=os.getloadavg())
    with (OUT/'measurements.ndjson').open('a') as f:f.write(json.dumps(result)+'\n')
    print(json.dumps(result),flush=True)
    return result

if __name__=='__main__':
    mode=sys.argv[2]
    if mode in ['baseline','baseline-sq','baseline-cz']:
        for copy in (['sq-a'] if mode=='baseline-sq' else ['cz-a'] if mode=='baseline-cz' else ['sq-a','cz-a']):
            run(copy+'-full',copy)
            cwd=ROOT/copy/('test/e2e' if copy.startswith('sq') else 'packages/cezar/test/e2e')
            for file in sorted(cwd.glob('*.test.ts')):run(copy+'-'+file.stem,copy,['test/e2e/'+file.name])
    elif mode=='pair':
        for suite in ['sq','cz']:
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                jobs=[pool.submit(run,suite+'-pair-'+suffix,suite+'-'+suffix,prefix=(['nice','-n','19'] if suffix=='b' else [])) for suffix in ['a','b']]
                for job in jobs:job.result()
    elif mode=='limits':
        for suite in ['sq','cz']:
            run(suite+'-serial',suite+'-a',concurrency=1)
            run(suite+'-nice',suite+'-a',prefix=['nice','-n','19','ionice','-c','3'])
            run(suite+'-affinity',suite+'-a',prefix=['taskset','-c',str(min(os.sched_getaffinity(0)))])
    elif mode=='cz-controls':
        run('cz-serial-fixed','cz-a',concurrency=1)
        run('cz-nice-fixed','cz-a',prefix=['nice','-n','19','ionice','-c','3'])
    elif mode=='quota':
        for suite in ['sq','cz']:
            run(suite+'-quota-2cpu',suite+'-a',prefix=['systemd-run','--user','--scope','-p','CPUQuota=200%'])
