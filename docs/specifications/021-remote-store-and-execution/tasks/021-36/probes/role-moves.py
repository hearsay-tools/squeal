# Row 021-36: how often would a clone-wide writer role move if the holder keeps it until exit?
# Read-only: parses daemon logs (parsing as in 021-34/probes/restarts.py) and reads /proc cmdlines.
import os,re,glob,collections,datetime,sys
pat=re.compile(r'^(\S+Z) \[(\d+)\] squeal daemon: (.*)$')
UTC=datetime.timezone.utc
since=datetime.datetime(2026,11,14,20,0,tzinfo=UTC)
mode=sys.argv[1] if len(sys.argv)>1 else 'last'   # 'last': unlogged end = last line; 'next': = next start in that worktree, at most 30 min after the last line
def alive(pid):
    try: return b'squeal' in open(f'/proc/{pid}/cmdline','rb').read()
    except OSError: return False
def pct(xs,q): xs=sorted(xs); return xs[min(len(xs)-1,int(q*len(xs)))] if xs else float('nan')
for proj in ['squeal','cezar']:
    ev=collections.defaultdict(list)
    for f in glob.glob(os.path.expanduser(f'~/projects/{proj}/.git/squeal/logs/daemon-*.log*')):
        wt=f.split('daemon-')[1][:16]
        for line in open(f,errors='replace'):
            m=pat.match(line)
            if m: ev[(wt,m.group(2))].append((datetime.datetime.fromisoformat(m.group(1).replace('Z','+00:00')),m.group(3)))
    end=max(t for es in ev.values() for t,_ in es)
    lives=[]  # [wt,start,end,kind]
    for (wt,pid),es in ev.items():
        es.sort(); cur=None
        for t,m in es:
            if m.startswith('serving '):
                if cur: lives.append(cur)
                cur=[wt,t,t,'unlogged',pid]
            elif cur:
                cur[2]=t
                if m.startswith('daemon stopped'): cur[3]='stopped'
        if cur: lives.append(cur)
    lastof={}
    for L in lives:
        if L[0] not in lastof or L[1]>lastof[L[0]][1]: lastof[L[0]]=L
    for L in lives:
        if L[3]=='unlogged' and lastof[L[0]] is L and alive(L[4]): L[3]='live'; L[2]=end
    if mode=='next':
        bywt=collections.defaultdict(list)
        for L in lives: bywt[L[0]].append(L)
        for ls in bywt.values():
            ls.sort(key=lambda L:L[1])
            for a,b in zip(ls,ls[1:]+[None]):
                if a[3]=='unlogged': a[2]=min(b[1] if b else end,a[2]+datetime.timedelta(minutes=30))
    lives=[L for L in lives if L[2]>=since and L[1]<=end]
    kinds=collections.Counter(L[3] for L in lives)
    if '-v' in sys.argv:
        for L in sorted(lives,key=lambda L:L[1]):
            if L[3]!='stopped' or (L[2]-L[1]).total_seconds()>6*3600: print('  ',L[0][:6],L[3],f'{L[1]:%m-%dT%H:%M}',f'{L[2]:%m-%dT%H:%M}')
    # sweep: ends before starts at equal times
    evs=sorted([(max(L[1],since),1,i) for i,L in enumerate(lives)]+[(L[2],0,i) for i,L in enumerate(lives)])
    live=set(i for i,L in enumerate(lives) if L[1]<=since<=L[2])
    holder=min(live,key=lambda i:lives[i][1]) if live else None; held_from=since; empty_from=None if live else since
    done=set(); hand=[];into=[];gaps=[];ten=[];day=collections.defaultdict(lambda:[0,0,0,0,0,0])
    for t,k,i in evs:
        if t<since: continue
        if k==1:
            if i in live or i in done: continue
            live.add(i)
            if holder is None:
                holder=i; held_from=t; into.append(t); d=day[t.date()]; d[1]+=1
                if empty_from is not None and empty_from>since:
                    g=(t-empty_from).total_seconds(); gaps.append(g)
                    d[2 if g<180 else 3 if g<300 else 4 if g<600 else 5]+=1
                empty_from=None
        else:
            done.add(i); live.discard(i)
            if i==holder:
                ten.append((t-held_from).total_seconds())
                if live:
                    holder=min(live,key=lambda j:lives[j][1]); held_from=t; hand.append(t); day[t.date()][0]+=1
                else: holder=None; empty_from=t
    days=(end-since).total_seconds()/86400
    print(f'== {proj}: window {since:%Y-%m-%dT%H:%MZ} .. {end:%Y-%m-%dT%H:%MZ} ({days:.2f} d); serving lives {len(lives)} {dict(kinds)}; worktrees {len(set(L[0] for L in lives))}; mode {mode}')
    print(f'moves {len(hand)+len(into)} ({(len(hand)+len(into))/days:.1f}/d): handover {len(hand)} ({len(hand)/days:.1f}/d), into empty {len(into)} ({len(into)/days:.1f}/d)')
    print(f'tenure (closed, n={len(ten)}) p50 {pct(ten,.5)/60:.1f} min p90 {pct(ten,.9)/60:.1f} min max {max(ten)/3600:.1f} h; open at end: {holder is not None}')
    print(f'empty gaps {len(gaps)}: <3m {sum(g<180 for g in gaps)}, <5m {sum(g<300 for g in gaps)}, <10m {sum(g<600 for g in gaps)}, >=10m {sum(g>=600 for g in gaps)}; gap p50 {pct(gaps,.5)/60:.1f} min p90 {pct(gaps,.9)/60:.1f} min')
    print('day        handover into  gap<3 3-5 5-10 >=10')
    for d0 in sorted(day): print(d0,*('%5d'%x for x in day[d0]))
