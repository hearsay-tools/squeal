# Wave 11g re-review: 001-118

## Verification

Candidate: `581f5022c4a0d519b3070e9857f232d7452513f0` (0.1.25). This re-review is bounded by `reviews/wave-11f.md`: close B1, S1 and S2, inspect the 001-118 delta, and record new issues as notes. The worker range starts with `b8dc449` and ends with `25ebd10`, cherry-picked as `34000f8`, `31a53b4`, `b139eae`, `411fbb0`, `57021d3`, `ae8f39f` and `64bfec5`. Other rows included in the build are outside this review.

Initial HEAD was `3911ad08c0f741d25afda3b43e391c9760365ba8`. The coordinator explicitly authorized that documentation-only descendant (board and this task's brief), with no mismatch finding needed. All verification and probes ran detached at the requested candidate. `git status --short` was empty before verification, after build, after the probes and after their removal. The task branch was restored before writing this file. No candidate code was changed.

```text
$ git rev-parse HEAD
581f5022c4a0d519b3070e9857f232d7452513f0
$ npm ci
added 56 packages, and audited 57 packages in 2s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
$ npm run lint
> squeal@0.1.25 lint
> biome check .

Checked 509 files in 187ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.25 typecheck
> tsc --noEmit
$ npm run build
> squeal@0.1.25 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.25 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
$ git status --short
(no output)
$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output; exit 0)
```

Install, lint, typecheck and build passed. Neither committed plugin drifted. The task and repository explicitly require a manual full-suite run, which is the Squeal skill's gate exception. One full suite ran:

```text
$ npx vitest run
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/68334dea-64c5-436e-87ee-bd0c19ac3bce

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/68334dea-64c5-436e-87ee-bd0c19ac3bce/test/fixtures/scheduler/.tmp/867f473a-858f-4c31-963a-3f3f30732227/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/68334dea-64c5-436e-87ee-bd0c19ac3bce/test/fixtures/scheduler/.tmp/2fc4561f-4229-4400-99c1-3f4eb5df04c5/main/.git/worktrees/staged/gitdir
 ❯ test/e2e/worktrees.test.ts (8 tests | 1 failed) 91550ms
   ❯ a second worktree, claude-code (4)
     × bootstraps with zero runs and inherited provenance 10718ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/e2e/worktrees.test.ts > a second worktree, claude-code > bootstraps with zero runs and inherited provenance
AssertionError: expected { …(6) } to match object { code: +0, stdout: '', stderr: '' }
(4 matching properties omitted from actual)

- Expected
+ Received

  {
    "code": 0,
    "stderr": "",
-   "stdout": "",
+   "stdout": "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolBatch\",\"additionalContext\":\"SQUEAL · a daemon is validating again at revision 0\\nRevision 0: 5 current, 0 pending, 0 stale, 0 unknown. Inherited: 5 of 5 current. Full-suite checkpoint: completed at revision 0.\"}}",
  }

 ❯ test/e2e/worktrees.test.ts:62:19
     60|     // The consumer registered before the lookup: inherited passes are…
     61|     const batch = await e.hook("post-tool-batch", wt2, { session_id: O…
     62|     expect(batch).toMatchObject({ code: 0, stdout: "", stderr: "" });
       |                   ^
     63|
     64|     // A session that starts now registers against the inherited state.

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 187 passed | 1 skipped (189)
      Tests  1 failed | 1585 passed | 10 skipped (1596)
   Start at  01:16:18
   Duration  149.14s (tests 97%, transform 2%, import 1%)
```

The suite is **not green**. The sole failure is `test/e2e/worktrees.test.ts:62`, outside the 001-118 range: the assertion expects an empty PostToolBatch after inherited baseline completion, but receives a liveness recovery header with five current inherited checks and a completed checkpoint. D6 permits delivery when liveness changes. This output alone does not prove incorrect state or establish this wave as the cause. Classification as a wave regression is **unverified**; this is a recorded verification limitation, not a blocker or a finding against 001-118. Load average sampled during the run was 50.66 to 59.63; that does not prove causality. No full-suite retry replaced the failure with green evidence.

Independent throwaway probes lived under ignored `node_modules/.cache/wave11g` and were removed before this file was written. They used each **committed shipped CLI and hook bundle**, rather than only a source CLI or freshly built hooks. The original B1 fixture ran independently for each plugin. The third case checked watcher boundaries:

```text
$ npx vitest run --config node_modules/.cache/wave11g/probe.config.ts
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/68334dea-64c5-436e-87ee-bd0c19ac3bce


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  01:17:21
   Duration  49.42s (tests 87%, transform 11%, import 2%)
```

The following assertions passed for each plugin:

1. Baseline: five test files, eleven passing checks, committed `src -> ../linked-source`, `preserveSymlinks` enabled and source-directory test globs.
2. Adding failing `src/added.test.ts` creates a revision naming it in under ten seconds, before the 30-second idle pass; it is listed as the sixth file, fails, and its shipped tool-boundary hook reports it.
3. Shipped `run --all --force --wait` reports six files, completes its checkpoint and names `FAIL  src/added.test.ts > new failure`.
4. Editing existing `src/math.ts` creates a revision in under ten seconds, and the shipped hook delivers `PASS -> FAIL` for the affected math test.
5. Deleting the added test removes it from the test-file list.
6. A `squeal-links-*` query tree exists under the real daemon's private `daemonScratch(...).tempDir`, outside the worktree. D10 scratch adoption precedes watcher startup; the query adds no file inside the worktree.
7. After SIGSTOP and 10.5 seconds of heartbeat grace, no-op Bash, `mcp__filesystem__write_file` and `brand_new_editor` boundaries each report "any change this call made has no result." The custom-name cases write a file while the daemon is stopped. None says "this edit". The daemon is continued before cleanup. These are recorded payloads and actual file writes, not an installed MCP server invocation.

The changed-area tests also passed in the full run: the symlinked-source and symlinked-install daemon files, both new watcher files, and liveness/hung-daemon cases. The generous elapsed-time allowances distinguish direct observation from idle discovery; this review does not claim a measured exact 500 ms upper bound under this host load.

A focused boundary follow-up asserted and observed a real watch event for S1 below, without repeating the two-plugin proof:

```text
$ npx vitest run --config node_modules/.cache/wave11g/probe.config.ts -t classification
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/68334dea-64c5-436e-87ee-bd0c19ac3bce


 Test Files  1 passed (1)
      Tests  1 passed | 2 skipped (3)
   Start at  01:19:39
   Duration  2.58s (tests 53%, transform 42%, import 6%)
$ cat /tmp/wave11g-boundary.txt
foreign-sub/o.ts observed; foreign/sub/o.ts absent; nested links and root/ancestor targets not walked
untracked source addition observed in watch batch
checkIgnored warmed mean 20 calls: 4.25 ms plain, 21.87 ms linked
```

Both directory-only `node_modules/` and slashless `node_modules` patterns classify a descendant of a linked install as ignored while retaining a source descendant. An earlier warmed 20-call measurement at the same candidate was 3.80 ms plain and 9.37 ms linked; the final measurement above was 4.25 ms and 21.87 ms. The extra work is small relative to the debounce in these probes. Source inspection confirms one additional directory-ignore query on a warmed linked batch, with scratch `.gitignore` copies; the first query also resolves the git directory. Ordinary batches make no scratch query. These are local observations, not a universal cost guarantee.

The background status was also read through the shipped CLI because `squeal` is not on PATH. Its evidence is separate from the manual suite above:

```text
$ node plugins/codex/dist/cli/squeal.mjs status --wait 60000
Returned without a daemon: no daemon has validated since 2026-10-07T23:19:49.634Z; results are as of revision 1
Revision: 1
Known failures: 0
Affected checks: 678 passed, 0 running, 0 queued
Full-suite checkpoint: none completed at any revision
Test files without checks: 127 pending, 0 unknown
```

That background snapshot does not certify a full suite. No success claim here relies on its zero known failures.

## Verdict

**PASS 581f5022c4a0d519b3070e9857f232d7452513f0**.

0 blocking findings, 1 new should-fix note, 0 nits. The note is **proven**, nonblocking under the bounded re-review instruction. Prior wave-11f B1, S1 and S2 are closed. Full-suite success is not claimed.

## Blockers

None. The original B1 failure scenario no longer reproduces with either shipped plugin.

## Should-fix

### S1. Proven, nonblocking: a link into another repository's subdirectory is observed

Changed boundary: `src/core/watcher/candidates.ts:181-183`. `NestedRepoProbe.isInside` at lines 196-204 checks ancestors of the **virtual worktree-relative link path**, rather than ancestors of the resolved target. The resulting map is passed to `LinkedWatches.update` and its targets are walked at `candidates.ts:145-147`.

D2: "a link to the root or above it, or to another repository, is not observed." D1: another repository is "opaque to the parent: never watched, never validated."

Reproduction in a fresh watcher fixture:

1. Create a sibling repository `other/.git`, directory `other/sub` and `other/sub/o.ts`.
2. Add `foreign -> ../other` and `foreign-sub -> ../other/sub` to the source worktree.
3. Start ChangeFeed with the real Linux backend and a 60-second idle interval. `foreign/sub/o.ts` is absent from its startup batch, as intended. **`foreign-sub/o.ts` is present.**
4. Write `foreign-sub/new.ts`. The feed emits a `watch` batch naming it within five seconds. The probe asserts that event, so this is direct observation, not only an overly broad startup list.

The target root's `.git` blocks the first link, but no `.git` appears along the second link's virtual ancestors, so both its initial walk and target subscription escape the boundary. This fixture does not prove that the foreign file was run as a test; observation alone is the demonstrated D2 mismatch.

Fix sized for one watcher worker: make link admission identify the repository containing the resolved target, including targets below its root. Reject a target belonging to a different repository while retaining ordinary external source directories and links within this worktree. Define the rule for an ordinary external directory that happens to sit under an enclosing repository, so the sibling-source B1 fixture is not accidentally excluded. Cover a foreign repository root, foreign subdirectory, foreign linked-worktree subdirectory, ordinary external directory and target within this worktree. Assert no enumeration or watch events for rejected targets. Reuse the admission decision for hint-triggered and periodic reconciliation. No runner, delivery or schema change is needed.

This is a new note, not a reopening of wave-11f B1, which tested an ordinary sibling source directory and is fixed.

## Nits

None.

## What fits

- **Wave-11f B1 closed, proven:** source descendants survive candidate filtering, reconciliation walks the admitted source link, target events map to worktree-relative paths, runner refinement discovers the new test and the completed forced checkpoint includes it. Both shipped plugins exercise this path, existing-source changes and test deletion.
- **Wave-11f S1 closed, proven:** `src/core/delivery/format.ts:148` qualifies whether a call made any change. No-op Bash repeats the conditional sentence through both shipped plugins while no daemon validates. D9 and the tests carry the wording.
- **Wave-11f S2 closed for the reviewed contract, proven:** `src/harness/shared/deliver.ts:34-35` treats unknown names as potentially editing. Recorded custom-write and previously unseen names produce repeated warnings. Installed third-party tool integration is not claimed. Codex keeps its existing conservative default; no tool filter was silently added in this wave.
- Linked installs remain excluded under both requested patterns; known closure and installed-lockfile extras remain eligible. The full-run linked-install daemon regression starts and hashes the installed lockfile. Source-link classification works for committed and untracked links; the independent untracked-link addition gets a direct watch batch.
- Root and ancestor links are not walked, nested links inside admitted targets are not followed, and a link to a foreign repository root is opaque. S1 identifies the missing foreign-subdirectory case.
- The link-target map and `relinked` seam agree on realpaths. A write behind an unchanged link does not request full reconciliation, as asserted by the committed README stat probe. New, changed and removed links retain reconciliation behavior. Watcher-local `ReconcileCandidates` and `HintCandidates` changes are consumed in the implemented argument order. No schema, runtime dependency or public core/runner/harness type was added.
- The scratch query uses the worktree's git directory, copies ancestor `.gitignore` files and has passing `info/exclude` coverage. It lives in the daemon's private temp directory and serializes per root. Extra query cost was measured without evidence requiring a cost finding.
- Section-by-section scope: D1/D2 were followed through link admission, opacity, discovery and observation; D3/D4/D5 through linked-lockfile extras, new-test refinement and checkpoint completeness; D6/D7 through delivered failure and conditional liveness text; D9/D10 through named-tool classification and private scratch adoption. D8's transactions and D11/D12's policy/error contracts are unchanged by this row. Split-batch refusal behavior settled by wave-11f was not re-prosecuted.

## Inputs for the next wave

No fix wave is required to close wave-11f B1/S1/S2. The coordinator can close the requested 001-118 repair and choose whether to schedule new S1 separately. Keep that row inside watcher code and watcher tests. Its seam is `candidatesForReconcile` returning `{ paths, linkedDirs, links }`: filter admission before walking and before passing `linkedDirs` to `LinkedWatches.update`. Keep `links` as the seen-target map that avoids redundant reconciliation. Preserve 100 ms quiet/500 ms maximum debounce, 30-second idle reconciliation, hook 2 s limit, socket 100 ms cap and two-heartbeat grace. Do not compensate with a suite run or target walk at every tool boundary.

Preserve the passing two-plugin B1 fixture and both linked-install patterns. Keep ordinary external source directories eligible; reject foreign-repository subdirectories before enumeration or subscription. Keep the read-only list explicit, unknown names conservative and no-validation wording conditional.

The recorded full-suite worktree silence assertion needs its owning coordinator to assess liveness expectations and startup timing. It is not evidence that this watcher repair should be rewritten, and it was not repaired in this review.
