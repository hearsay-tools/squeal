"""Run only the declared experiment; pauses (exit 75) at a host gate, never polls."""
import argparse,base64,gzip,json,os,pathlib,resource,subprocess,tarfile,time
HERE=pathlib.Path(__file__).resolve().parent;SQUEAL=HERE.parents[5]
p=argparse.ArgumentParser();p.add_argument('scratch');p.add_argument('--only');p.add_argument('--regressions',action='store_true');p.add_argument('--repo',default='/home/agent/projects/cezar');a=p.parse_args();root=pathlib.Path(a.scratch).resolve()
d=json.loads((HERE/'declaration.json').read_text())
with gzip.open(HERE/'inputs.json.gz','rt') as f: rows=json.load(f)
source_rows=rows
def git(*args):return subprocess.check_output(['git','-C',a.repo,*args])
def gate():
    mem=int(next(s.split()[1] for s in pathlib.Path('/proc/meminfo').read_text().splitlines() if s.startswith('MemAvailable:')))*1024
    state={'load':os.getloadavg(),'availableBytes':mem,'cpus':os.cpu_count(),'at':time.time()}
    if state['load'][0]>=state['cpus'] or mem<8*1024**3:
        print('HOST_GATE '+json.dumps(state),flush=True);raise SystemExit(75)
    return state

def snapshot(dest,rev):
    # Drop tracked paths deleted since the initial snapshot. No live-tree commands mutate.
    present=set(git('ls-tree','-r','--name-only',rev).decode().splitlines())
    prior=set(git('ls-tree','-r','--name-only',d['pin']).decode().splitlines())
    for r in source_rows:
        for label in ['previousManifest','nextManifest']:
            prior.update(line.split('\t',1)[1] for line in r[label].splitlines())
    for path in prior-present:
        (dest/path).unlink(missing_ok=True)
    with subprocess.Popen(['git','-C',a.repo,'archive',rev],stdout=subprocess.PIPE) as proc:
        with tarfile.open(fileobj=proc.stdout,mode='r|') as arc:arc.extractall(dest,filter='data')
        assert proc.wait()==0

def edits(row):
    out={}
    for path in row['paths']:
        val=subprocess.run(['git','-C',a.repo,'show',row['commit']+':'+path],capture_output=True)
        out[path]=base64.b64encode(val.stdout).decode() if val.returncode==0 else None
    return out

if a.regressions:
    parent=d['pin'];paths=git('ls-tree','-r','--name-only',parent,'packages/contract').decode().splitlines()
    paths+=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vitest.config.ts']
    previous={p:git('show',parent+':'+p).decode() for p in paths}
    manifest=git('ls-tree','-r',parent).decode()
    rows=[]
    for m in d['deliberateRegressions']:
        assert previous[m['path']].count(m['before'])==1
        changed=previous[m['path']].replace(m['before'],m['after'])
        rows.append({'id':m['id'],'commit':'deliberate-'+m['id'],'parent':parent,'paths':[m['path']],
            'previous':previous,'next':{**previous,m['path']:changed},'previousManifest':manifest,'nextManifest':manifest,
            'edits':{m['path']:base64.b64encode(changed.encode()).decode()},'mutation':m})
    with gzip.open(HERE/'regression-inputs.json.gz','wt') as f:json.dump(rows,f)

(root/'results').mkdir(exist_ok=True)
for i,row in enumerate(rows):
    key=row.get('id',row['commit'][:9])
    if a.only and key!=a.only:continue
    order=['structural','file','exhaustive'] if i%2==0 else ['exhaustive','file','structural']
    # Alternate the extreme arms; file arm remains between them, so report that timing limit.
    for mode in order:
        output=root/'results'/f'{key}-{mode}.json'
        if output.exists():
            old=json.loads(output.read_text())
            if old.get('protocol')==2 and (old.get('edited') or old.get('baselineOk') is False):continue
            pilot=root/'pilot';pilot.mkdir(exist_ok=True)
            (pilot/output.name).write_text(output.read_text())
            process=root/'results'/f'{key}-{mode}-process.json'
            if process.exists():(pilot/process.name).write_text(process.read_text())
        host=gate();dest=root/mode
        started=time.monotonic();snapshot(dest,row['parent']);setupSeconds=time.monotonic()-started
        payload={k:v for k,v in row.items() if not k.endswith('Manifest')};payload['edits']=row.get('edits') or edits(row)
        inp=root/'input.json';inp.write_text(json.dumps(payload))
        env={'PATH':str(pathlib.Path('/home/agent/.nvm/versions/node/v24.22.1/bin'))+':/usr/bin:/bin',
             'HOME':str(root/(mode+'-home')),'TMPDIR':str(root/(mode+'-tmp')),
             'XDG_CACHE_HOME':str(root/(mode+'-cache')),'XDG_CONFIG_HOME':str(root/(mode+'-config')),'XDG_DATA_HOME':str(root/(mode+'-data')),
             'PROBE_NODE_MODULES':str(dest/'node_modules'),'LANG':'C.UTF-8','TZ':'UTC','NODE_OPTIONS':'--max-old-space-size=2048','CI':'true'}
        cmd=['/home/agent/.nvm/versions/node/v24.22.1/bin/node','--import',str(SQUEAL/'node_modules/tsx/dist/loader.mjs'),str(HERE/'arm.mjs'),str(dest),str(inp),mode,str(output)]
        before=resource.getrusage(resource.RUSAGE_CHILDREN);start=time.monotonic()
        proc=subprocess.run(cmd,env=env,cwd=dest,capture_output=True,timeout=300)
        after=resource.getrusage(resource.RUSAGE_CHILDREN)
        log={'command':cmd,'exit':proc.returncode,'stdout':proc.stdout.decode(errors='replace'),'stderr':proc.stderr.decode(errors='replace'),
             'host':host,'wallSeconds':time.monotonic()-start,'cpuSeconds':after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,'maxRssKiB':after.ru_maxrss,'snapshotSeconds':setupSeconds}
        (root/'results'/f'{key}-{mode}-process.json').write_text(json.dumps(log)+'\n')
        print(key,mode,proc.returncode,log['stdout'][-500:],log['stderr'][-1000:],flush=True)
        if proc.returncode:
            raise SystemExit(75 if 'HOST_GATE' in log['stderr'] else proc.returncode)
