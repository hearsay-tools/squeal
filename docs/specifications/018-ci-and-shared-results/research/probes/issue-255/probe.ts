// Throwaway store-level reproduction. Run from the repository root with pnpm exec tsx.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, loadavg, cpus } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { encodeSegment, keyFromSegments } from "../../../../../../src/core/keys/check-key.js";
import { configFieldHash } from "../../../../../../src/core/keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../../../../../../src/core/keys/key-format.js";
import { openStore, isStoreOpenFailure } from "../../../../../../src/core/store/open.js";
import { recordWorktreeEnvironments } from "../../../../../../src/core/store/environments.js";
import { importResults } from "../../../../../../src/core/store/transfer-import.js";
import { importFiles } from "../../../../../../src/core/store/imports.js";
import { readImports } from "../../../../../../src/core/status/imports.js";
import { importLines } from "../../../../../../src/core/status/import-lines.js";
const load = loadavg()[0], cpuCount = cpus().length;
console.log(JSON.stringify({load, cpuCount, node: process.version}));
if (load > cpuCount) { console.log("not reproduced, because load exceeds CPU count"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "squeal-issue255-"));
const common = join(dir, ".git"); mkdirSync(common); writeFileSync(join(common,"HEAD"), "ref: refs/heads/main\n");
const store = openStore(common); if (isStoreOpenFailure(store)) throw Error(JSON.stringify(store));
try {
 const wid="0123456789abcdef", ref={project:"",path:"t/a.test.ts"}, blob="1".repeat(40);
 const desc=(focus:boolean)=>({keyFormat:KEY_FORMAT_VERSION,project:"",runnerName:"vitest",runnerVersion:"4.1.10",adapterVersion:"7",nodeVersion:process.version,platform:process.platform,arch:process.arch,installedDependencies:"deps",env:{names:[],hash:"none"},config:{root:"r",allowOnly:configFieldHash(focus)},files:[],ci:false,browser:false});
 const parts={dependencies:"deps-of-a",runtime:""};
 const key=(env:string)=>keyFromSegments(env,ref,[encodeSegment(ref.path,blob)],parts.dependencies,parts.runtime);
 const bundle={format:"squeal-results/1",header:{squealVersion:"0.1.578",keyFormat:KEY_FORMAT_VERSION,commit:"c".repeat(40),dirty:false,createdAt:1,source:{kind:"local"}},environments:[{project:"",hash:"env-ci",descriptor:desc(false)}],testFiles:[{...ref,key:key("env-ci"),closure:{paths:[ref.path],complete:true,method:"static imports plus declared inputs"},observed:{},keyParts:parts}],observedStartup:[],results:[{project:"",testPath:ref.path,kind:"test",fullName:"passes",location:null,key:key("env-ci"),outcome:"pass",durationMs:3}]};
 const options={importId:"imp",fileHash:"h",now:10,rekeying:{worktreeId:wid,blobs:new Map([[ref.path,blob]])}};
 const before=importResults(store,bundle as any,options); console.log("first import",JSON.stringify(before)); assert.equal(before.rekeyed,0);
 recordWorktreeEnvironments(store,wid,[{hash:"env-here",descriptor:desc(true)}],20);
 const keys=[{worktreeId:wid,testFile:ref,key:key("env-here"),revision:1,pending:null}];
 const status=readImports(store,wid,keys,[]); console.log(importLines({imports:status} as any).join("\n"));
 assert.equal(status[0].notCurrent.environment,1); assert.deepEqual(status[0].environmentDifferences,[]);
 assert.equal(importFiles(store,"imp")[0].key,key("env-ci"));
 const second=importResults(store,bundle as any,{...options,now:30}); console.log("second import",JSON.stringify(second)); assert.equal(second.rekeyed,1);
 assert.equal(importFiles(store,"imp")[0].key,key("env-here"));
 console.log("reproduced store-level: first import retains exported key; recording environment alone leaves it; second import re-keys");
} finally {store.close();rmSync(dir,{recursive:true,force:true});}
