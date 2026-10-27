#!/usr/bin/env python3
"""Throwaway historical estimates, no tests run. Adapted from selection.mjs.
python3 compare.py SNAPSHOT.json.gz REPO COMMITS OUTPUT.json
All source edit rows are retained, including absent blobs and zero selectors.
Old-side selection is the prospective estimate. New-side is hindsight only.
"""
import base64, collections, gzip, json, pathlib, re, subprocess, sys, time
snapshot, repo, count, dest=sys.argv[1:]; repo=pathlib.Path(repo)
x=json.load(gzip.open(snapshot,'rt')); start=time.monotonic()
def git(*args): return subprocess.check_output(['git','-C',str(repo),*args],text=True)
def blob(commit,path):
    p=subprocess.run(['git','-C',str(repo),'rev-parse',f'{commit}:{path}'],capture_output=True,text=True)
    return p.stdout.strip() if p.returncode==0 else None
def covered(src,lines):
    bits=base64.b64decode(src['covered'])
    return any(n>0 and (n-1)//8<len(bits) and bits[(n-1)//8]&(1<<((n-1)%8)) for n in lines)
files=x['files']; pool=x['sourcePool']; cache={}
def source_records(f):
    keys=list(dict.fromkeys(k for k in [f['currentRecord'],f['latestRecord']] if k))
    return [(k,{pool[i]['path']:pool[i] for i in x['records'][k]['record']['sources']}) for k in keys]
source_by_file={f['path']:source_records(f) for f in files}
texts={}
def read(p):
    if p not in texts:
        try:texts[p]=(repo/p).read_text()
        except (OSError,UnicodeError):texts[p]=''
    return texts[p]
patterns={'child':r'(?:node:)?(?:child_process|worker_threads)','inspector':r'(?:node:)?inspector','dataRead':r'\b(?:readFileSync|readFile|readdirSync|readdir|statSync|stat)\s*\(','reflection':r'\.toString\s*\(|Reflect\.|Object\.(?:keys|getOwnPropertyNames|getOwnPropertyDescriptor)\s*\('}
risks={}
for f in files:
    # Test-side closure excludes src, as prior child-process research did.
    paths=[f['path']]+[p for p in (f['closure'] or {}).get('closure_paths',[]) if not p.startswith('src/')]
    risks[f['path']]={k:any(re.search(rx,read(p)) for p in paths) for k,rx in patterns.items()}
commits=git('log','--first-parent',f'-{count}','--format=%H',x['commit'],'--','src/').strip().splitlines()
rows=[]; totals=collections.Counter(); byte_stats=collections.Counter()
for commit in commits:
    parent=git('rev-parse',commit+'^').strip()
    changes=git('diff','--name-status','--no-renames',parent,commit,'--','src/').strip().splitlines()
    for change in changes:
        status,path=change.split('\t',1)
        # Keep all src changes. Non-TS/JS changes are explicit fallback.
        oldblob,newblob=blob(parent,path),blob(commit,path)
        diff=git('diff','--no-renames','-U0',parent,commit,'--',path)
        old=[];new=[];hunks=[]
        for a,an,b,bn in re.findall(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',diff,re.M):
            a,an,b,bn=int(a),int(an or 1),int(b),int(bn or 1)
            old.extend(range(a,a+an));new.extend(range(b,b+bn));hunks.append([a,an,b,bn])
        # Unlike original probe, pure deletions use real OLD lines, not new neighbors.
        sides={s:collections.Counter() for s in ['old','new']}; details=[]
        selected=[f for f in files if not f['closure'] or path in f['closure']['closure_paths']]
        # A heuristic only: structure or parse-risk is not fully modeled here.
        shape_fallback=status!='M' or not path.endswith(('.ts','.js','.mts','.mjs','.cts','.cjs')) or any(h[1]!=h[3] for h in hunks)
        for f in selected:
            d={'test':f['path'],'keys':{},'risk':risks[f['path']]}
            for side,wanted,lines in [('old',oldblob,old),('new',newblob,new)]:
                matches=[(key,srcs[path]) for key,srcs in source_by_file[f['path']] if path in srcs and srcs[path]['blob']==wanted]
                if not wanted: reason='noSourceOnSide'
                elif not matches:
                    recs=source_by_file[f['path']]
                    reason='staleSource' if any(path in ss for _,ss in recs) else 'unreadSource' if any(path in x['records'][key]['record']['unread'] for key,_ in recs) else 'absentSource'
                elif f['skippedAtChosenKey']:reason='skippedTests'
                else:
                    # Prefer current snapshot key, otherwise latest. This choice is explicit.
                    key,src=matches[0]; d['keys'][side]=key
                    reason='hit' if covered(src,lines) else 'noHit'
                    # Empty old hunks never justify skipping an addition.
                    if not lines:reason='emptyHunk'
                sides[side][reason]+=1;d[side]=reason
                duration=(f['currentResult'] or f['latestResultWithRecord'] or {}).get('duration_ms',0)
                if reason=='noHit':sides[side]['savedFileDurationMs']+=duration
                if reason in ('hit','noHit'):sides[side]['matchedFileDurationMs']+=duration
            d['heuristicSkip']=d['old']=='noHit' and not shape_fallback and not any(d['risk'].values())
            sides['old']['heuristicSkips']+=int(d['heuristicSkip'])
            details.append(d)
        rec_loaders=sum(any(path in sources for _,sources in source_by_file[f['path']]) for f in files)
        row={'commit':commit,'parent':parent,'path':path,'status':status,'oldBlob':oldblob,'newBlob':newblob,'hunks':hunks,'fileLevel':len(selected),'recordLoaders':rec_loaders,'old':dict(sides['old']),'new':dict(sides['new']),'shapeFallback':shape_fallback,'pairs':details}
        rows.append(row);totals['edits']+=1;totals['fileLevelPairs']+=len(selected)
        if not selected:totals['zeroFileSelectors']+=1
        for side in sides:
            for k,n in sides[side].items():totals[side+'.'+k]+=n
        totals['recordLoadersPairs']+=rec_loaders
# Current source identity is distinct from key currentness.
source_identity=collections.Counter(); all_current_files=0; unknown_paths=[]
for f in files:
    key=f['currentRecord'] or f['latestRecord']; rec=x['records'][key]['record'] if key else None
    if not rec:continue
    stale=False
    for ref in rec['sources']:
        s=pool[ref]
        if s['path'] not in cache:cache[s['path']]=blob(x['commit'],s['path'])
        state='same' if cache[s['path']]==s['blob'] else 'absentAtCommit' if cache[s['path']] is None else 'different'
        source_identity[state]+=1;stale|=state!='same'
    source_identity['unread']+=len(rec['unread'])
    if not stale and not rec['unread']:all_current_files+=1
summary={'snapshot':{k:x[k] for k in ['readAt','snapshotEnd','commit','seconds','stats','storeRecordCounts']},'population':{'tracked':len(x['population']),'configured':len(files),'excluded':len(x['excluded']),'currentRecords':sum(bool(f['currentRecord']) for f in files),'staleOnlyRecords':sum(not f['currentRecord'] and bool(f['latestRecord']) for f in files),'noRecord':sum(not(f['currentRecord'] or f['latestRecord']) for f in files),'skippedChosenRecords':sum(bool(f['skippedAtChosenKey']) for f in files),'incompleteStoredClosures':sum(not(f['closure'] or {}).get('complete') for f in files),'recordsAllSourcesAtCommit':all_current_files,'sourceIdentity':dict(source_identity),'lexicalRiskFiles':{k:sum(r[k] for r in risks.values()) for k in patterns}},'commits':commits,'totals':dict(totals),'rows':rows,'riskFiles':risks,'seconds':time.monotonic()-start,'limits':['Historical estimate against frozen stored closures, not a scheduler replay. Closure rows may come from other worktrees and carry complete=0.','Source blob equality does not prove a whole-key pre-edit match. All historical runtime versions unknown.','Old-side source matching is prospective geometry only. New-side matching is hindsight and cannot authorize a skip.','Saved duration sums file wall durations, not CPU or elapsed suite time; cache adoption and tier cancellation not modeled.','Heuristic fallbacks are lexical risk signals and hunk shape, not a sound program analysis. Strict full-key fallback skips zero.']}
with gzip.open(dest,'wt') as f:json.dump(summary,f,separators=(',',':'))
print(json.dumps({k:summary[k] for k in ['population','totals','seconds','limits']},indent=2))
