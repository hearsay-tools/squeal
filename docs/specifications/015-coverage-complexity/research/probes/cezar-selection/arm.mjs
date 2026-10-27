// Throwaway warm Vitest 4 runner. One process/arm; bounded explicit sample only.
import {readFileSync,writeFileSync,readdirSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadavg,cpus} from 'node:os';
import {mapScript} from '../../../../../../src/core/code/coverage/map.ts';
import {importClosure} from '../../../../../../src/runners/vitest/graph.ts';
import {decide,hash} from './structural.mjs';
const [root,inputFile,mode,output]=process.argv.slice(2);
const row=JSON.parse(readFileSync(inputFile,'utf8'));
const here=dirname(fileURLToPath(import.meta.url)),squeal=resolve(here,'../../../../../..');
const declaration=JSON.parse(readFileSync(join(here,'declaration.json'),'utf8'));
const {createVitest}=await import(pathToFileURL(join(root,'node_modules/vitest/dist/node.js')).href);
const project=join(root,'packages/contract');
function cpu(pid=process.pid,seen=new Set()) {
  if(seen.has(pid))return 0;seen.add(pid);
  try {
    const s=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');
    let n=[11,12,13,14].reduce((a,i)=>a+Number(s[i]),0);
    const children=new Set(readdirSync(`/proc/${pid}/task`).flatMap(t=>{try{return readFileSync(`/proc/${pid}/task/${t}/children`,'utf8').trim().split(/\s+/).filter(Boolean);}catch{return [];}}));
    for(const c of children)n+=cpu(Number(c),seen);return n;
  } catch{return 0;}
}
const measure=()=>({wall:performance.now(),cpu:cpu(),load:loadavg()});
const elapsed=s=>({wallMs:performance.now()-s.wall,cpuMs:(cpu()-s.cpu)*10,loadBefore:s.load,loadAfter:loadavg()});
function gate(){const avail=Number(readFileSync('/proc/meminfo','utf8').match(/MemAvailable:\s+(\d+)/)[1])*1024;if(loadavg()[0]>=cpus().length || avail<8*1024**3)throw Error('HOST_GATE '+JSON.stringify({load:loadavg(),avail}));}
let current;
const reporter={
 onTestCaseResult(t){current.tests.push({file:relative(root,t.module.moduleId),name:t.fullName,state:t.result().state});},
 onTestModuleEnd(m){current.modules.push({file:relative(root,m.moduleId),state:m.state(),diagnostic:m.diagnostic(),errors:m.errors().map(e=>e.message)});},
 onTestRunEnd(_m,errors){current.errors.push(...errors.map(e=>e.message));},
};
const start=measure();gate();
const recorder=join(squeal,'src/runners/observe/recorder.cjs');
const observed=root+'-observed';
const v=await createVitest('test',{root:project,config:join(project,'vitest.config.ts'),watch:false,pool:'threads',maxWorkers:1,
 isolate:true,fileParallelism:false,reporters:[reporter],update:'none',include:declaration.sample.map(p=>relative(project,join(root,p))),
 env:{NODE_OPTIONS:`--require ${recorder}`,SQUEAL_OBSERVE:JSON.stringify({out:observed,root,skip:[]})},
 coverage:mode==='structural'?{enabled:true,provider:'custom',customProviderModule:join(squeal,'src/core/code/coverage/provider.mjs'),reportsDirectory:root+'-coverage',reporter:[]}:{enabled:false}});
