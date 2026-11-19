import os,re,glob,collections,datetime
pat=re.compile(r'^(\S+Z) \[(\d+)\] squeal daemon: the store was busy for ([\d.]+) s.*?: (.*)$')
since=datetime.datetime(2026,11,14,20,0,tzinfo=datetime.timezone.utc)
end=datetime.datetime(2026,11,19,12,0,tzinfo=datetime.timezone.utc)
days=(end-since).total_seconds()/86400
for proj in ['squeal','cezar']:
    tot=0;n=0;what=collections.Counter(); xs=[]
    for f in glob.glob(os.path.expanduser(f'~/projects/{proj}/.git/squeal/logs/daemon-*.log*')):
        for line in open(f,errors='replace'):
            m=pat.match(line)
            if not m: continue
            t=datetime.datetime.fromisoformat(m.group(1).replace('Z','+00:00'))
            if t<since or t>end: continue
            s=float(m.group(3)); tot+=s; n+=1; xs.append(s)
            what[re.sub(r'\d+','N',m.group(4))[:40]]+=s
    xs.sort()
    print(proj,'busy episodes %d, %.1f h total, %.1f h/day; p50 %.1f p90 %.1f p99 %.1f s'%(n,tot/3600,tot/3600/days,xs[n//2],xs[int(n*.9)],xs[int(n*.99)]))
    for k,v in what.most_common(5): print('   %.1f h'%(v/3600),k)
