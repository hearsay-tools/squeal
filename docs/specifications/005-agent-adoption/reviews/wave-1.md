# 005 wave 1 review

FAIL `d1d3522ab051804971b30adc6eb3e473b92ee93e`: **3 proven blockers**, 2 proven should-fix items, 2 notes (1 proven, 1 plausible), no nits.

## Verification

Range: `ce1425a1^..d1d3522a`. Reviewed 005-10, 005-11, 005-12, their integration and bundles. Other coordinators' 001/006 commits and this spec's reviews/lessons are outside scope. Inputs: D1–D5, the accepted choices in `status.md`, and the wave-1 briefs.

Initial `git rev-parse HEAD` was `5a8a585a3cf8280584cce1b8e21c1e39121aec0f`, the review-brief-only child of the candidate. This is a **proven, nonblocking checkout mismatch**, resolved for verification by temporarily checking out the exact candidate. The report is committed back on `cez/755e5d81`. Product source and committed bundles are identical on those two commits.

Verification output is condensed to the substantive command results. Commands below ran on a clean tree at `d1d3522ab051804971b30adc6eb3e473b92ee93e`. No Claude or Codex subject session ran. The independent suite is `npx vitest run`, not Squeal's checkpoint.

```text
$ git rev-parse HEAD
d1d3522ab051804971b30adc6eb3e473b92ee93e
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
  @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
  esbuild@0.28.2 (postinstall: node install.js)
(exit 0)
$ npm run lint
> squeal@0.1.133 lint
> biome check .
Checked 933 files in 1242ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.133 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.133 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.133 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(no output)
$ npx vitest run
FAIL test/daemon/escaped-overlap.test.ts:349:31
  names both overlapping runs, uncertain, for an unmarked orphan of the group
  AssertionError: expected true to be false (isAlive(orphan))
FAIL test/watcher/linked-exclusions.test.ts:135:5
  stops watching an install made after the watch started
  Error: condition not met in 3000 ms
Test Files  2 failed | 433 passed | 1 skipped (436)
Tests       2 failed | 3588 passed | 10 skipped (3600)
Duration    303.24s
(exit 1)
$ npx vitest run test/daemon/escaped-overlap.test.ts test/watcher/linked-exclusions.test.ts test/keys/key-format.test.ts
Test Files  3 passed (3)
Tests       41 passed (41)
Duration    6.42s
(exit 0)
```

The full run is **red**, not replaced by the focused rerun. Both failed tests and their product boundaries are unchanged in this candidate range, so they are not findings against this wave. They passed on the isolated rerun; this proves the observed failures did not reproduce in that run, not their cause. The key-format guard also passed. The full run passed all changed CLI/setup/verdict tests, including the real-daemon failing-checkpoint test. No second full run was used to seek a green result.

The first suite attempt was interrupted by a connection reset before a final result. Its partial output is unverified and is not used as wave evidence. The completed attempt above is the verification record. Focused probes ran against the freshly compiled candidate's `dist/`, with scratch repositories under `/tmp`; they changed no tracked file.

## Blockers

### B1. Proven: a named-file deadline permits a pass before reconciliation

**Location:** `src/cli/status-wait-paths.ts:194` (deadline bypass), `:206` (settled before timeout), `:229` (exit code).

D2: "The wait returns when every selected file has a result for its current key at the current revision, or at the deadline." D1 exit 0 requires current results and the worktree still at that revision. Vision: "An old result never gets to pose as the current truth."

A user saves a test file while its previously passing result is in the store. The daemon is alive, but has not reconciled that edit before the named wait's deadline. `ready = final || ...` bypasses both the pending sync and the revision comparison. Because the old key has no pending phase, the wait reports `settled`, prints "each with a current result", and exits 0. It also does so if sync has already answered revision 2 while the store snapshot still holds revision 1. This is the pre-reconciliation false pass the sync barrier is meant to prevent.

**Probe:** call `namedWaitCommand` on a real scratch store at revision 1 with one current passing test, write an edited test on disk, then provide the public sync option as either pending or synced at revision 2. Deadline 10 ms, poll 5 ms, settle 0. Both calls produced:

```text
sync={state:"pending"}
code=0
Named test files at revision 1: no known failures; 1 test file, each with a current result, after 0.0 s
sync={state:"synced",revision:2,incarnation:null}
code=0
Named test files at revision 1: no known failures; 1 test file, each with a current result, after 0.0 s
```