await v.standalone();
const startup=elapsed(start),specs=await v.globTestSpecifications();
if(specs.length!==declaration.sample.length)throw Error('Sample listing mismatch '+specs.length);
const all=specs.map(s=>relative(root,s.moduleId));
const offset=(code,line,col)=>code.split('\n').slice(0,line-1).reduce((n,s)=>n+s.length+1,0)+col;
async function run(wanted,capture){
 gate();current={tests:[],modules:[],errors:[]};
 for(const f of readdirSync(observed))rmSync(join(observed,f),{force:true});
 const start=measure();
 if(wanted.length)await v.runTestSpecifications(specs.filter(s=>wanted.includes(relative(root,s.moduleId))));
 const execution=elapsed(start),mappingStart=measure(),records=[],diagnostics=[];
 const batches=v.coverageProvider?.takeBatches?.()??[];
 for(const spec of specs.filter(s=>wanted.includes(relative(root,s.moduleId)))) {
   const test=relative(root,spec.moduleId),environment=spec.project.vite.environments.ssr;
   const seen=new Set();function visit(n){if(!n||seen.has(n))return;seen.add(n);for(const dep of n.importedModules)visit(dep);}
   visit(environment.moduleGraph.getModuleById(spec.moduleId));
   const closure=await importClosure(spec.project,[spec.moduleId]);
   const inputs=[...new Set([test,...[...closure.files,...closure.missing].filter(p=>p.startsWith(root+'/')&&!p.includes('/node_modules/')).map(p=>relative(root,p))])];
   const record={test,inputs,coverage:{},failure:current.modules.find(m=>m.file===test)?.state!=='passed'};
   if(capture){
     const batch=batches.find(b=>b.testFiles.some(p=>resolve(project,p)===spec.moduleId));
     if(!batch)diagnostics.push({test,error:'no provider batch'});
     else {
       const payload=JSON.parse(readFileSync(batch.coverage,'utf8'));
       for(const script of payload.result){
         if(!script.url.startsWith('file://'))continue;
         const path=fileURLToPath(script.url);if(!path.startsWith(root+'/packages/contract/')||path.endsWith('.test.ts'))continue;
         const node=environment.moduleGraph.getModuleById(path),transform=node?.transformResult??node?.invalidationState;
         if(!transform?.code||!existsSync(path)){diagnostics.push({test,path:relative(root,path),error:'no transform/source'});continue;}
         const source=readFileSync(path,'utf8'),mapped=mapScript(script,{path:relative(root,path),code:transform.code,map:transform.map,sha1:undefined});
         record.coverage[relative(root,path)]={sourceHash:hash(source),transformHash:hash(transform.code),functions:[...mapped.functions.values()].map(([a,b,c,d,hit])=>({start:offset(source,a,b),end:offset(source,c,d)+1,hit})),
           lines:mapped.lines.size,covered:mapped.covered.size,wrapper:script.startOffset};
       }
     }
   }
   records.push(record);
 }
 for(const batch of batches)rmSync(batch.coverage,{force:true});
 const observedRows=readdirSync(observed).flatMap(f=>readFileSync(join(observed,f),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)));
 for(const record of records){
   const own=observedRows.filter(r=>relative(root,r.t)===record.test);
   record.inputs=[...new Set([...record.inputs,...own.flatMap(r=>(r.f??[]).filter(p=>p.startsWith(root+'/')&&!p.includes('/node_modules/')).map(p=>relative(root,p)))])];
   record.observedRows=own.length;
 }
 return {...current,requested:wanted,execution,mapping:elapsed(mappingStart),records,diagnostics};
}
let result;
try{
 const cold=await run(all,false);
 writeFileSync(output+'.cold.json',JSON.stringify({mode,startup,cold})+'\n');
 const baseline=await run(all,mode==='structural');
 const baselineOk=[cold,baseline].every(r=>r.modules.length===all.length&&!r.errors.length&&r.modules.every(m=>m.state==='passed')&&r.tests.every(t=>t.state==='passed'||t.state==='skipped'));
 result={protocol:2,mode,startup,cold,baseline,baselineOk};
 writeFileSync(output,JSON.stringify(result)+"\n");
 if(baselineOk){
   const decisionStart=measure();
   const globalPaths=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vitest.config.ts','packages/contract/package.json','packages/contract/vitest.config.ts','packages/contract/tsconfig.json'];
   const globalChange=row.paths.some(p=>globalPaths.includes(p));
   const file=mode==='exhaustive'?all:baseline.records.filter(r=>globalChange||r.failure||row.paths.some(p=>r.inputs.includes(p))).map(r=>r.test);
   const decision=mode==='structural'?decide(row.previous,row.next,baseline.records,row.paths,globalChange):{file,structural:[],debt:[],shapes:{},reasons:{}};
   const selection=elapsed(decisionStart);
   // Apply the entire historical edit. Driver supplies every changed file, not only contract files.
   for(const [path,entry]of Object.entries(row.edits)){
     const full=join(root,path);if(entry===null)rmSync(full,{force:true});
     else {mkdirSync(dirname(full),{recursive:true});writeFileSync(full,Buffer.from(entry,'base64'));}
     v.invalidateFile(full);
   }
   const wanted=mode==='exhaustive'?all:mode==='file'?decision.file:decision.structural;
   const edited=await run(wanted,mode==='structural');
   result={...result,globalChange,decision,selection,edited};
 }
}finally{await v.close();process.exitCode=0;}
writeFileSync(output,JSON.stringify(result)+'\n');
console.log(JSON.stringify({mode,baselineOk:result.baselineOk,files:result.edited?.modules.length,cases:result.edited?.tests.length}));
