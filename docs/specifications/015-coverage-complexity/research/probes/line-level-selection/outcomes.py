#!/usr/bin/env python3
"""Read-only outcome qualification of retained history keys.
python3 outcomes.py HISTORY.json.gz COMPARISON.json.gz STORE OUTPUT.json
File-level pass means loaded; inspect case outcomes before treating as passed.
This is a second timed store reading, explicitly separate from the archive scan.
"""
import collections,datetime,gzip,json,sqlite3,sys
history,comparison,store,dest=sys.argv[1:]
h=json.load(gzip.open(history,'rt'));e=json.load(gzip.open(comparison,'rt'))['rows']
d=sqlite3.connect(f'file:{store}/store.sqlite?mode=ro',uri=True);d.execute('pragma query_only=1');d.execute('begin')
start=datetime.datetime.now(datetime.timezone.utc).isoformat(); keys={r['key'] for fs in h['selected'].values() for r in fs.values()}; outcomes={}
for key in sorted(keys):
 rows=d.execute('select outcome,count(*),min(recorded_at),max(recorded_at) from results where key=? group by outcome',(key,)).fetchall()
 outcomes[key]={o:{'count':n,'first':lo,'last':hi} for o,n,lo,hi in rows}
totals=collections.Counter();pairs=[]
for path,selected in h['selected'].items():
 for i,r in selected.items():
  edit=e[int(i)];out=outcomes[r['key']];cutoff=h['cutoffs'][edit['commit']]
  reason='noHit' if not r['hit'] else 'hit'
  if not out:reason='missingResults'
  elif any(v['last']>cutoff for v in out.values()):reason='outcomesAfterCommit'
  elif any(o in out for o in ['fail','unknown']):reason='nonpassingCases'
  elif r['skipped'] or any(o in out for o in ['skip','todo']):reason='skippedTests'
  elif not any(n for _,n,_,_ in edit['hunks']):reason='emptyOldHunk'
  totals[reason]+=1
  p=next(p for p in edit['pairs'] if p['test']==path)
  if reason=='noHit':
   totals['savedFileDurationMs']+=r['durationMs']
   if not edit['shapeFallback'] and not any(p['risk'].values()):totals['heuristicSkips']+=1
  if reason in ['hit','noHit']:totals['matchedFileDurationMs']+=r['durationMs']
  pairs.append({'test':path,'edit':int(i),'key':r['key'],'classification':reason})
out={'start':start,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'keys':len(keys),'outcomes':outcomes,'totals':dict(totals),'pairs':pairs,'limits':'Second snapshot. Latest retained case rows may postdate the commit; those are excluded. Does not reconstruct historical closure/key or prove a skip safe.'}
with gzip.open(dest,'wt') as f:json.dump(out,f,separators=(',',':'))
print(json.dumps({k:out[k] for k in ['start','end','keys','totals','limits']},indent=2))
d.rollback();d.close()
