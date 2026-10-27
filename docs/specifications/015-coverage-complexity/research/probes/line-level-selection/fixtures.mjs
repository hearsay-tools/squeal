// Throwaway isolated soundness probes. No node:test, no live store/settings.
// node --import tsx fixtures.mjs > fixtures.json
import { Session } from 'node:inspector/promises';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mapScript } from '../../../../../../src/core/code/coverage/map.ts';
const hash = s => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
const cases = [
 {name:'reflection',before:'export function hidden() {\n  return "ok";\n}\n',after:'export function hidden() {\n  return "bad";\n}\n',test:'const m=await import("./subject.mjs"); if (!m.hidden.toString().includes("ok")) throw Error("reflection changed");',oldLines:[2],newLines:[2],guard:'reflection'},
 {name:'data-read',files:{'data.txt':'ok'},changed:'data.txt',before:'ok',after:'bad',test:'const {readFileSync}=await import("node:fs"); if(readFileSync(new URL("./data.txt",import.meta.url),"utf8")!=="ok") throw Error("data changed");',oldLines:[1],newLines:[1],guard:'non-code'},
 {name:'hoisted-signature',before:'function hidden(a) {\n  return a;\n}\nexport const arity=hidden.length;\n',after:'function hidden(a, b) {\n  return a;\n}\nexport const arity=hidden.length;\n',test:'const m=await import("./subject.mjs"); if(m.arity!==1) throw Error("arity changed");',oldLines:[1],newLines:[1],guard:'declaration'},
 {name:'addition',before:'export function unused() {\n  return 1;\n}\n',after:'export function unused() {\n  return 1;\n}\nthrow Error("added failure");\n',test:'await import("./subject.mjs");',oldLines:[],newLines:[4],guard:'addition'},
 {name:'deletion',before:'function visible() {\n  return 1;\n}\nexport const present=typeof visible==="function";\n',after:'export const present=typeof visible==="function";\n',test:'const m=await import("./subject.mjs"); if(!m.present) throw Error("hoisted declaration disappeared");',oldLines:[1,2,3],newLines:[],guard:'deletion'},
 {name:'changed-import',files:{'safe.mjs':'export const n=1;','bad.mjs':'export const n=2;'},before:'import {n} from "./safe.mjs";\nexport const answer=n;\n',after:'import {n} from "./bad.mjs";\nexport const answer=n;\n',test:'const m=await import("./subject.mjs"); if(m.answer!==1) throw Error("import changed");',oldLines:[1],newLines:[1],guard:'imports'},
 {name:'stale-dependency',files:{'flag.mjs':'export const flag=false;'},preChange:{'flag.mjs':'export const flag=true;'},before:'import {flag} from "./flag.mjs";\nexport function answer() {\n  if (flag) {\n    return 1;\n  }\n  return 1;\n}\n',after:'import {flag} from "./flag.mjs";\nexport function answer() {\n  if (flag) {\n    return 2;\n  }\n  return 1;\n}\n',test:'const m=await import("./subject.mjs"); if(m.answer()!==1) throw Error("stale branch");',oldLines:[4],newLines:[4],guard:'whole-key'},
 {name:'child-only',before:'process.stdout.write("ok");\n',after:'process.stdout.write("bad");\n',test:'const {execFileSync}=await import("node:child_process"); const {fileURLToPath}=await import("node:url"); if(execFileSync(process.execPath,[fileURLToPath(new URL("./subject.mjs",import.meta.url))],{encoding:"utf8"})!=="ok") throw Error("child changed");',oldLines:[1],newLines:[1],guard:'child'},
 {name:'syntax-in-unused-body',before:'export function unused() {\n  return 1;\n}\n',after:'export function unused() {\n  return );\n}\n',test:'await import("./subject.mjs");',oldLines:[2],newLines:[2],guard:'parse'},
 {name:'unused-body-control',before:'export function unused() {\n  return 1;\n}\n',after:'export function unused() {\n  return 2;\n}\n',test:'await import("./subject.mjs");',oldLines:[2],newLines:[2],guard:null},
];
if (process.argv[2]==='child') {
 const root=process.argv[3]; const session=new Session(); session.connect();
 await session.post('Profiler.enable'); await session.post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 let pass=true,error=null;
 try { await import(pathToFileURL(join(root,'check.mjs')).href); } catch(e) {pass=false;error=e.message;}
 const payload=await session.post('Profiler.takePreciseCoverage'); await session.post('Profiler.stopPreciseCoverage');session.disconnect();
 const records={};
 for(const script of payload.result.filter(s=>s.url.startsWith(pathToFileURL(root+'/').href))){
  const path=new URL(script.url); const code=readFileSync(path,'utf8');
  const mapped=mapScript(script,{code,map:null});
  records[path.pathname.slice(root.length+1)]={blob:hash(code),lines:[...mapped.lines].map(n=>n+1),covered:[...mapped.covered].map(n=>n+1)};
 }
 console.log(JSON.stringify({pass,error,records}));
} else {
 const load=loadavg()[0],cpu=cpus().length;
 if(load>=cpu) throw Error(`load ${load} >= CPUs ${cpu}; no fixture launched`);
 const start=performance.now(); const results=[];
 for(const f of cases){
  if(loadavg()[0]>=cpu) throw Error('load reached CPU count; stop and retry later');
  const root=mkdtempSync(join(tmpdir(),'sq-line-selection-'));
  const changed=f.changed??'subject.mjs';
  const write=(files)=>Object.entries(files).forEach(([p,s])=>writeFileSync(join(root,p),s));
  write({...f.files,[changed]:f.before,'check.mjs':f.test});
  const run=()=>{const p=spawnSync(process.execPath,['--import','tsx',resolve(process.argv[1]),'child',root],{encoding:'utf8',timeout:20000});if(p.status!==0)throw Error(p.stderr);return JSON.parse(p.stdout)};
  const before=run(); if(!before.pass)throw Error(`${f.name} baseline failed ${before.error}`);
  write(f.preChange??{}); const preChange=f.preChange?run():null;
  if(preChange&&!preChange.pass)throw Error('preChange failed');
  write({[changed]:f.after}); const after=run();
  const record=before.records[changed];
  const oldIntersects=!!record?.covered.some(n=>f.oldLines.includes(n));
  const newIntersects=!!after.records[changed]?.covered.some(n=>f.newLines.includes(n));
  results.push({name:f.name,changed,oldBlob:hash(f.before),newBlob:hash(f.after),oldLines:f.oldLines,newLines:f.newLines,baseline:before,preChange,mutated:after,oldIntersects,newIntersects,naiveMiss:!oldIntersects&&!after.pass,structuralFallback:!record||!!f.guard&&f.guard!=='reflection',allRiskFallback:!record||!!f.guard,guard:f.guard});
  rmSync(root,{recursive:true,force:true});
 }
 console.log(JSON.stringify({runtime:process.version,v8:process.versions.v8,provider:'inspector precise coverage + Squeal mapScript (identity map), NOT node:test ownRecord/tsx source-map path',initialLoad:load,cpus:cpu,seconds:(performance.now()-start)/1000,results},null,2));
}