**One-worker fix:** separate readiness from the right to return at a deadline. At a deadline before readiness, return timeout/no verdict (3), including when sync names a revision the snapshot has not reached. Keep the accepted unsupported-daemon fallback and successful ready-at-deadline behavior. Add tests for both probe states, an edit before the wait, and a ready final read with a current pass/failure. Do not change pathless waits or queue priority. Own `status-wait-paths.ts`, its wording in `status-wait-lines.ts`, and named-wait tests.

### B2. Proven: rewording a compound gate removes other required checks

**Location:** `src/cli/setup/gates.ts:130`.

D5: "The test command becomes `squeal run --all --wait <ms>`". It authorizes replacement of the test command. Squeal does not cover lint/build, which remain the repository's gate.

A committed instruction line says: `Run` followed by the code span `npm run lint && npx vitest run && npm run build`. The plan offers it for rewording. `init --gate CLAUDE.md:1=reword` exits 0 and writes:

```markdown
Run `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm run lint && npx vitest run && npm run build` instead.
```

The normal path now runs neither lint nor build. They survive only in the fallback. This is not confined to rendering: the CLI probe wrote this exact file.

**One-worker fix:** preserve other shell commands when replacing the test invocation, or mark a compound span as not safely rewordable (`proposed: null`) and require a manual edit. The latter is a small conservative fix using the existing refused-edit contract. Test `&&`, `;`, multiple invocations and environment prefixes; ensure untouched validation commands remain on the normal path or that the whole edit is refused without writes. Own `setup/gates.ts` and gate/init-flags tests.

### B3. Proven: remove cannot undo a supported nested block write

**Location:** `src/cli/setup/block.ts:203`, especially the fixed root-only list at `:206`; accepted custom paths are applied in `src/cli/setup/apply.ts:185`.

D3 exposes `--block <file|none>`. D4: "`squeal remove` deletes the block and lists it under 'Still there' when it cannot." Row 005-12's done-when includes "`remove` taking it out".

In a scratch repository with a `docs/` directory, `init --block docs/AGENTS.md` exits 0 and creates a managed block. `remove` exits 0, but `docs/AGENTS.md` still contains `squeal:begin`. Removal checks only root `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`; it neither removes nor lists the nested file. Nested `AGENTS.md` is an instruction surface for work in that directory.

```text
custom-block-init: code=0
custom-block-remove: code=0, left=true
```

**One-worker fix:** make supported block destinations discoverable during removal, including untracked files created by setup, and deduplicate real paths as today. Alternatively refuse destinations the removal contract cannot support before the harness setup writes anything, with the coordinator explicitly narrowing the spec if needed. Add a nested-file CLI round trip and an unterminated nested block listed under "Still there". Preserve root symlinks and instruction text. Own `setup/block.ts`, `setup/apply.ts`, the remove seam if needed, and block/init-flags tests.

## Should-fix

### S1. Proven, nonblocking: `setup --check` exits 0 for an invalid tracked config

**Location:** `src/cli/setup/plan.ts:239`, `src/cli/setup/command.ts:35`.

The scratch probe tracks `squeal.config.json`, then writes `{ invalid`. `setup --check` reports `problem: not valid JSON (...)`, ends `Nothing is outdated.`, and exits 0. `config.problems` never contributes to the check result. The plan honestly reports the parser problem, and D3 specifically defines the nonzero condition in terms of outdated items and missing slow inputs, so this is a should-fix rather than a blocking claim that every malformed config must be "outdated". Have the coordinator settle the check contract, then return nonzero for unusable config if that is its intended use. One worker: plan/check tests and `plan.ts` or `command.ts`.

### S2. Proven, nonblocking: a joined checkpoint's final reuse counts misdescribe its work

**Location:** `src/cli/run.ts:154`. Evidence: `test/cli/run-all-verdict.test.ts:258`, "takes the verdict of the running checkpoint it joined".

The fixture has A current and B running when an empty join request starts. B completes while the wait holds. The final line is pinned to "2 already current, 0 run now", because the count comes from the join request's empty `testFiles`, not the checkpoint it joined. The verdict is correct; the explanation of reuse is not. Carry the joined checkpoint's counts into the final rendering, or use neutral counts when the request does not own them. One worker: `run.ts` and its joined-checkpoint test. No verdict API change is needed.

## Notes

