import os,re,glob,collections,datetime
pat=re.compile(r'^(\S+Z) \[(\d+)\] squeal daemon: (.*)$')
lw=re.compile(r'long write: (\S+) write lock held (\d+) ms')
since=datetime.datetime(2026,11,14,20,0,tzinfo=datetime.timezone.utc)
end=datetime.datetime(2026,11,19,12,0,tzinfo=datetime.timezone.utc)
days=(end-since).total_seconds()/86400
for proj in ['squeal','cezar']:
    ev=collections.defaultdict(list)
    for f in glob.glob(os.path.expanduser(f'~/projects/{proj}/.git/squeal/logs/daemon-*.log*')):
        wt=f.split('daemon-')[1][:16]
        for line in open(f,errors='replace'):
            m=pat.match(line)
            if not m: continue
            t=datetime.datetime.fromisoformat(m.group(1).replace('Z','+00:00'))
            if t<since or t>end: continue
            ev[(wt,m.group(2))].append((t,m.group(3)))
    srv=[]  # (wt, start, stop, early held ms)
    for (wt,pid),es in ev.items():
        es.sort()
        s=[t for t,m in es if m.startswith('serving ')]
        if not s: continue
        t0=es[0][0]
        eh=sum(int(lw.match(m).group(2)) for t,m in es if lw.match(m) and (t-t0).total_seconds()<300)
        srv.append((wt,t0,es[-1][0],eh))
    srv.sort(key=lambda x:(x[0],x[1]))
    restarts=0; gaps=[]; reh=0; alleh=0
    for i,x in enumerate(srv):
        alleh+=x[3]
        if i and srv[i-1][0]==x[0]:
            g=(x[1]-srv[i-1][2]).total_seconds(); gaps.append(g)
            if g<600: restarts+=1; reh+=x[3]
    gaps.sort()
    print(proj,'serving daemons %d (%.0f/day), worktrees %d; starts within 10 min of the same worktree\'s previous daemon end: %d (%.0f%%); gap p50 %.0f s'%(len(srv),len(srv)/days,len(set(x[0] for x in srv)),restarts,100*restarts/len(srv),gaps[len(gaps)//2]))
    print('   long-write held in first 5 min: all %.0f s, of restarts %.0f s'%(alleh/1000,reh/1000))
