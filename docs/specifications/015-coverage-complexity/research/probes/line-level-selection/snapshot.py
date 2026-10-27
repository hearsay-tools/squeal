#!/usr/bin/env python3
"""Throwaway read-only projection. No live settings or store writes.
Usage: python3 snapshot.py REPO STORE_DIR OUTPUT.json.gz
Retains every configured test-file path; selects current and latest retained
coverage-bearing file result. This is a bounded sample of keys, not all history.
"""
import datetime, gzip, hashlib, json, pathlib, sqlite3, subprocess, sys, time, zlib
repo, store, dest = map(pathlib.Path, sys.argv[1:])
start = time.monotonic()
def git(*args):
    return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
def open_db(name):
    db=sqlite3.connect(f'file:{store/name}?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    db.execute('pragma query_only=1')
    db.execute('pragma busy_timeout=5000')
    db.execute('begin')
    db.execute('select count(*) from sqlite_master').fetchone()
    return db
m=open_db('store.sqlite'); c=open_db('code.sqlite')
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
tracked=git('ls-files').splitlines()
all_tests=[p for p in tracked if (p.startswith('test/') or p.startswith('src/')) and p.endswith('.test.ts') and not p.startswith('test/fixtures/')]
pop=[p for p in all_tests if not p.startswith('test/e2e/')]
wt=hashlib.sha256(str(repo).encode()).hexdigest()[:16]
keys={r['path']:dict(r) for r in m.execute('select * from test_file_keys where worktree_id=? and project=?',(wt,''))}
closures={r['path']:dict(r) for r in m.execute('select * from test_files where project=?',('',))}
for row in closures.values(): row['closure_paths']=json.loads(row['closure_paths'])
coverage_keys={r['result_key']:r['provider_version'] for r in c.execute('select result_key,provider_version from coverage where provider_version=2')}
records={}; parts={}; stats={'rawRecordBytes':0,'uniquePartBytes':0,'missingParts':0}
def decode(key):
    if key in records: return key
    row=c.execute('select * from coverage where result_key=? and provider_version=2',(key,)).fetchone()
    if row is None: return None
    stats['rawRecordBytes']+=len(row['record'])
    r=json.loads(zlib.decompress(row['record'],-15)); form='full'
    if 'parts' in r:
        form='manifest'; paths=r['unread']; src=[]; unread=[paths[i] for i in r['unreadAt']]; at=0; pid=0
        for i in range(0,len(r['parts']),2):
            at+=r['parts'][i]; pid+=r['parts'][i+1]
            if pid not in parts:
                part=c.execute('select hash,part from coverage_parts where id=?',(pid,)).fetchone()
                if part is None: parts[pid]=None
                else:
                    stats['uniquePartBytes']+=len(part['part'])
                    text=zlib.decompressobj(-15).decompress(part['part'])
                    assert hashlib.sha256(b'2\n'+text).hexdigest()==part['hash']
                    parts[pid]=json.loads(text)
            p=parts[pid]
            if p is None or p['path']!=paths[at]:
                unread.append(paths[at]); stats['missingParts']+=1
            else: src.append(p)
        r={'v':1,'sources':src,'unread':sorted(set(unread))}
    records[key]={'providerVersion':row['provider_version'],'recordedAt':row['recorded_at'],'form':form,'record':r}
    return key
files=[]
for i,p in enumerate(pop):
    ids=[r['id'] for r in m.execute("select id from checks where project='' and test_path=? and kind='file'",(p,))]
    assert len(ids)<=1
    k=keys.get(p); current=None; latest=None; available=0
    if ids:
        # Bounded per-file scan of retained file-level results; never test-case rows.
        for row in m.execute('select * from results where check_id=? order by recorded_at desc',(ids[0],)):
            r=dict(row)
            if k and r['key']==k['key']: current=r
            if r['key'] in coverage_keys:
                available+=1
                if latest is None: latest=r
    ck=decode(k['key']) if k and k['key'] in coverage_keys else None
    lk=decode(latest['key']) if latest else None
    chosen=ck or lk
    skipped=[]
    if chosen:
        skipped=[dict(r) for r in m.execute("select c.full_name,r.outcome from results r join checks c on c.id=r.check_id where r.key=? and c.test_path=? and r.outcome in ('skip','todo')",(chosen,p))]
    files.append({'path':p,'key':k,'closure':closures.get(p),'currentResult':current,'currentRecord':ck,'latestResultWithRecord':latest,'latestRecord':lk,'retainedRecordKeys':available,'skippedAtChosenKey':skipped})
    if i%200==0: print(f'{i}/{len(pop)} files, {len(records)} records',file=sys.stderr,flush=True)
worktree=m.execute('select * from worktrees where id=?',(wt,)).fetchone()
revision=m.execute('select * from revisions where worktree_id=? order by number desc limit 1',(wt,)).fetchone()
# Keep only this worktree's coverage notes, not arbitrary store metadata.
notes=[dict(r) for r in m.execute("select key,value from meta where key like ?",(f'notes.{wt}%',))]
observed=m.execute("select value from meta where key='observed.'").fetchone()
out={'readAt':now,'snapshotEnd':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':git('rev-parse','HEAD'),'repo':str(repo),'worktreeId':wt,'worktree':dict(worktree) if worktree else None,'revision':dict(revision) if revision else None,'population':all_tests,'excluded':[p for p in all_tests if p not in pop],'untrackedByPopulationKeys':sorted(set(keys)-set(pop)),'files':files,'records':records,'notes':notes,'observed':json.loads(observed[0]) if observed else None,'storeRecordCounts':dict(c.execute('select provider_version,count(*) from coverage group by provider_version').fetchall()),'stats':stats,'seconds':time.monotonic()-start,'runtimeProvenance':'Historical Node/Vitest versions are not explicit in results/coverage schemas; key hashes cannot decode them. Project identity is empty; tracked population is Vitest by repository configuration. Exclude node:test provider evidence from soundness.'}
# Deduplicate identical source objects in the committed projection.
source_pool={}
for entry in records.values():
    refs=[]
    for source in entry['record']['sources']:
        ident=hashlib.sha256(json.dumps(source,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        source_pool[ident]=source; refs.append(ident)
    entry['record']['sources']=refs
out['sourcePool']=source_pool
with gzip.open(dest,'wt') as f: json.dump(out,f,separators=(',',':'))
print(json.dumps({k:out[k] for k in ['readAt','snapshotEnd','commit','stats','seconds','storeRecordCounts']},indent=2))
print('population',len(all_tests),'included',len(pop),'records',len(records),'excluded',len(out['excluded']))
m.rollback(); c.rollback(); m.close(); c.close()
