// Read-only bounded final survey. Adapted from store, records_versions, notes and runs_norecord.
// Usage: node final-store.mjs <store dir> <final store.json> <older store.json>...
// Retains aggregates, Squeal notes and bounded test-path examples, never record payloads.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
const [dir, current, ...older] = process.argv.slice(2);
const W0 = Date.parse('2026-10-27T08:23:46Z'), W1 = Date.parse('2026-10-28T06:31:05Z');
const excludedTasks = ['a52cf0ea-7aa1-403e-8932-9af0f8d38bc0','05fecde6-12b3-4b82-a7a4-de871ee53819'];
const open = name => { const db=new DatabaseSync(`${dir}/${name}`,{readOnly:true}); db.exec('PRAGMA query_only=1; PRAGMA busy_timeout=5000'); return db; };
const main=open('store.sqlite'), code=open('code.sqlite');
const snapshots=[...older,current].map(f=>JSON.parse(readFileSync(f,'utf8')));
const names=new Map(), daemons=new Map(), excluded=new Set();
for(const snap of snapshots) for(const w of snap.main.worktrees){
 names.set(w.id,w.root.split('/').at(-1).slice(0,8));
 if(excludedTasks.some(t=>w.root.includes(t))) excluded.add(w.id);
 if(!w.daemon_started_at) continue;
 const start=Date.parse(w.daemon_started_at), seen=Date.parse(w.daemon_heartbeat_at??w.daemon_started_at);
 const ds=daemons.get(w.id)??[]; const d=ds.find(d=>d.start===start);
 if(d)d.seen=Math.max(d.seen,seen); else ds.push({start,seen,version:w.daemon_version});
 daemons.set(w.id,ds);
}
const version=(id,at)=> (daemons.get(id)??[]).filter(d=>d.start<=at&&at<=d.seen+120000).sort((a,b)=>b.start-a.start)[0]??null;
const results=main.prepare('SELECT worktree_id,run_id,recorded_at FROM results WHERE key=?');
const runById=main.prepare('SELECT * FROM runs WHERE id=?');
const recordGroups={}; let excludedRecords=0, unattributed=0;
for(const r of code.prepare('SELECT result_key,provider_version,recorded_at,record FROM coverage WHERE recorded_at>=? AND recorded_at<=?').iterate(W0,W1)){
 const matches=results.all(r.result_key).filter(p=>p.recorded_at<=r.recorded_at).sort((a,b)=>b.recorded_at-a.recorded_at);
 const producer=matches[0];
 if(producer&&excluded.has(producer.worktree_id)){excludedRecords++;continue;}
 if(!producer)unattributed++;
 const run=producer?runById.get(producer.run_id):null;
 const wt=producer?.worktree_id??'unknown'; const d=producer?version(wt,run?.started_at??producer.recorded_at):null;
 const form=Array.isArray(JSON.parse(inflateRawSync(r.record)).parts)?'manifest':'full';
 const v=d?.version??'unknown', k=[wt,v,r.provider_version,form].join(' ');
 const g=recordGroups[k]??={worktree:wt,name:names.get(wt)??null,daemon:v,provider:r.provider_version,form,records:0,bytes:0};
 g.records++;g.bytes+=r.record.length;
}
const files=main.prepare(`SELECT c.test_path,r.key,group_concat(DISTINCT r.outcome) outcomes FROM results r JOIN checks c ON c.id=r.check_id WHERE r.run_id=? GROUP BY c.test_path,r.key`);
// Both provider 2 and 3 occurred in this window. Do not mislabel provider-3 records absent.
const records=code.prepare('SELECT provider_version,recorded_at FROM coverage WHERE result_key=?');
const groups={};let excludedRuns=0;
for(const run of main.prepare('SELECT * FROM runs WHERE started_at>=? AND started_at<=?').all(W0,W1)){
 if(excluded.has(run.worktree_id)){excludedRuns++;continue;}
 const settled=run.ended_at!==null&&run.ended_at<=W1-120000;
 const d=version(run.worktree_id,run.started_at);const v=d?.version??'unknown';
 const k=[run.worktree_id,v,run.end_state,settled].join(' ');
 const g=groups[k]??={worktree:run.worktree_id,name:names.get(run.worktree_id)??null,daemon:v,end:run.end_state,settled,runs:0,scheduledSlots:0,testFiles:0,withRecord:0,noRecord:0,skipOnlyMissing:0,lateRecord:0,examples:[]};
 g.runs++;g.scheduledSlots+=JSON.parse(run.test_files).length;
 for(const f of files.all(run.id)){
  g.testFiles++;const rs=records.all(f.key);
  if(rs.length){g.withRecord++; if(rs.every(r=>r.recorded_at>W1))g.lateRecord++;}
  else{g.noRecord++;if(f.outcomes==='skip')g.skipOnlyMissing++;if(g.examples.length<4)g.examples.push({path:f.test_path,outcomes:f.outcomes});}
 }
}
// Notes are cumulative per daemon, not additive across snapshots. Retain snapshots and dedupe.
const notes=new Map();
for(const snap of snapshots)for(const n of snap.main.dropNotes??[]){
 const wt=n.key?.slice('notes.'.length);if(!wt||excluded.has(wt)||n.at<W0||n.at>W1)continue;
 notes.set(`${wt}:${n.at}:${n.text}`,{worktree:wt,name:names.get(wt)??null,at:n.at,revision:n.revision,text:n.text,daemon:version(wt,n.at),total:Number(/coverage: (\d+) completed/.exec(n.text)?.[1]??0),causes:Object.fromEntries([...n.text.matchAll(/(\d+) (no-result|map-error|store-open|store-error|busy|closed) \(/g)].map(m=>[m[2],Number(m[1])]))});
}
const excludedActivity=[...excluded].map(id=>({worktree:id,name:names.get(id),runsInWindow:main.prepare('SELECT count(*) n FROM runs WHERE worktree_id=? AND started_at>=? AND started_at<=?').get(id,W0,W1).n,allRuns:main.prepare('SELECT count(*) n FROM runs WHERE worktree_id=?').get(id).n}));
console.log(JSON.stringify({window:[new Date(W0).toISOString(),new Date(W1).toISOString()],readAt:new Date().toISOString(),settleSeconds:120,excludedRecords,excludedRuns,excludedActivity,unattributed,recordAttribution:'inferred latest result at key at or before record; daemon version recorded only across saved start/heartbeat interval plus 120s',records:Object.values(recordGroups),runs:Object.values(groups),notes:[...notes.values()]},null,1));