- **N1, proven:** initial candidate mismatch, resolved as recorded under Verification. No board or status edits were made. The later wave's planned work is not a missing feature in this wave.
- **N2, plausible, nonblocking:** `src/cli/run.ts:233` / `:257` opens the store for multiple reads without `readTransaction`, unlike `withStatusStore`. A daemon commit between the checkpoint/revision reads and verdict/header reads could combine snapshots, including a revision that advanced after the first revision check. No race was proven here. Consider one read transaction around each checkpoint verdict poll; keep this a note unless a discriminating concurrent probe demonstrates a false verdict.

## What fits

- D1's shared `readVerdict` API is used by both callers in the correct argument order. It distinguishes queued/running, unkeyed, empty, stale and unknown file states and counts test and file failures apart. It does not treat an older `observedAt` as stale by itself: unchanged keys legitimately remain current at later revisions.
- `run --all --wait` has coverage for pass, failure, deadlines, unknown files, abandonment, a recorded newer revision, no daemon, joined and owed checkpoints, and a real daemon's failing checkpoint. It waits for the post-checkpoint failure re-run. Non-waiting runs and `run --slow --wait` retain their existing branches.
- Named selection resolves paths relative to cwd, rejects lexical paths outside the worktree, selects a test by its own path, and uses another worktree's closure only for matching keys. Selection is reread on every poll. Tests cover a file listed after the wait starts, pending named work ending while unrelated work stays pending, selected failures, unavailable/no-daemon cases and unmatched text. Pathless status dispatch remains unchanged. The deadline readiness gap is B1.
- `init` with no new flags takes the prior harness implementation; the fixture checks its existing settings write and preserved instruction/config text. Choices are preflighted before the harness write. Gate application precedes block application, so appending a block does not move selected gate line ids.
- Managed root blocks append/replace, refuse a begin without an end, and deduplicate `AGENTS.md -> CLAUDE.md`. Independent CRLF append/remove and symlink CRLF write/remove probes restore the original instruction bytes. B3 concerns supported destinations outside that fixed removal list.
- Setup's JSON is versioned. Codex trust is explicitly `not-checked`, the accepted deferral to 005-14. Bare setup is the accepted usage error pending 005-14. Static candidates are grouped by directory, node:test alone defaults to not slow, `files` evidence is weak, artifact choices are not ranked, and absent ignored builds are named as not built. Candidate fixtures reproduce 005-04's table.
- KEY_FORMAT_VERSION 9 reflects the guarded `main.ts` dispatch change. `src/cli/setup/` stays in the CLI exemption; the new dispatch seam is explicitly enumerated in `test/keys/key-format.test.ts`. Build verification shows no committed bundle drift. No runtime dependency was added.

## Inputs for the fix and next waves

Dispatch B1, B2 and B3 as three repairs. B2 owns gates; B3 owns block destinations/removal. Both may need `init-flags.test.ts`, so assign that test file to one repair or integrate sequentially. No worker edits the board. Re-review these blockers against the repair delta; the independent suite failures recorded above need their own triage, not source changes by this reviewer.

005-14/005-19 must call the versioned plan first, collect explicit per-choice answers, and apply using `init --block`, `--gate`, `--slow`, `--input`. Gate ids are based on pre-edit line numbers: gates before block insertion. B3 must settle what destinations that flow may offer. Codex trust still needs the planned read-only export; do not infer trust from a cached install.

Warm-up starts the terminal daemon then calls `run --all --wait`; it does not use named status as a checkpoint. Handle 0/1/3 as separate outcomes. Claude Code's gate budget remains 110000 ms and deadline exit 3 means retry; no queue promotion is added. Dynamic ignored-path suggestions and >30 s candidates remain 005-14/001-307 work. Status/header unit separation remains 005-21 after 001-292. No subject sessions were used to test those future flows.

## Reproduce the blockers

After `npm run build` on the candidate, save the script below as `/tmp/005-wave-1-probe.mjs` and run `node --disable-warning=ExperimentalWarning /tmp/005-wave-1-probe.mjs` from the repository. It seeds a real SQLite store, injects the public sync option, and exercises init/remove through the CLI. It writes only its own scratch repository and deletes it afterwards.

