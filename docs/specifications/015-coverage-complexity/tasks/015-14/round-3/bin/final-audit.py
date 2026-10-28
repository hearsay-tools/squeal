"""Recompute final aggregates from sanitized evidence; --check compares saved summary.
Usage: python3 -I final-audit.py [--check]
No live stores or transcripts required. Manual case judgments are in final-cases.json.
"""
import collections, datetime, json, pathlib, sys
R=pathlib.Path(__file__).resolve().parents[1]
def read(name): return json.loads((R/'data'/(name+'.json')).read_text())
def iso(s): return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
w=read('final-window'); j=read('final-judged'); c=read('final-store-counts'); s=read('final-store-snapshot')
coverage=[x for x in j if x['measure'] in ('crap','untested')]
assert len(coverage)==42
assert not c['excludedRecords'] and not c['excludedRuns']
assert all(x['allRuns']==0 for x in c['excludedActivity'])
assert all('a52cf0ea'!=x['where'] and '05fecde6'!=x['where'] for x in w['sessions'])
assert all(x['settled'] and x['end']=='completed' for x in c['runs'])
out={'window':w['window'],'hours':(iso(w['window'][1])-iso(w['window'][0])).total_seconds()/3600}
out['sessions']={place:{'sessions':len(xs),'deliveries':sum(x['deliveries'] for x in xs),'sourceEditSessions':sum(bool(x['measured']) for x in xs)} for place,xs in [('worktree',[x for x in w['sessions'] if x['where']!='main']),('main',[x for x in w['sessions'] if x['where']=='main'])]}
out['sourceEdits']=[{'harness':x['harness'],'task':x['where'],'versions':{v:len(paths) for v,paths in x['edit_versions'].items()}} for x in w['sessions'] if x['measured']]
out['coverage']={'lines':len(coverage),'sessions':len({(x['harness'],x['file']) for x in coverage}),'verdicts':dict(collections.Counter(x['verdict'] for x in coverage)),'byVersion':{v:dict(collections.Counter(x['verdict'] for x in coverage if x['version']==v)) for v in sorted({x['version'] for x in coverage})}}
out['coverage']['byMeasure']={}
for measure in ('crap','untested'):
 rows=[x for x in coverage if x['measure']==measure]
 out['coverage']['byMeasure'][measure]={
  'lines':len(rows),'sessions':len({(x['harness'],x['file']) for x in rows}),
  'verdicts':dict(collections.Counter(x['verdict'] for x in rows)),
  'kinds':dict(collections.Counter(x['kind'] for x in rows)),
  'byVersion':{v:dict(collections.Counter(x['verdict'] for x in rows if x['version']==v)) for v in sorted({x['version'] for x in rows})}}
out['summaries']=w['summaries'];out['loaderAccounts']=w['loader_accounts']
out['records']={'total':sum(x['records'] for x in c['records']),'bytes':sum(x['bytes'] for x in c['records']),'byProvider':{str(v):sum(x['records'] for x in c['records'] if x['provider']==v) for v in sorted({x['provider'] for x in c['records']})},'byDaemon':{v:sum(x['records'] for x in c['records'] if x['daemon']==v) for v in sorted({x['daemon'] for x in c['records']})},'noProducer':c['unattributed']}
assert out['records']['total']==10070
out['runs']={k:sum(x[k] for x in c['runs']) for k in ['runs','scheduledSlots','testFiles','withRecord','noRecord','skipOnlyMissing','lateRecord']}
assert out['runs']['testFiles']==10592 and out['runs']['noRecord']==521
# Latest note per tree is a lower bound, not a sum over resets or all notes.
notes=[]
for x in read('interim-drop-notes')['worktrees']:
 for n in x['notes']:
  if n['sinceMark']:notes.append({'worktree':x['worktree'],'name':x['name'],'at':iso(n['at']).timestamp()*1000,'total':n['total'],'causes':n['causes']})
notes+=c['notes']
latest={}
for n in sorted(notes,key=lambda n:n['at']): latest[n['worktree']]=n
out['savedDrops']={'notes':len(notes),'trees':len(latest),'latestPerTree':[{'name':n['name'],'total':n['total'],'causes':n['causes']} for n in latest.values()],'minimumTotal':sum(n['total'] for n in latest.values()),'causes':dict(sum((collections.Counter(n['causes']) for n in latest.values()),collections.Counter()))}
out['storeComparisons']=[]
for name in ['store-baseline-1','store-baseline-2']:
 b=read(name);delta=s['files']['code.sqlite']['bytes']-b['files']['code.sqlite']['bytes']
 recordBytes=sum(x['bytes'] for x in s['code']['coverage'])-sum(x['bytes'] for x in b['code']['coverage'])
 partBytes=s['code']['parts']['bytes']-b['code']['parts']['bytes']
 out['storeComparisons'].append({'baseline':name,'from':b['readAt'],'to':s['readAt'],'codeFileGrowth':delta,'recordByteGrowth':recordBytes,'partByteGrowth':partBytes,'grossBytesPerResult':delta/out['runs']['testFiles'],'grossBytesPerScheduledSlot':delta/out['runs']['scheduledSlots'],'payloadBytesPerRecord':(recordBytes+partBytes)/out['records']['total']})
text=json.dumps(out,indent=1)+'\n'; target=R/'data/final-summary.json'
if '--check' in sys.argv:
 assert target.read_text()==text,'saved summary differs'
 print('PASS: final aggregates reproduced from saved evidence; 42 lines, 10070 records, 10592 settled results; reader runs excluded')
else:target.write_text(text); print(text)
