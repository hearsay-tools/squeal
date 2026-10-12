# Wave 13ao review

Candidate: `ba491ae6b1936d80b71f2cee19534b72923f4c45` (0.1.130).
Range: `40d05958..ba491ae6b1936d80b71f2cee19534b72923f4c45`.
Rows: 001-299 and 001-300; reviewer row 001-301.
Contracts: 001 goals 3 and 5, D1, D2 and D12; board rows' done-when; `research/nested-worktree-watch.md` R1 to R3.

## Verification output

HEAD matched the assigned candidate before installation. The tracked tree was clean before and after every check and probe. Node v24.21.0, git 2.43.0, Linux. These are independent reviewer checks, including a full Vitest run rather than a Squeal checkpoint. No product code changed. Build regenerated both plugins without tracked drift.

```text
$ git rev-parse HEAD
ba491ae6b1936d80b71f2cee19534b72923f4c45
$ git status --short
[empty]

$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
[exit 0]

$ npm run lint
> squeal@0.1.130 lint
> biome check .
Checked 911 files in 518ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.130 typecheck
> tsc --noEmit
[exit 0]

$ npm run build
> squeal@0.1.130 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.130 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run
Test Files  426 passed | 1 skipped (427)
     Tests  3504 passed | 10 skipped (3514)
  Start at  14:22:53
  Duration  249.23s (tests 95%, import 3%, transform 2%)
[exit 0; 0 failed]

$ git diff --exit-code
[empty; exit 0]
$ git diff --cached --exit-code
[empty; exit 0]
```

The full suite also printed two scratch-fixture `git worktree repair` notices and its normal cleanup of one process left by an earlier test run. It reported no cleanup error. No human checkout or daemon was altered by the reviewer. No agent tooling, eval runner, calibration or release operation was invoked.

Standalone probes loaded the freshly built product modules at the clean candidate. They used scratch repositories under `/tmp`, with `GIT_CONFIG_GLOBAL=/dev/null` and `CODEX_SESSION_ID` unset. For watch counts, `fs.watch` was replaced before chokidar loaded, followed by `syncBuiltinESMExports`: an EventEmitter handle counted each active path and removed it on close. These probes took no native watches. Other probes used fake backends. Scratch repositories and subscriptions were removed or closed. The programs were throwaway and are not part of the committed tree; their discriminating outputs and methods are recorded below.

## Verdict

**PASS. 0 blockers, 1 should-fix, 0 nits.**

The ordinary paths satisfy R1 to R3 and the rows' done-when. S1 is a proven recovery defect after an injected subscription failure; reconciliation still supplies the fallback. It does not block this wave.

This judgment covers the watcher rows. The range also carries 001-302, assigned to reviewer 001-303, and the 006 eval changes. Passing the combined suite is not a separate review verdict on those changes. Spec-folder review and lessons files were not prosecuted.

## Blockers

None.

## Should-fix

### S1. A failed linked-watch replacement records exclusions it did not install

**Proven, non-blocking.** `src/core/watcher/linked-watch.ts:170` assigns `target.excluded = excluded` before awaiting `subscribe`. If the replacement rejects, `step` reports the error and retains the old subscription, but retains the new exclusion list too. On the next full recompute, `apply` returns at line 167 because the computed exclusions match that incorrectly recorded list. There is no retry, and no freed-directory hint.

Failure scenario: an observed `lib -> ../target` contains `gen/a.ts` and a target `.gitignore` naming `gen/`. The first subscription excludes `gen`. Remove that rule, then have the replacement backend subscription reject once. A later successful reconciliation recomputes the empty exclusion list but never attempts a third subscription. The old watch still excludes `gen`, so subsequent edits there rely on reconciliation instead of watch hints. In the narrowing direction, an old subscription can likewise retain watches for the subtree it was supposed to release.

Independent reproduction used the public `LinkedWatches.update` interface and a fake parcel backend. `watch` recorded specs, returned a subscription on its first call, rejected only its second call with `transient subscription failure`, and would succeed on subsequent calls. After the ignore edit, two successive `update(new Map([["lib", target]]))` calls produced:

```json
{"subscriptionsAttempted":2,"initialExclusions":["gen"],"oldClosed":false,"freedHints":0,"errors":["transient subscription failure"]}
```

The relevant D2 contract is that exclusions are recomputed "on each reconciliation" and that the watcher watches a project link's target. This recovery defect does not invalidate the ordinary successful path or remove D2's reconciliation walk. D12 still reports the error and triggers a pass. No stale-result escape was demonstrated. Native macOS failure behavior was not exercised.

Fix sized for one worker: pass the proposed exclusions to `subscribe` without mutating the installed state; publish `target.excluded` and `target.sub` only after the new subscription succeeds, then close the old one and report freed directories. Keep the old state on failure. Add a fake-backend regression test where one replacement rejects and the next update retries, installs the new exclusions, closes the old watch and reports the freed directory. No interface change is needed.

## Nits

None.

## What fits

### Ignore exclusions, resource use and recovery of a widened watch

`git.ts` now uses D2's command without `--no-empty-directory`. The new watch-spec case covers untracked `.ai/cezar/.gitignore`, worktrees, runs, temporary directories and `packages/new/node_modules`. `watch-spec.test.ts` also retains the `logs/` case: a directory whose files are all ignored remains watched when the directory itself is not ignored.

