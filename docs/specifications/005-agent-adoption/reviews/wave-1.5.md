# 005 wave 1.5 re-review

PASS `2f39c11a6d79b78f140ed67d5cb4f4699d995b1d`: **0 blockers**, 1 proven nonblocking should-fix residual (S2), no nits. B1, B2, B3 and S1 are closed. S2's original case is closed; its completed-before-read variant is not.

## Verification

Exact candidate confirmed by `git rev-parse HEAD`; no checkout mismatch. Reviewed the 005-22, 005-23, 005-24 and 0.1.134 build commits (`54a79b7a..2f39c11a`), bounded by `reviews/wave-1.md` and brief 005-25. Inputs include the 2026-10-13 amendments to D3, D4 and D5. No source or board edit, delegation, Claude subject session or Codex subject session. The independent suite was `npx vitest run`, not a Squeal checkpoint.

All commands and probes ran at the exact candidate on a clean tree, before this report was written. Output below retains substantive results. Build left the committed bundles unchanged.

```text
$ git rev-parse HEAD
2f39c11a6d79b78f140ed67d5cb4f4699d995b1d
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
  @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
  esbuild@0.28.2 (postinstall: node install.js)
(exit 0)
$ npm run lint
> squeal@0.1.134 lint
> biome check .
Checked 938 files in 403ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.134 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.134 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.134 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(no output)
$ npx vitest run
FAIL test/cli/codex.test.ts:103:3
  touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
  Error: Test timed out in 5000ms. (reported duration 5309ms)
FAIL test/harness/codex/plugin.test.ts:89:3
  gives every bundle a require for CommonJS dependencies, and each parses (003-12)
  Error: Test timed out in 5000ms. (reported duration 5661ms)
Test Files  2 failed | 436 passed | 1 skipped (439)
Tests       2 failed | 3613 passed | 10 skipped (3625)
Duration    360.19s
(exit 1)
$ npx vitest run test/cli/codex.test.ts test/harness/codex/plugin.test.ts
Test Files  2 passed (2)
Tests       28 passed (28)
Duration    8.98s
(exit 0)
$ git status --porcelain
(no output)
```

The full suite remains **red**. Both failed tests are unchanged in this range; their isolated rerun passed. That establishes non-reproduction in the isolated run, not a cause. Host load was 98.36/77.20/47.58 near the end of the full run; load sensitivity is plausible, not proven. Neither timeout is a finding against this narrow wave. All changed CLI/setup tests and the key-format guard passed in the full run. No second full run was used to seek green.

The previous review's probe script was extracted and run against the freshly built `dist/`. Its B3 assertion initially threw `ENOENT` because successful removal now deletes the empty nested file. Re-running with only that assertion changed to `existsSync(path) && readFileSync(path).includes('squeal:begin')` completed, exit 0. The direct `reword()` example still transforms a compound span; it is not the application boundary. The public scan/preflight/CLI now refuses that edit.

## Blockers

None. Each previously blocking scenario was re-probed.

## Prior findings and nearest variants

