// Real warm Vitest, real Squeal provider, mapper and input recorder. Throwaway.
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir, loadavg } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVitest } from 'vitest/node';
import { mapScript } from '../../../../../../src/core/code/coverage/map.ts';
import { selected, hash, structure } from './structural.mjs';
import { source, files, cases } from './warm-fixture.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../../..');
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
// Linux process-tree CPU includes threads, live descendants and waited children.
function cpuTicks(pid = process.pid, seen = new Set()) {
  if (seen.has(pid)) return 0;
  seen.add(pid);
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    let total = [11,12,13,14].reduce((n, i) => n + Number(stat[i]), 0);
    const children = new Set(readdirSync(`/proc/${pid}/task`).flatMap(t => {
      try { return readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').trim().split(/\s+/).filter(Boolean); } catch { return []; }
    }));
    for (const child of children) total += cpuTicks(Number(child), seen);
    return total;
  } catch { return 0; }
}
const hz = Number((await import('node:child_process')).execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
function offset(code, line, column) { return code.split('\n').slice(0, line - 1).reduce((n, s) => n + s.length + 1, 0) + column; }
const chosen = process.argv.slice(3);
const saved = join(output,'warm-results.json');
const results = chosen.length && existsSync(saved) ? JSON.parse(readFileSync(saved,'utf8')).cases.filter(c=>!chosen.includes(c.case)) : [];
for (const fixture of cases.filter(c=>!chosen.length||chosen.includes(c.name))) {
  const root = mkdtempSync(join(tmpdir(), 'selection-warm-'));
  const variants = [];
  try {
    // Two instances, one per arm, prevent the exhaustive run from warming selection.
    const order = cases.indexOf(fixture) % 2 ? ['exhaustive','selected'] : ['selected','exhaustive'];
    for (const mode of order) {
      const dir = join(root, mode); mkdirSync(dir);
      const previous = files(fixture.extra);
      for (const [path, content] of Object.entries(previous)) writeFileSync(join(dir, path), content);
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
      symlinkSync(join(repo,'node_modules'), join(dir,'node_modules'), 'dir');
      const observed = join(dir, '.observed'); mkdirSync(observed);
      const reports = join(dir, '.coverage');
      const recorder = join(repo,'src/runners/observe/recorder.cjs');
      let current;
      const reporter = {
        onTestCaseResult(t) { current.tests.push({ file: relative(dir,t.module.moduleId), name:t.fullName, state:t.result().state }); },
        onTestModuleEnd(m) { current.modules.push({ file:relative(dir,m.moduleId), state:m.state(), diagnostic:m.diagnostic(), errors:m.errors().map(e=>e.message) }); },
        onUserConsoleLog(log) { if (log.content.startsWith('WORKER ')) current.workers.push(JSON.parse(log.content.slice(7))); },
        onTestRunEnd(_m, errors) { current.errors.push(...errors.map(e=>e.message)); },
      };
      const startup = performance.now();
      const v = await createVitest('test', { root:dir, config:false, watch:false, pool:'threads', maxWorkers:1,
        isolate:true, fileParallelism:false, reporters:[reporter], update:'none', fsModuleCache:false,
        include:['*.test.mjs'], env:{NODE_OPTIONS:`--require ${recorder}`,SQUEAL_OBSERVE:JSON.stringify({out:observed,root:dir,skip:[]})},
        coverage: mode==='selected' ? {enabled:true,provider:'custom',customProviderModule:join(repo,'src/core/code/coverage/provider.mjs'),reportsDirectory:reports,reporter:[]} : {enabled:false},
      });
      await v.standalone();
      const startupMs = performance.now() - startup;
      const specs = await v.globTestSpecifications();
      async function run(wanted, capture) {
        current = { tests:[], modules:[], errors:[], workers:[] };
        const start = performance.now(), cpu = cpuTicks();
        if (wanted.length) await v.runTestSpecifications(specs.filter(s=>wanted.includes(relative(dir,s.moduleId))));
        const executionWallMs = performance.now()-start, executionCpuMs = (cpuTicks()-cpu)*1000/hz;
        const captureStart = performance.now(), captureCpu = cpuTicks();
        const batches = v.coverageProvider?.takeBatches?.() ?? [];
        const mapped = [];
        if (capture) for (const batch of batches) {
          const payload = JSON.parse(readFileSync(batch.coverage,'utf8'));
          const environment = v.projects.find(p=>p.name===batch.projectName).vite.environments[batch.environment];
          const module = environment.moduleGraph.getModuleById(join(dir,'rates.mjs'));
          const transform = module?.transformResult ?? module?.invalidationState;
          const script = payload.result.find(s=>s.url.endsWith('/rates.mjs'));
          if (!transform?.code || !script) continue; // Failed collection can have no source coverage.
          const executedSource = readFileSync(join(dir,'rates.mjs'),'utf8');
          const mappedScript = mapScript(script,{path:'rates.mjs',code:transform.code,map:transform.map,sha1:undefined});
          const functions = [...mappedScript.functions.values()];
          const normalized = functions.map(([a,b,c,d,hit])=>({ranges:[{startOffset:offset(executedSource,a,b),endOffset:offset(executedSource,c,d)+1,count:hit}]}));
          const seenModules = new Set();
          const visit = node => {
            if (!node || seenModules.has(node)) return;
            seenModules.add(node);
            for (const dependency of node.importedModules) visit(dependency);
          };
          visit(environment.moduleGraph.getModuleById(resolve(dir,batch.testFiles[0])));
          const staticInputs = [...seenModules].map(node=>node.file).filter(path=>path?.startsWith(dir+'/')&&!path.includes('/node_modules/')).map(path=>relative(dir,path));
          mapped.push({ staticInputs, test:relative(dir,resolve(dir,batch.testFiles[0])), epoch:'one',sourceHash:hash(executedSource),failure:null,
            observations:{reads:[],child:false,reflection:false},inputs:[],childInputs:[],
            coverage:[{url:'file:///rates.mjs',functions:normalized}], mappedFunctions:functions,
            transformHash:hash(transform.code), rawFunctions:script.functions.map(f=>({name:f.functionName,range:f.ranges[0]})),wrapper:script.startOffset });
        }
        for (const batch of batches) rmSync(batch.coverage,{force:true});
        const rows = readdirSync(observed).flatMap(f=>readFileSync(join(observed,f),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));
        for (const record of mapped) {
          const own = rows.filter(row=>relative(dir,row.t)===record.test);
          record.inputs=[...new Set([record.test,...record.staticInputs,...own.flatMap(row=>(row.f??[]).map(p=>relative(dir,p)))])];
          record.childInputs=[...new Set(own.flatMap(row=>(row.d??[]).map(p=>relative(dir,p))))];
          record.observed=own.map(row=>Object.fromEntries(Object.entries(row).map(([k,value])=>[k,Array.isArray(value)?value.map(p=>relative(dir,p)):relative(dir,value)])));
        }
        const captureWallMs = performance.now()-captureStart,captureCpuMs=(cpuTicks()-captureCpu)*1000/hz;
        const result={...current,requested:wanted,executionWallMs,executionCpuMs,captureWallMs,captureCpuMs,
          totalWallMs:executionWallMs+captureWallMs,totalCpuMs:executionCpuMs+captureCpuMs,load:loadavg(),mapped};
        return result;
      }
      try {
        const all=specs.map(s=>relative(dir,s.moduleId));
        const cold = await run(all,false);
        const baseline = await run(all,mode==='selected');
        if (baseline.errors.length || baseline.tests.some(t=>t.state!=='passed') || baseline.modules.some(m=>m.state!=='passed')) throw Error(`Baseline failed ${JSON.stringify(baseline)}`);
        if (mode==='selected' && baseline.mapped.length!==all.length) throw Error('Incomplete baseline coverage');
        const next={...previous,'rates.mjs':fixture.code,...fixture.change};
        const start=performance.now(),cpu=cpuTicks();
        if (fixture.corrupt) for(const r of baseline.mapped)r.sourceHash='bad';
        const decision=mode==='selected'?selected({previous,next,records:baseline.mapped}):{tests:all,reasons:['exhaustive fixture oracle']};
        const decisionMs=performance.now()-start,decisionCpuMs=(cpuTicks()-cpu)*1000/hz;
        for(const [path,content]of Object.entries(next))if(previous[path]!==content){writeFileSync(join(dir,path),content);v.invalidateFile(join(dir,path));}
        const edited=await run(decision.tests,mode==='selected');
        variants.push({mode,startupMs,cold,baseline,decision,decisionMs,decisionCpuMs,edited});
      } finally {await v.close();process.exitCode=0;}
    }
    variants.sort((a,b)=>a.mode==='selected'?-1:1);
    const [choice,oracle]=variants;
    const failedFiles=oracle.edited.modules.filter(m=>m.state==='failed').map(m=>m.file);
    const missed=failedFiles.filter(f=>!choice.edited.modules.some(m=>m.file===f&&m.state==='failed'));
    results.push({case:fixture.name,variants,failedFiles,missed});
    writeFileSync(join(output,'warm-results.json'),JSON.stringify({node:process.version,vitest:'5.0.3',ticksPerSecond:hz,cases:results},null,2)+'\n');
    console.log(fixture.name,choice.decision.tests.length,'/',oracle.decision.tests.length,'missed',missed);
  } finally {rmSync(root,{recursive:true,force:true});}
}
