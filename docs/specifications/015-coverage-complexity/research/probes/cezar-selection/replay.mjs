// Recompute every choice from the retained exact pre-edit inputs and coverage.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deepStrictEqual} from 'node:assert';
import {decide,structure} from './structural.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const read=name=>JSON.parse(gunzipSync(readFileSync(join(here,name))));
const inputs=[...read('inputs.json.gz'),...read('regression-inputs.json.gz')];
const rows=read('runs.json.gz').runs.filter(r=>r.key.endsWith('-structural')&&r.result?.edited);
for(const row of rows){
 const key=row.key.replace(/-structural$/,'');
 const input=inputs.find(r=>(r.id??r.commit.slice(0,9))===key);
 const result=row.result;
 deepStrictEqual(decide(input.previous,input.next,result.baseline.records,input.paths,result.globalChange),result.decision);
}
const baseline=rows.find(r=>r.key==='weekday-structural')?.result.baseline.records;
const parent=inputs.find(r=>r.id==='weekday')?.previous;
const coverage={productionSourceFiles:0,loadedProductionSourceFiles:0,namedTopLevelFunctions:0,exactMappedFunctions:0,hitFunctions:0};
if(baseline&&parent)for(const [path,source]of Object.entries(parent)){
 if(!path.endsWith('.ts')||path.endsWith('.test.ts')||path.endsWith('.testkit.ts')||path.endsWith('vitest.config.ts'))continue;
 coverage.productionSourceFiles++;
 const observed=baseline.flatMap(r=>r.coverage[path]?.functions??[]);
 if(baseline.some(r=>r.coverage[path]!==undefined))coverage.loadedProductionSourceFiles++;
 for(const body of structure(source).bodies){
   coverage.namedTopLevelFunctions++;
   const match=observed.filter(f=>f.start===body.start&&f.end===body.end);
   if(match.length)coverage.exactMappedFunctions++;
   if(match.some(f=>f.hit))coverage.hitFunctions++;
 }
}
writeFileSync(join(here,'replay.json'),JSON.stringify({choicesRecomputed:rows.length,allMatch:true,headSampleCoverage:coverage},null,2)+'\n');
console.log('Recomputed choices match:',rows.length);
