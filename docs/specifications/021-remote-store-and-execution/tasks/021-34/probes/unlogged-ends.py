import os,re,glob,collections,datetime
pat=re.compile(r'^(\S+Z) \[(\d+)\] squeal daemon: (.*)$')
since=datetime.datetime(2026,11,14,20,0,tzinfo=datetime.timezone.utc)
end=datetime.datetime(2026,11,19,12,0,tzinfo=datetime.timezone.utc)
alive=set(p[6:] for p in glob.glob('/proc/[0-9]*'))
for proj in ['squeal','cezar']:
    ev=collections.defaultdict(list)
    for f in glob.glob(os.path.expanduser(f'~/projects/{proj}/.git/squeal/logs/daemon-*.log*')):
        for line in open(f,errors='replace'):
            m=pat.match(line)
            if not m: continue
            t=datetime.datetime.fromisoformat(m.group(1).replace('Z','+00:00'))
            if t<since or t>end: continue
            ev[(f,m.group(2))].append((t,m.group(3)))
    byp=collections.defaultdict(list)
    for (f,pid),es in ev.items(): byp[(f.split('daemon-')[1][:16],pid)]+=es
    noend=0; serv=0; lastmsg=collections.Counter(); hb=0
    for (wt,pid),es in byp.items():
        es.sort()
        if not any(m.startswith('serving ') for t,m in es): continue
        serv+=1
        for t,m in es:
            mm=re.match(r'the store was busy for ([\d.]+) s.*the heartbeat',m)
            if mm and float(mm.group(1))>=30: hb+=1
        if pid in alive: continue
        if not any(m.startswith('daemon stopped') or 'stopping' in m for t,m in es):
            noend+=1; lastmsg[re.sub(r'\d+','N',es[-1][1])[:60]]+=1
    print(proj,'serving',serv,'ended with no stop line',noend,'heartbeat busy>=30s',hb)
    for k,v in lastmsg.most_common(5): print('   ',v,k)
