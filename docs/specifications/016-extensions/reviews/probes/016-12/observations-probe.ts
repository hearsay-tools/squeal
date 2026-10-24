import { createVitestAdapter } from "./src/runners/vitest/index.js";
import { mkdtempSync,rmSync } from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const logs=mkdtempSync(join(tmpdir(),"review-observations-"));
const adapter=await createVitestAdapter({root:process.cwd(),observe:()=>true,maxWorkers:2});
try {
 const result=await adapter.run([{project:"",path:"test/kit/driver.test.ts"}],{runId:"review-observations",logDir:logs,timeoutMs:120000});
 console.log(JSON.stringify({end:result.end,completed:result.completedFiles,failed:result.results.filter(r=>r.outcome!=="pass").length,packReads:result.observed?.flatMap(o=>o.paths).filter(p=>p.startsWith("test/kit/packs/")),listings:result.observed?.flatMap(o=>o.directories).filter(p=>p.startsWith("test/kit/"))}));
} finally {await adapter.close();rmSync(logs,{recursive:true,force:true});}