The independent counting fixture contained a real nested worktree with 5,000 generated files, 2,000 files each in ignored Cezar runs and temporary trees, a 2,000-file install under an untracked package, and a linked target with a 2,000-file ignored install. Its own source paths and metadata remained small. Counts were:

```json
{"phase":"start","watches":18,"peak":18,"ignoredCezar":0,"packageInstall":0,"linkedInstall":0,"linkedOwn":4,"logs":1,"errors":[]}
{"phase":"extra","extraWatched":true,"packageInstall":1}
{"phase":"narrow","outWatched":0,"watches":17}
{"phase":"widen","outWatched":2,"watches":19}
{"phase":"closed","watches":0}
{"phase":"guard-without-spec-exclusion","watches":3,"nestedContents":0,"errors":[]}
```

The extra file was `packages/new/node_modules/d0/f0.js`, explicitly added through `setExtraFiles`; the count was taken after chokidar's asynchronous add settled. Narrowing added `out/` to `.gitignore` and ran an interval reconciliation; widening removed it and reconciled again. Both the directory and its file regained watches. A separate backend-only fixture deliberately supplied no nested-repository exclusion: its nested `.git` marker and 5,000 generated files yielded only three watches, none on the generated subtree. This exercises the predicate independently of the git-derived exclusion list.

`chokidarBackend.update` replaces the subscription when exclusions grow. Opening the new watch before closing the old one releases the whole old subtree and preserves hints on kept paths. The candidate's full-suite tests also verify a worktree added while watching, subtree release after a missed hint, writes after narrowing, ordinary directories after ignore removal, ignored extra-file delivery and linked artifact delivery. No change was made to the tracked/extra-file reconciliation contracts.

### Linked exclusions and mapped hints

`linkedExclusions(root, links, target, dirs?)` and `LinkedWatches` agree on absolute target paths and relative link paths. The exclusion query uses the existing serialized scratch-tree machinery, including target `.gitignore` files read through the link. It excludes only directories ignored under every link to that target, leaves out nested repositories, and does not follow links inside the target.

Full recomputes run on reconciliation and `.gitignore` hints; incremental recomputes examine added directories and `.git` holders. Successful replacement waits for the new watch, closes the old one, and maps freed directories as `unknown` hints under each link. Tests cover target-local ignore rules, several links' intersection, a new install, source writes under the link and ignore removal. The independent fixture's linked install had zero watches, while its target retained four watches on its own paths.

D2 explicitly keeps descendants' existing link classification. A directory excluded from the target watch is still walked during reconciliation. Delayed discovery of a change in such an excluded directory is the accepted amendment, not a new finding. Explicit ignored closure and artifact files retain their separate extra-file watches; `linked-artifact-watch.test.ts` passed in the independent suite.

### Reconciliation coalescing and the watch-limit note

A pending pass is cleared when it starts, so a request arriving during that pass can queue a follow-up. The queued pass reads filesystem state when it runs; no candidates are captured at request time. `interval` wins when joined, preserving the scheduler's install check at `scheduler.ts:200`.

An independent fake-backend probe held delivery of the first pass, created `later.ts`, queued nine more requests, then released the first pass:

```json
{"phase":"coalescing","passes":2,"lastTrigger":"interval","laterIncluded":true}
{"phase":"watch-limit","passes":1,"notes":1,"note":"squeal: the system refused a file watch (EMFILE); raise fs.inotify.max_user_watches (ENOSPC) or the open-file limit (EMFILE). Until the daemon restarts, changes to the paths it could not watch are found by the 30 s pass only."}
```

The second line followed 200 alternating EMFILE/ENOSPC injections. Other backend errors still use the ordinary reported-error path. `UnlistedDirs` records the outermost ignored ancestor only after an unchanged rebuild, and clears its cache on spec input hints and changed specs. The candidate's storm tests cover 20 separate directory batches under an intentionally unlisted ignored directory with at most one rebuild, ordinary error reporting, and joined passes.

No header, status or delivery shape changed in these watcher rows. Changes still pass through candidate filtering, re-stat/hash reconciliation and the scheduler; counts are not optimistically promoted by coalescing. The build and key-format guard passed at the combined candidate.

## Inputs for the next wave

- No blocking fix wave is required for 001-299 or 001-300. Do not reopen the ordinary ignore, counting, link-mapping or queue cases settled above without a new diff affecting them.
- S1 can be one watcher worker owning `linked-watch.ts` and a focused fake-backend test. Preserve `LinkedWatches.update(Map<relative link, absolute target>)`, `linkedExclusions(root, links, target, dirs?)`, and ready-before-close replacement order. The proposed exclusion list becomes installed state only after successful subscription.
- Preserve at most one queued reconciliation in addition to an active pass. A joined `interval` must remain `interval`; its scheduler install check is part of the seam. Reconciliation promises still settle after batch delivery.
- Preserve D2's 100 ms quiet / 500 ms maximum debounce and 30 s idle reconciliation, explicit extra-file watches, and the accepted classification of descendants under project links. This wave does not introduce key-input-only watching or a per-directory Linux backend.
- Native macOS behavior remains unverified, as allowed by the spec's v1 non-goals. This review does not authorize host watch-limit changes, restarting human daemons, or releasing the candidate. The coordinator still needs the separate 001-303 judgment and any other review coverage required for the release.
