"""Supplemental assertion messages only; never used to choose comparative runs."""
import gzip,json,os,pathlib,resource,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent;root=pathlib.Path(sys.argv[1]).resolve();dest=root/'exhaustive'
with gzip.open(HERE/'regression-inputs.json.gz','rt') as f:rows=json.load(f)
logs=[]
for row in rows:
    load=os.getloadavg();mem=int(next(s.split()[1] for s in pathlib.Path('/proc/meminfo').read_text().splitlines() if s.startswith('MemAvailable:')))
    if load[0]>=os.cpu_count() or mem<8*1024**2:print('HOST_GATE');raise SystemExit(75)
    for other in rows:(dest/other['paths'][0]).write_text(other['previous'][other['paths'][0]])
    path=row['paths'][0];(dest/path).write_text(row['next'][path])
    primary=json.loads((root/'results'/(row['id']+'-exhaustive.json')).read_text())
    files=[m['file'] for m in primary['edited']['modules'] if m['state']=='failed']
    assert files and set(files)<=set(json.loads((HERE/'declaration.json').read_text())['sample'])
    report=root/(row['id']+'-diagnostic.json');project=dest/'packages/contract'
    cmd=['/home/agent/.nvm/versions/node/v24.22.1/bin/node',str(dest/'node_modules/vitest/vitest.mjs'),'run',*map(lambda p:str(dest/p),files),
         '--root',str(project),'--config',str(project/'vitest.config.ts'),'--maxWorkers=1','--no-file-parallelism','--reporter=json','--outputFile',str(report)]
    env={'PATH':'/usr/bin:/bin','HOME':str(root/'exhaustive-home'),'TMPDIR':str(root/'exhaustive-tmp'),'XDG_CACHE_HOME':str(root/'exhaustive-cache'),'LANG':'C.UTF-8','TZ':'UTC','CI':'true','NODE_OPTIONS':'--max-old-space-size=2048'}
    before=resource.getrusage(resource.RUSAGE_CHILDREN);start=time.monotonic();proc=subprocess.run(cmd,env=env,cwd=project,capture_output=True,timeout=120);after=resource.getrusage(resource.RUSAGE_CHILDREN)
    result=json.loads(report.read_text())
    assert proc.returncode==1 and result['numFailedTests']>0
    logs.append({'id':row['id'],'command':cmd,'exit':proc.returncode,'cpuSeconds':after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,'wallSeconds':time.monotonic()-start,'load':load,'report':result,'stdout':proc.stdout.decode(),'stderr':proc.stderr.decode()})
    print(row['id'],result['numTotalTests'],result['numFailedTests'],flush=True)
with gzip.open(HERE/'failure-diagnostics.json.gz','wt') as f:json.dump(logs,f)