| Finding | Independent evidence at this candidate | Judgment |
| --- | --- | --- |
| B1, pending sync at deadline | Original real-store probe: exit 3, "the daemon has not stored its pass over the edits made before the wait; results are as of revision 1". | Closed. |
| B1, sync names revision 2 while store is revision 1 | Original probe: exit 3, "the daemon's pass is at revision 2 and results are as of revision 1". | Closed. |
| B1, several named files, only some reconciled | Real store at revision 2, A current and B queued: exit 3, "1 test file still pending at revision 2". With B stale or unknown, exit 3 and that reason. With both current, exit 0; with a current failure in B, exit 1, even with a zero deadline. | Closed for partial-file results and ready final reads. |
| B2, original lint/test/build span | `init --gate CLAUDE.md:1=reword`: exit 1, refusal reason, empty stdout, instruction bytes unchanged. | Closed. |
| B2, `||` or pipe | `npm test || npm run build` and `npm test \| tee output.log` each have `proposed: null`; CLI exits 1 and leaves the file unchanged. | Closed. |
| B2, flags in a test-command span | `npx vitest run --reporter=dot` is reworded to the checkpoint with the complete original invocation retained in the fallback. Other commands in separate spans remain on the normal path, as the changed fixture verifies. | The compound repair does not reject ordinary flags. Bare flags are an existing limitation, below. |
| B3, original nested `docs/AGENTS.md` | Init exits 0; remove exits 0 and deletes the otherwise empty file. | Closed. |
| B3, nested `docs/CLAUDE.local.md` | Untracked, nonignored destination: init 0, remove 0, no file left. If git ignores it, init 1 with "nothing changed", no block written. An unterminated nested local block: remove 3, names its line under "Still there", leaves its bytes intact. | Closed under amended D4. |
| B3, file renamed after writing | Write to `docs/AGENTS.md`, rename to `docs/CLAUDE.md` or `docs/CLAUDE.local.md`: remove 0, original `# Keep` bytes restored at the new path. | Closed for supported instruction filenames. Rename outside those names is a boundary, below. |
| B3, root symlink and CRLF | Prior probes: `withoutBlock(withBlock(original)) === original`; symlinked write/remove returns one edit and restores original CRLF bytes. | Preserved. |
| S1, tracked unusable config | Original malformed-JSON probe exits 1 and names it under "Outdated". Validation variant `{"slwo":{}}` exits 1, names the unknown key. | Closed against amended D3. |
| S2, original joined checkpoint | Real SQLite store and socket stand-in: A current, B running, baseline c0 owns both, c1 joins with an empty work list; B finishes during the wait. Exit 0: "2 test files, 0 already current, 2 run by the baseline checkpoint c0 it joined". | Original reproduction closed. Completed-before-read variant remains below. |

## Should-fix

### S2 residual. Proven, nonblocking: completion before the join read loses the owner's counts

