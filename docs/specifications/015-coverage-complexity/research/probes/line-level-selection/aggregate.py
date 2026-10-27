#!/usr/bin/env python3
"""Offline audit and commit union. No suites or live store reads.
python3 aggregate.py SNAPSHOT COMPARISON HISTORY OUTCOMES FIXTURES > audit.json
"""
import collections,gzip,json,sys
s,c,h,o=(json.load(gzip.open(p,'rt')) for p in sys.argv[1:5]);f=json.load(open(sys.argv[5]))
assert len(s['population'])==len(s['files'])+len(s['excluded'])==1290
assert len(s['files'])==1270 and h['processedFiles']==1270
classifications={(p['edit'],p['test']):p['classification'] for p in o['pairs']}
pairs=collections.defaultdict(list);stages=collections.Counter();candidates=[]
for i,e in enumerate(c['rows']):
 for p in e['pairs']:
  row=h['selected'].get(p['test'],{}).get(str(i));state=classifications.get((i,p['test']),'missing')
  if row:
   assert h['sources'][row['source']]['blob']==e['oldBlob']
   assert row['recordedAt']<=h['cutoffs'][e['commit']]
   assert row['resultAt']<=h['cutoffs'][e['commit']]
  risk=any(p['risk'].values());eligible=state=='noHit' and not e['shapeFallback'] and not risk
  pairs[e['commit'],p['test']].append({'state':state,'key':row['key'] if row else None,'heuristic':eligible})
  if state=='noHit':
   stages['noHit']+=1
   if e['shapeFallback']:stages['shapeFallback']+=1
   else:
    stages['afterShape']+=1
    if risk:stages['lexicalFallback']+=1
    else:
     stages['candidateSkips']+=1
     candidates.append({'commit':e['commit'],'source':e['path'],'test':p['test'],'key':row['key'],'durationMs':row['durationMs'],'hunks':e['hunks']})
assert sum(e['fileLevel'] for e in c['rows'])==53073
assert sum(o['totals'].get(k,0) for k in ['hit','noHit','emptyOldHunk','nonpassingCases','skippedTests','outcomesAfterCommit','missingResults'])+h['totals']['noOldSource']+h['totals']['noPreCommitOldSourceRecord']==53073
assert len(f['results'])==10 and all(r['baseline']['pass'] for r in f['results'])
union=collections.Counter({'heuristicCandidateSkips':0})
for ps in pairs.values():
 union['sourceOnlyCommitTestPairs']+=1
 if all(p['state']=='noHit' for p in ps):
  union['allSourcesNoHit']+=1
  if len({p['key'] for p in ps})==1:union['allSourcesNoHitSameRecordKey']+=1
 if all(p['heuristic'] for p in ps):union['heuristicCandidateSkips']+=1
out={'checks':'PASS: population accounting, all selected old hashes and pre-commit timestamps, pair totals, baseline fixtures','fileEditStages':dict(stages),'candidates':candidates,'candidateFileDurationMs':sum(r['durationMs'] for r in candidates),'sourceOnlyCommitUnion':dict(union),'fixtureCounts':{'cases':len(f['results']),'introducedFailures':sum(not r['mutated']['pass'] for r in f['results']),'naiveMisses':sum(r['naiveMiss'] for r in f['results']),'structuralFallbackMisses':sum(r['naiveMiss'] and not r['structuralFallback'] for r in f['results']),'allNamedRiskFallbackMisses':sum(r['naiveMiss'] and not r['allRiskFallback'] for r in f['results'])},'limit':'Commit union still uses frozen current closures and source-only changes; excludes cache, other changed inputs, historical full keys, scheduling and cancellation. No actual run/CPU/latency saving measured.'}
print(json.dumps(out,indent=2))
