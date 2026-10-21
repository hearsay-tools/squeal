#!/usr/bin/env python3
"""011-84 probe: the four drains `014-ps/research/should-not-be-up.md` 2 saw at 08:22:38Z.

Read-only: the cezar store opened `mode=ro`. A removed worktree keeps its runs
and results, not its notes, so each window is [departure, departure + 60 min],
the departure taken from the scan's "last consumer left N min ago". The
worktree id is sha256 of the root, first 16 hex (`worktreeIdFor`).
Usage: python3 -I drains-0822.py > drains-0822-<time>.txt
"""
import sqlite3,hashlib,json,fnmatch,calendar,time
db=sqlite3.connect('file:/home/agent/projects/cezar/.git/squeal/store.sqlite?mode=ro',uri=True,timeout=5)
db.execute('begin')
scan=calendar.timegm(time.strptime('2026-10-21T08:22:38','%Y-%m-%dT%H:%M:%S'))
print('load', open('/proc/loadavg').read().split()[:3])
for root,ago in [('7c144ff7-78b9-47e7-b70c-401220d1d97f',13.4),('6a5e5c80-692a-436f-9d14-3acf238bb50e',42.1),('25bebea2-6e4f-492b-81d8-315ce7efa64b',17.2),('ee6ef330-de85-4fc6-80fb-02d7b875fcff',33.0)]:
    wt=hashlib.sha256(('/home/agent/projects/cezar/.ai/cezar/worktrees/'+root).encode()).hexdigest()[:16]
    dep=int((scan-ago*60)*1000); end=dep+3600_000
    rows=db.execute('select r.id,r.test_files,c.kind,r.started_at,r.ended_at,r.end_state from runs r left join checkpoints c on c.id=r.checkpoint_id where r.worktree_id=? and r.started_at>=? and r.started_at<=? order by r.started_at',(wt,dep,end)).fetchall()
    slow=[r for r in rows if all(fnmatch.fnmatch(f['path'],'packages/web/e2e/*.e2e.ts') for f in json.loads(r[1]))]
    fast=[r for r in rows if r not in slow]
    w=lambda rs: round(sum(((x[4] or x[3])-x[3])/1000 for x in rs))
    n=lambda rs: sum(len(json.loads(x[1])) for x in rs)
    def later(rs):
        ids=[x[0] for x in rs]
        if not ids: return (0,0,None)
        t,l=db.execute(f"select count(*), sum(last_used_at > recorded_at + 60000) from results where run_id in ({','.join('?'*len(ids))})",ids).fetchone()
        gaps=sorted((u-r)/60000 for (r,u) in db.execute(f"select recorded_at,last_used_at from results where run_id in ({','.join('?'*len(ids))})",ids))
        return (t,l or 0, round(gaps[len(gaps)//2],1) if gaps else None)
    keys=[k for (k,) in db.execute(f"select distinct key from results where run_id in ({','.join('?'*len(rows))})",[x[0] for x in rows])] if rows else []
    holders=set(); held=0
    for k in keys:
        hs=[h for (h,) in db.execute('select worktree_id from test_file_keys where key=? and worktree_id!=?',(k,wt))]
        if hs: held+=1; holders.update(hs)
    last=db.execute('select max(ended_at) from runs where worktree_id=? and started_at<=?',(wt,end)).fetchone()[0]
    after=db.execute('select count(*) from runs where worktree_id=? and started_at>?',(wt,end)).fetchone()[0]
    print(f"{root[:8]} wt {wt} departed {time.strftime('%H:%M:%SZ',time.gmtime(dep/1000))}: fast {len(fast)} runs/{n(fast)} files/{w(fast)} s, kinds {sorted(set(x[2] or 'none' for x in fast))}, ends {[x[5] for x in fast].count('timed-out')} timed-out; slow {len(slow)} runs/{w(slow)} s; last drain run end {time.strftime('%H:%MZ',time.gmtime((last or 0)/1000))}; results fast (n, read later, median gap min) {later(fast)} slow {later(slow)}; keys {len(keys)}, held now by another worktree {held}, holders {len(holders)}; runs after the bound {after}")
db.execute('rollback')
