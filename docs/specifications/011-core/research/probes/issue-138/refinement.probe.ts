// Throwaway: real scheduler and SQLite, with runner closure timing controlled.
import { appendFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createRepo, openRepoStore, openHarness } from '../../../../../../test/scheduler/helpers.js';
import { holdLock } from '../../../../../../test/status/hold-lock.js';
import { setBusyTimeout, storePaths } from '../../../../../../src/core/store/index.js';
const host={at:new Date().toISOString(),load:loadavg(),cpus:cpus().length,node:process.version};
const busyMs=Number(process.env.SQUEAL_PROBE_BUSY_MS ?? 100);
const holdMs=Number(process.env.SQUEAL_PROBE_HOLD_MS ?? 3000);
const output=new URL(busyMs===5000?'./refinement-production-observations.jsonl':'./refinement-observations.jsonl',import.meta.url);
writeFileSync(output,JSON.stringify({host,busyMs,holdMs})+'\n');
const record=(label:string,value:unknown)=>appendFileSync(output,JSON.stringify({label,value})+'\n');
it.skipIf(host.load[0]! > host.cpus)('records what survives two refinements refused by a real writer',async()=>{
 const repo=createRepo('basic');
 const store=openRepoStore(repo.commonDir);
 const h=await openHarness(repo.main,store,repo.commonDir,{allowErrors:true,policy:{baseline:{onStart:'lookup-then-run-missing'}}});
 await h.scheduler.start(); await h.scheduler.idle();
 record('BASELINE',h.header());
 expect(h.header().testFileCounts.current).toBe(5);
 // The default shortens SQLite's timeout; the second recorded run keeps production's 5 s.
 setBusyTimeout(store,busyMs);
 const original=h.runner.closure;
 let arrived!:()=>void, release!:()=>void;
 const entered=new Promise<void>(r=>arrived=r), gate=new Promise<void>(r=>release=r);
 let first=true;
 h.runner.closure=async ref=>{const result=await original(ref);if(first){first=false;arrived();await gate;}return result;};
 const body="import {it,expect} from 'vitest'; it('new file runs',()=>expect(1).toBe(1));\n";
 h.write('test/new-one.test.ts',body); await h.batch('test/new-one.test.ts');
 await entered;
 h.write('test/new-two.test.ts',body); await h.batch('test/new-two.test.ts');
 const latest=store.revisions.latest(h.worktreeId)?.number;
 const holder=await holdLock(storePaths(repo.commonDir).database,'immediate',holdMs);
 try {
  release();
  await holder.released;
  await h.scheduler.idle();
  await sleep(500);
  const snapshot=()=>({revision:store.revisions.latest(h.worktreeId)?.number,header:h.header(),keys:store.testFileKeys.list(h.worktreeId).map(k=>({path:k.testFile.path,key:k.key,phase:k.phase})),errors:h.errors.map(e=>e.message),runs:h.runner.runs.map(r=>r.files.map(f=>f.path))});
  record('AFTER_RELEASE',snapshot());
  expect(store.revisions.latest(h.worktreeId)?.number).toBe(latest);
  // A new real edit tests recovery, not a retry asserted on behalf of the product.
  h.write('test/new-two.test.ts',body+'// later edit\n'); await h.batch('test/new-two.test.ts'); await h.scheduler.idle();
  record('AFTER_LATER_EDIT',snapshot());
 expect(h.keyOf('test/new-one.test.ts')).toBeNull();
 expect(h.keyOf('test/new-two.test.ts')).not.toBeNull();
 expect(h.errors.some(e=>e.message.includes('could not apply revision 1'))).toBe(true);
 expect(h.errors.some(e=>e.message.includes('could not apply revision 2'))).toBe(true);
 } finally { holder.child.kill('SIGKILL'); release(); }
});