```javascript
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const base = process.cwd();
const load = (p) => import(pathToFileURL(join(base, 'dist', p)).href);
const { openStore } = await load('core/store/open.js');
const { worktreeIdFor } = await load('core/fs/index.js');
const { namedWaitCommand, selectNamedFiles } = await load('cli/status-wait-paths.js');
const { blockText, withBlock, withoutBlock, writeBlockFile, removeBlocks } = await load('cli/setup/block.js');
const { main } = await load('cli/main.js');
const { reword } = await load('cli/setup/gates.js');
const root = mkdtempSync('/tmp/005-13-probe-');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {stdio:'pipe'});
git('init', '-q');
const id = worktreeIdFor(root);
const store = openStore(join(root, '.git'));
if ('reason' in store) throw new Error(store.reason);
const now = Date.now();
const file = { project:'', path:'a.test.ts' };
const daemon = { socketPath:join(root,'daemon.sock'), startedAt:now, heartbeatAt:now, heartbeatIntervalMs:5000, squealVersion:'0.1.133' };
store.worktrees.upsert({ id,root,commonDir:join(root,'.git'),isMain:true,registeredAt:now,daemon });
store.revisions.append({worktreeId:id,createdAt:now,head:null,dirty:false,trigger:'watch',changes:[]});
store.testFileKeys.upsertMany([{worktreeId:id,testFile:file,key:'old-key',revision:1,pending:null}]);
store.knownStates.upsertMany([{worktreeId:id,check:{kind:'test',project:'',testPath:file.path,fullName:'passes'},outcome:'pass',validity:'current',pendingPhase:null,observedAt:1,commit:null,origin:{kind:'own'},durationMs:1,location:null,summary:null,fingerprint:null}]);
writeFileSync(join(root,file.path), 'throw new Error("edited, not reconciled");\n');
for (const current of [{state:'pending'},{state:'synced',revision:2,incarnation:null}]) {
 let stdout='';
 const code=await namedWaitCommand([file.path],false,{cwd:root,stdout:t=>stdout+=t,stderr:()=>{},env:{}},{timeoutMs:10,pollMs:5,settleMs:0,now:()=>now,sync:()=>({current:()=>current,stop:()=>{}})});
 console.log(JSON.stringify({probe:'named-deadline',sync:current,code,first:stdout.split('\n')[0]}));
}
console.log(JSON.stringify({probe:'compound-gate',before:'Run `npm run lint && npx vitest run && npm run build`.',after:reword('Run `npm run lint && npx vitest run && npm run build`.')}));
const original = '# Agents\r\n\r\nKeep this instruction.\r\n';
console.log(JSON.stringify({probe:'crlf-roundtrip',equal:withoutBlock(withBlock(original,blockText()))===original}));
writeFileSync(join(root,'CLAUDE.md'),original);
symlinkSync('CLAUDE.md',join(root,'AGENTS.md'));
writeBlockFile(root,'AGENTS.md',blockText());
const edits=removeBlocks(root);
console.log(JSON.stringify({probe:'symlink-crlf-remove',edits,equal:readFileSync(join(root,'CLAUDE.md'),'utf8')===original}));
store.close();
rmSync(root,{recursive:true,force:true});

{
const root=mkdtempSync('/tmp/005-13-extra-');
const git=(...a)=>execFileSync('git',['-C',root,...a],{stdio:'pipe'});
git('init','-q');
writeFileSync(join(root,'squeal.config.json'),'{}\n');
writeFileSync(join(root,'CLAUDE.md'),'Run `npm run lint && npx vitest run && npm run build`.\n');
git('add','.');
git('-c','user.name=Reviewer','-c','user.email=reviewer@example.invalid','commit','-qm','fixture');
const capture=()=>{let stdout='',stderr='';return {io:{cwd:root,env:{PATH:'',HOME:root},stdout:t=>stdout+=t,stderr:t=>stderr+=t},out:()=>({stdout,stderr})}};
let c=capture();
console.log(JSON.stringify({probe:'compound-gate-cli',code:await main(['init','--gate','CLAUDE.md:1=reword'],c.io),file:readFileSync(join(root,'CLAUDE.md'),'utf8'),...c.out()}));
writeFileSync(join(root,'squeal.config.json'),'{ invalid\n');
c=capture();
console.log(JSON.stringify({probe:'invalid-config-check',code:await main(['setup','--check'],c.io),...c.out()}));
mkdirSync(join(root,'docs'));
c=capture();
console.log(JSON.stringify({probe:'custom-block-init',code:await main(['init','--block','docs/AGENTS.md'],c.io)}));
c=capture();
console.log(JSON.stringify({probe:'custom-block-remove',code:await main(['remove'],c.io),left:readFileSync(join(root,'docs/AGENTS.md'),'utf8').includes('squeal:begin')}));
rmSync(root,{recursive:true,force:true});
}
```
