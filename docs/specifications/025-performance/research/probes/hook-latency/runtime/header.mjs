// Generate a throwaway test. Compares the same 500-state input in both implementations.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [root, old] = process.argv.slice(2).map(p=>resolve(p));
writeFileSync(root+'/runtime-probe/header.test.ts', `
import {it, expect} from 'vitest';
import {squealRepo} from '${root}/test/harness/helpers.ts';
import {check,result} from '${root}/test/state/helpers.ts';
import {headerPart as current} from '${root}/src/core/state/header-part.ts';
import {headerPart as previous} from '${old}/600/src/core/state/header-part.ts';
it('measures header conversion with the same input',()=>{
 const r=squealRepo(); const results=[];
 for(let f=0;f<50;f++) for(let c=0;c<10;c++) results.push(result(check('case '+c,{project:'',path:'src/m'+f+'.test.ts'}),'pass',{key:'k'+f,worktreeId:r.worktreeId}));
 r.apply(...results);
 const states=r.store.knownStates.list(r.worktreeId); const keys=r.store.testFileKeys.list(r.worktreeId);
 expect(current(states,keys,null)).toEqual(previous(states,keys,null));
 const rows=[];
 for(const [name,fn] of [['600',previous],['main',current]]) {
   const times=[]; for(let i=0;i<100;i++) {const t=performance.now(); fn(states,keys,null); times.push(performance.now()-t);}
   times.sort((a,b)=>a-b);rows.push({name,states:states.length,p50:times[50],p95:times[94],max:times[99]});
 }
 console.log('HEADER',JSON.stringify(rows));
});
`);
