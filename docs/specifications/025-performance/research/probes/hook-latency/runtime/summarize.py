"""Throwaway reducer: keep SQL/fs detail and syscall/profile evidence, omit stdin payloads."""
import collections, json, pathlib, re, shutil, sys
source, dest = map(pathlib.Path, sys.argv[1:])
dest.mkdir(parents=True, exist_ok=True)
ansi = re.compile(r'\x1b\[[0-9;]*[mK]')
for path in source.rglob('*'):
    if not path.is_file(): continue
    rel = path.relative_to(source)
    if path.suffix in ('.log', '.txt') or path.name == 'startup.json':
        out=dest/rel; out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(ansi.sub('',path.read_text()).replace('/home/user','<sandbox-home>').rstrip()+'\n')
rows=[]
for path in sorted(source.rglob('*.strace')):
    lines=path.read_text().splitlines(); counts=collections.Counter(); waits=[]
    for line in lines:
        m=re.match(r'\d+ +[\d:.]+ +(\w+)\(',line)
        if m: counts[m[1]]+=1
        if ('epoll_' in line or 'futex(' in line or 'clock_nanosleep(' in line) and '<' in line:
            t=re.search(r'<([\d.]+)>$',line)
            if t: waits.append(float(t[1])*1000)
    detail=json.loads(path.with_suffix('.json').read_text())
    profile=path.with_suffix('.cpuprofile')
    cpu=collections.Counter()
    if profile.exists():
        p=json.loads(profile.read_text()); nodes={n['id']:n['callFrame'] for n in p['nodes']}
        for sample,delta in zip(p.get('samples',[]),p.get('timeDeltas',[])):
            frame=nodes[sample];cpu[frame['functionName']+' '+frame['url'].replace('/home/user','<sandbox-home>')]+=delta/1000
    rows.append({'file':str(path.relative_to(source)), 'sqlCalls':sum(detail['sql'].values()),
      'sql':detail['sql'], 'fs':{k.replace('/home/user','<sandbox-home>'):v for k,v in detail['fs'].items()},
      'syscalls':counts, 'waitSyscallMaxMs':max(waits,default=0),
      'storeOpens':sum('openat(' in l and 'store.sqlite"' in l and ' = -1' not in l for l in lines),
      'connects':[l for l in lines if 'connect(' in l],
      'execs':[l.replace('/home/user','<sandbox-home>') for l in lines if 'execve(' in l],
      'cpuSelfMs':cpu.most_common(15),
      'instrumentedAfterLoadMs':detail.get('exitAtMs',0)-detail.get('loadedAtMs',0)})
(dest/'trace-summary.json').write_text(json.dumps(rows,indent=2)+'\n')
for path in source.rglob('*.strace-c'):
    out=dest/path.relative_to(source);out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,out)
# Phase samples retain all rounds. SessionStart first has one untimed registration;
# following 20-sample blocks are the normal case then the spawn case's rounds.
import math
phase=[]
for version in ('364','600','main'):
    for hook in ('session-start','pre-tool-use','post-tool-batch','stop','user-prompt-submit','session-end','waiter'):
        files=sorted((source/version/'phase').glob(hook+'.mjs-*.json'))
        if hook=='session-start': files=files[1:]
        for i in range(0,len(files),20):
            samples=[json.loads(p.read_text())['afterLoadMs'] for p in files[i:i+20]]
            ordered=sorted(samples)
            phase.append({'version':version,'hook':hook,'case':i//20,'n':len(samples),
              'p50':ordered[len(samples)//2],'p95':ordered[math.ceil(len(samples)*.95)-1],'samples':samples})
(dest/'phase-summary.json').write_text(json.dumps(phase,indent=2)+'\n')
if (source/'startup-with-proxy.json').exists():
    shutil.copyfile(source/'startup-with-proxy.json',dest/'startup-with-proxy.json')