**Location:** `src/cli/run.ts:239` (join discovery), especially `:242` and `:243`; `:161` to `:170` (fallback to the join request's empty work list).

D1: "A checkpoint that joined an equivalent running one ... takes that one's verdict." The prior S2 fix asks to "Carry the joined checkpoint's counts into the final rendering, or use neutral counts when the request does not own them." The verdict is correct; the reuse explanation is still wrong in this timing variant. This retains S2's nonblocking classification.

**Scenario:** c0 is a baseline owning A and B; c1 joins with no work of its own. Both complete before the CLI's `joinedCheckpoint()` read. The scheduler normally clears the active progress when it finishes (`src/core/scheduler/checkpoints.ts:225` and `:298`). The CLI sees no open checkpoint, or an already-ended c1, and sets `joined` to null. It counts c1's empty list as though the results had all been current when the request started.

**Probe:** the script below repeats the original joined-store/socket case and changes only completion timing. It finishes both records and clears the progress meta before sending the `run-all` response. No real harness or daemon session is needed.

```text
completion during wait:
code=0
Checkpoint c1 completed at revision 2: no known failures; 2 test files, 0 already current, 2 run by the baseline checkpoint c0 it joined
completion before response:
code=0
Checkpoint c1 completed at revision 2: no known failures; 2 test files, 2 already current, 0 run now
```

**One-worker fix:** preserve the joined owner's identity/counts through completion, or print only the total when the CLI cannot establish ownership. Do not infer an owner's work from the empty join request. A CLI-sized conservative repair can use neutral final counts when an empty request cannot be distinguished from a completed join; retaining exact ownership requires a scheduler/response seam owned by the same worker. Add the completed-before-read state alongside `test/cli/run-all-verdict.test.ts:258`. Keep the independent pass/fail verdict unchanged.

## Notes and scope boundaries

- **Proven boundary, not a new wave finding:** renaming a block file to `docs/notes.md` leaves its managed block unlisted after remove, exit 0 (`src/cli/setup/block.ts:239`). The new D4 contract explicitly restricts discovery to the three instruction filenames. Renaming between supported names works. There is no stored write-location manifest. Future setup must explain this boundary if it promises removal after arbitrary renames; a separate removal worker could scan marker-bearing Markdown files if that stronger contract is chosen.
- **Proven pre-existing behavior, outside the repair delta:** a bare flagged line `Run npm test -- --reporter=dot.` becomes `Run squeal run --all --wait 110000 -- --reporter=dot.`; executing those generated checkpoint arguments exits 2, `unknown argument "--"`. The fallback also loses the flags (`src/cli/setup/gates.ts:132`, `:163`). `commandOf` and `reword` are unchanged by wave 1.5. The brief's nearest-variant check recorded this limitation; it is not promoted to a new finding against the repair. Before future setup presents this form as usable, a separate gate worker should preserve the whole bare invocation or refuse it, with a CLI acceptance test.
- Wave 1 N2's plausible multi-read race remains a note. This delta does not prove it or require re-prosecution. No board or status drift was found within this task's bounded inputs; the planned review row is appropriate while this report is being written.

## Nits

None.

## What fits

- The named wait separates permission to return at a deadline from sync readiness, carries the last sync state into wording, and never returns a pass on either old-revision probe. Multiple selected files are counted together; pending/stale/unknown in one does not disappear behind another file's current pass. The ready-final-read tests pass; pathless waits are untouched.
- Gate scan, JSON plan, human plan rendering and init preflight use the same nullable proposal and refusal reason. Refused compound edits happen before harness writes. Tests cover `&&`, `;`, repeated invocations, environment prefixes, pipes and unchanged files. The direct transformation helper is not offered through the guarded application path.
- D3 now explicitly treats config parsing/validation problems as an outdated item; the plan reports the problem and `--check` exits 1. Both parsing and validation variants were exercised.
- Block preflight rejects unsupported names and ignored nested destinations. Removal passes the git-listed/untracked instruction set to `removeBlocks`, preserving real-path deduplication, root fallback files and unterminated-block reporting. CRLF and root symlink probes are unchanged and pass.
- S2 captures an active joined owner's record before waiting and uses its counts when available. That closes the prior test without changing its exit code. Only completion before that capture remains unaccounted for.
- 0.1.134 bundles reproduce from source with no drift; KEY_FORMAT_VERSION 9 stays unchanged. No runtime dependency or new queue promotion.

## Inputs for the next wave

No blocking repair wave is required by this review. A coordinator may dispatch the S2 residual as one counts-only repair with the probe below; this PASS does not claim the full independent gate is green.

005-14/005-19 still start with the versioned plan, collect per-choice answers and apply the existing init flags. Respect `proposed: null` and display its reason; do not call `reword()` directly as the apply path. Gate ids are pre-edit line numbers, so apply gates before block insertion. Offer only the three supported block filenames and refuse ignored nested ones before writes. Do not promise removal after an arbitrary filename change. Account for the pre-existing bare-flags limitation before offering that form.

Warm-up remains terminal `start`, then `run --all --wait`, with separate handling of 0/1/3. Claude's gate budget is 110000 ms; deadline exit 3 means retry. Named waits add no queue priority. Codex trust, ignored-path warm-up suggestions, installer/launcher and instruction-text work remain the later rows' ownership; no subject session was run for them here.

## Reproduce S2's residual

After building the candidate, save this as `/tmp/005-wave-1.5-join-probe.mjs` and run `node --disable-warning=ExperimentalWarning /tmp/005-wave-1.5-join-probe.mjs` from the repository. It writes and deletes only scratch repositories. It tests both timings through public store and CLI interfaces.

```javascript
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
const base=process.cwd();
const load=p=>import(pathToFileURL(join(base,'dist',p)).href);
const {openStore}=await load('core/store/open.js');
const {worktreeIdFor}=await load('core/fs/index.js');
const {checkpointMetaKey}=await load('core/types/index.js');
const {namedWaitCommand}=await load('cli/status-wait-paths.js');
const {scanGates}=await load('cli/setup/gates.js');
const {main}=await load('cli/main.js');
const roots=[];
const fixture=()=>{const root=mkdtempSync('/tmp/005-25-');roots.push(root);execFileSync('git',['-C',root,'init','-q']);return root;};
const git=(r,...a)=>execFileSync('git',['-C',r,...a],{stdio:'pipe'});
const capture=r=>{let stdout='',stderr='';return {io:{cwd:r,env:{PATH:'',HOME:r},stdout:t=>stdout+=t,stderr:t=>stderr+=t},out:()=>({stdout,stderr})};};
const run=async(r,args)=>{const c=capture(r);return {code:await main(args,c.io),...c.out()};};
const report=o=>console.log(JSON.stringify(o));
function seed(root){const id=worktreeIdFor(root),now=Date.now(),store=openStore(join(root,'.git'));if('reason'in store)throw Error(store.reason);store.worktrees.upsert({id,root,commonDir:join(root,'.git'),isMain:true,registeredAt:now,daemon:{socketPath:join(root,'d.sock'),startedAt:now,heartbeatAt:now,heartbeatIntervalMs:5000,squealVersion:'0.1.134'}});store.revisions.append({worktreeId:id,createdAt:now,head:null,dirty:false,trigger:'watch',changes:[]});return {id,store,now};}
function file(store,id,path,validity='current',outcome='pass'){store.testFileKeys.upsertMany([{worktreeId:id,testFile:{project:'',path},key:'key-'+path,revision:2,pending:validity==='pending'?'queued':null}]);store.knownStates.upsertMany([{worktreeId:id,check:{kind:'test',project:'',testPath:path,fullName:'works'},outcome,validity,pendingPhase:validity==='pending'?'queued':null,observedAt:2,commit:null,origin:{kind:'own'},durationMs:1,location:null,summary:null,fingerprint:null}]);}
try {
 for(const timing of ['during-wait','before-response']){
  const r=fixture(),{id,store,now}=seed(r);
  store.revisions.append({worktreeId:id,createdAt:now,head:null,dirty:false,trigger:'watch',changes:[]});
  file(store,id,'a.test.ts');file(store,id,'b.test.ts','pending');
  const open={id:'c0',kind:'baseline',revision:2,startedAt:now,done:1,total:2};
  store.checkpoints.start({...open,worktreeId:id,testFiles:[{project:'',path:'a.test.ts'},{project:'',path:'b.test.ts'}]});
  store.meta.set(checkpointMetaKey(id),JSON.stringify(open));
  const checkpoint=store.checkpoints.start({id:'c1',worktreeId:id,revision:2,kind:'run-all',testFiles:[],startedAt:now});
  const complete=()=>{file(store,id,'b.test.ts');store.checkpoints.finish('c0','completed',Date.now());store.checkpoints.finish('c1','completed',Date.now());store.meta.set(checkpointMetaKey(id),'');};
  let timer;
  const server=createServer(socket=>socket.once('data',data=>{
   const request=JSON.parse(data.toString());
   let answer={ok:true,type:request.type};
   if(request.type==='ping')answer={...answer,pid:process.pid,worktreeId:id,root:r,squealVersion:'0.1.134',phase:'ready',startedAt:now};
   if(request.type==='run-all'){
    if(timing==='before-response')complete();else timer=setTimeout(complete,100);
    answer={...answer,requestId:'r1',checkpoint,error:null};
   }
   socket.end(JSON.stringify({schemaVersion:1,...answer})+'\n');
  }));
  await new Promise(resolve=>server.listen(join(r,'d.sock'),resolve));
  try{const result=await run(r,['run','--all','--wait','2000']);report({probe:'joined-counts',timing,code:result.code,first:result.stdout.split('\n')[0]});}finally{clearTimeout(timer);await new Promise(resolve=>server.close(resolve));store.close();}
 }
 {const r=fixture();const result=await run(r,['run','--all','--wait','110000','--','--reporter=dot']);report({probe:'bare-flags-result',code:result.code,stderr:result.stderr});}
} finally {for(const root of roots)rmSync(root,{recursive:true,force:true});}
```
