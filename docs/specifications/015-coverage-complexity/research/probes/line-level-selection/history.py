#!/usr/bin/env python3
"""Throwaway bounded read-only search for OLD-source records before each commit.
python3 history.py SNAPSHOT.json.gz COMPARISON.json.gz STORE REPO OUTPUT.json.gz
A source hash and time match is NOT a whole historical test-key proof.
"""
import base64,collections,datetime,gzip,hashlib,json,pathlib,sqlite3,subprocess,sys,time,zlib
snap,comparison,store,repo,dest=sys.argv[1:]
x=json.load(gzip.open(snap,'rt')); edits=json.load(gzip.open(comparison,'rt'))['rows']
start=time.monotonic(); began=datetime.datetime.now(datetime.timezone.utc).isoformat()
def open_db(name):
 d=sqlite3.connect(f'file:{store}/{name}?mode=ro',uri=True);d.row_factory=sqlite3.Row;d.execute('pragma query_only=1');d.execute('begin');d.execute('select count(*) from sqlite_master').fetchone();return d
m=open_db('store.sqlite');c=open_db('code.sqlite')
cutoffs={r['commit']:int(subprocess.check_output(['git','-C',repo,'show','-s','--format=%ct',r['commit']]))*1000 for r in edits}
targets=collections.defaultdict(dict)
for i,e in enumerate(edits):
 for p in e['pairs']:
  if e['oldBlob']:targets[p['test']][i]=(e['path'],e['oldBlob'],cutoffs[e['commit']])
parts={}; selected={}; records={}; counters=collections.Counter(); processed=[]; skipped_cache={}
cov={r['result_key']:r['recorded_at'] for r in c.execute('select result_key,recorded_at from coverage where provider_version=2')}
def read_record(key):
 row=c.execute('select record from coverage where result_key=? and provider_version=2',(key,)).fetchone()
 if row is None:return None
 raw=json.loads(zlib.decompress(row[0],-15));counters['decodedRecords']+=1;counters['compressedBytesRead']+=len(row[0])
 if 'parts' not in raw:return raw
 src=[];unread=[raw['unread'][i] for i in raw['unreadAt']];at=0;pid=0
 for i in range(0,len(raw['parts']),2):
  at+=raw['parts'][i];pid+=raw['parts'][i+1]
  if pid not in parts:
   part=c.execute('select hash,part from coverage_parts where id=?',(pid,)).fetchone()
   if part is None:parts[pid]=None
   else:
    text=zlib.decompressobj(-15).decompress(part['part']);assert hashlib.sha256(b'2\n'+text).hexdigest()==part['hash'];parts[pid]=json.loads(text)
  p=parts[pid]
  if p is None or p['path']!=raw['unread'][at]:unread.append(raw['unread'][at]);counters['missingParts']+=1
  else:src.append(p)
 return {'sources':src,'unread':unread}
for f in x['files']:
 if time.monotonic()-start>300:break
 path=f['path']; wanted=targets[path]; found={}
 ids=[r[0] for r in m.execute("select id from checks where project='' and kind='file' and test_path=?",(path,))]
 if not ids:processed.append(path);continue
 latest_cut=max((t[2] for t in wanted.values()),default=0)
 for r in m.execute('select * from results where check_id=? order by recorded_at desc',(ids[0],)):
  counters['resultKeysVisited']+=1
  if r['key'] not in cov:continue
  at=cov[r['key']]
  pending={i:t for i,t in wanted.items() if i not in found and at<=t[2] and r['recorded_at']<=t[2]}
  if not pending:continue
  rec=read_record(r['key']);sources={(s['path'],s['blob']):s for s in rec['sources']}
  matched=[(i,sources[t[:2]]) for i,t in pending.items() if t[:2] in sources]
  if not matched:continue
  if r['key'] not in skipped_cache:
   skipped_cache[r['key']]=m.execute("select count(*) from results where key=? and outcome in ('skip','todo')",(r['key'],)).fetchone()[0]
  for i,s in matched:
   source={k:s[k] for k in ['path','blob','lines','covered']};ident=hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest();records[ident]=source
   bits=base64.b64decode(s['covered']);lines=[l for a,n,_,_ in edits[i]['hunks'] for l in range(a,a+n)]
   hit=any(l>0 and (l-1)//8<len(bits) and bits[(l-1)//8]&(1<<((l-1)%8)) for l in lines)
   found[i]={'key':r['key'],'providerVersion':2,'recordedAt':at,'resultAt':r['recorded_at'],'runId':r['run_id'],'resultCommit':r['commit_sha'],'dirty':r['dirty'],'durationMs':r['duration_ms'],'outcome':r['outcome'],'skipped':skipped_cache[r['key']],'source':ident,'hit':hit,'wholePreEditKeyProven':False}
 selected[path]=found;processed.append(path)
 if len(processed)%100==0:print(f'{len(processed)} files, {counters["decodedRecords"]} decoded, {time.monotonic()-start:.1f}s',file=sys.stderr,flush=True)
totals=collections.Counter();byedit=[]
for i,e in enumerate(edits):
 row=collections.Counter();row['fileLevel']=e['fileLevel']
 for p in e['pairs']:
  got=selected.get(p['test'],{}).get(i)
  if p['test'] not in processed:reason='budgetUnscanned'
  elif not e['oldBlob']:reason='noOldSource'
  elif not got:reason='noPreCommitOldSourceRecord'
  elif got['skipped']:reason='skippedTests'
  elif got['outcome']!='pass':reason='failedBaseline'
  elif not any(h[1] for h in e['hunks']):reason='emptyOldHunk'
  elif got['hit']:reason='hit'
  else:
   reason='noHit';row['savedFileDurationMs']+=got['durationMs']
   if not e['shapeFallback'] and not any(p['risk'].values()):row['heuristicSkips']+=1
  row[reason]+=1
  if reason in ['hit','noHit']:row['matchedFileDurationMs']+=got['durationMs']
 for k,v in row.items():totals[k]+=v
 byedit.append({'commit':e['commit'],'path':e['path'],'counts':dict(row)})
out={'start':began,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':time.monotonic()-start,'providerVersion':2,'runtimeVersions':'not recorded','population':len(x['files']),'processedFiles':len(processed),'budgetSeconds':300,'counters':dict(counters),'totals':dict(totals),'byEdit':byedit,'selected':selected,'sources':records,'cutoffs':cutoffs,'limit':'Pre-commit record time and old source blob match. Not complete pre-edit key identity or historical closure; no actual scheduler/test replay.'}
with gzip.open(dest,'wt') as f:json.dump(out,f,separators=(',',':'))
print(json.dumps({k:out[k] for k in ['start','end','seconds','processedFiles','counters','totals','limit']},indent=2))
m.rollback();c.rollback()
