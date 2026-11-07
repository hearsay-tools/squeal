# Issue 166: a persisted observed path stops daemon startup

Recommend a scoped recovery decision for invalid persisted paths that preserves input provenance and the existing holds.

**Verdict:** reproduced synthetically on Squeal **0.1.414**, source and committed CLI bundle at `b509d603f483e5b869eb11b6cfecc744b057193e`. One saved observed path prevents the daemon from listing tests on first start, restart, and a fresh linked worktree of the same scratch repository. No fix is implemented or authorized here.

## Questions and answers

| Question | Answer and evidence tag |
| --- | --- |
| 1. Does the reported path survive storage and cause closure assembly to fail? | Yes. `ObservedSets.add` stores it; a closed and reopened SQLite store returns it unchanged; both `assembleClosure` and `WorktreeKeys.setClosure` reject it. **verified by experiment**, 0.1.414. |
| 2. Does this prevent startup after a restart or in another worktree? | Yes. The committed CLI exits 1 with `testFilesListed=false` and daemon `down` on all three starts, including the fresh scratch worktree. **verified by experiment**, 0.1.414. |
| 3. Is the stored entry the deciding difference? | Yes in this fixture. Removing only that scratch map entry lets the same bundle list tests and reach daemon `alive`. **verified by experiment**, 0.1.414. |
| 4. Why does it persist, and what decision is needed? | Stored maps check string types but not path validity. C3 requires shared sets that merge and are “never pruned”; C12 expects project paths. Recovery needs an explicit rule for invalid entries without losing valid input evidence. **read in source code**, 0.1.414; **read in official docs**, repository spec at the examined commit. |

## Experiment and exact commands

The session read the issue with:

```sh
gh issue view 166 --repo hearsay-tools/squeal --json title,body,url,comments
git rev-parse HEAD
node -e 'console.log(JSON.stringify({time:new Date().toISOString(),load:require("os").loadavg(),cpus:require("os").cpus().length,node:process.version,squeal:require("./package.json").version}))'
pnpm exec tsx research/probes/issue-166/probe.ts > research/probes/issue-166/result.jsonl 2> research/probes/issue-166/stderr.txt
sha256sum plugins/claude-code/dist/cli/squeal.mjs
```

**verified by experiment, 0.1.414:** initial measured load was 14.99 on 24 CPUs. At the probe it was 16.00; every daemon case passed the load guard. Node was v24.22.1 on Linux. The probe ran from 2026-11-07 22:47:10 to 22:47:12 Europe/Warsaw (21:47:10–21:47:12Z), about 1.8 seconds, exit 0. The CLI bundle SHA-256 was `c44681839af3b88b9056327d1837c4bc7407c7e4b876d756991407cedfbba596`.

The [probe](../../../../research/probes/issue-166/probe.ts) creates a disposable Git repository with one node:test file in project `server`, a separate runtime directory and its own SQLite store. It seeds `observed.server` through the real observed-set API with the literal string `\home\agent\AppData\Local\Hearsay Squawk\cache`. It uses `baseline.onStart=lookup-only`. The exact child command is `node <this-checkout>/plugins/claude-code/dist/cli/squeal.mjs daemon <scratch-root>`; each child's arguments and environment are in the probe. No existing worktree or its store is accessed. The second worktree belongs only to this disposable repository.

| Case | Actual result, 0.1.414; all **verified by experiment** |
| --- | --- |
| Close/reopen store; assemble closure and set worktree closure | Bad string survives; both calls throw the normalization error. |
| First daemon start | Exit 1; tests not listed; daemon down; error persisted in `daemonNotes`. |
| Restart over unchanged store | Same exit, listing state and error. |
| Fresh linked scratch worktree | Same exit, listing state and error from the shared store. |
| Clean scratch-map control | Tests listed; daemon alive; stopped by probe cleanup. |

The exact error is:

```text
squeal: closure of server:read-process.test.mjs: squeal: expected a worktree-relative path, got "\home\agent\AppData\Local\Hearsay Squawk\cache"
```

Full observations are in [result.jsonl](../../../../research/probes/issue-166/result.jsonl). The probe's assertions all passed. No full suite or product tests ran. This establishes the persistence and startup failure, not a passing validation verdict for the fixture's test.

Verification of the research files: `pnpm exec biome check research/probes/issue-166/probe.ts` passed; all local report links resolve. `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-166/probe.ts docs/specifications/011-core/research/issue-166.md` returned exit 3: neither file belongs to a test closure. At revision 3 it reported 0 known failures and 523 of 1,490 test files unknown. No suite pass is claimed; the direct, bounded probe is this report's experimental evidence.

## Mechanism and contract

**read in source code, 0.1.414:** `src/core/keys/observed.ts` names the shared map `observed.<project>`. `SharedPaths.write` merges it; `parse` accepts each string without normalizing it. A fresh `ObservedSets` view reads the map from that store. `WorktreeKeys.setClosure` in `src/core/scheduler/keying.ts` passes the observed paths through `effectiveObserved`; `RuntimeFiles.effective` filters explicitly selected runtime paths, without validating other paths. `assembleClosure` in `src/core/keys/closure.ts` replaces backslashes with slashes during normalization. This string then starts with `/`, so it throws and wraps the error with the test identity.

**read in source code, 0.1.414:** `src/core/scheduler/bootstrap.ts` assembles stored or newly resolved closures during baseline. `resolveClosure` in `src/core/scheduler/revision.ts` calls `setClosure` after the runner-error wrapper has returned. The daemon startup catch in `src/core/daemon/daemon.ts` shuts down with `start-failed` and records “daemon exited: could not start”. The live probe confirms this path reaches the user-visible down state.

**read in official docs, spec at the examined commit:** C3 says observed paths are “shared per project across worktrees” and “merged with what the store holds, never pruned”. Its 2026-10-25 status amendment preserves that rule to avoid missing an intermittent read. C12 says the recorder keeps paths under the worktree and changes no call's result. C9 starts the runner and baseline before the watcher. C13 says a startup death writes a note, and hooks can still serve stored state while a daemon is down. This probe's store opens with SQLite `quick_check`; the defect is path semantics in valid stored text, not a failed database integrity check.

**inferred, 0.1.414:** the decisive tradeoff is recovery of validation versus removal of input evidence. The issue's suggested unconditional drop is not proved safe by this reproduction. A backslash can be part of a POSIX filename, and the fixture deliberately seeds the string instead of proving how the recorder obtained it. The coordinator should seek a narrow recovery contract that reports the rejected entry and preserves uncertainty for its reader. This research does not choose a pruning mechanism or change C3.

## Limits and open questions

- The original Cezarion worktrees, stores, mocked `process.platform` trigger and Vitest run were not inspected or replayed. The issue reports 0.1.413 and confirms 0.1.414 in comments; only 0.1.414 was exercised here.
- Lint and complexity were not enabled in the fixture. Daemon shutdown is proven; each secondary subsystem's discovery loss is reported by the issue, not separately measured here.
- No automatic edit-triggered restart, `squeal start` handshake, CLI named-wait deadline, Windows host, other malformed-path class, or concurrent writer was tested.
- Whether the original string denotes an actual POSIX path, and which ingress first accepts it, remain undetermined because the originating recorder event was not replayed. Handling that ambiguity, persisted-state recovery and the current “never pruned” rule needs a human-approved scope decision. Existing holds stand.

## Sources

- [Issue #166 and its comments](https://github.com/hearsay-tools/squeal/issues/166), fetched with `gh` on 2026-11-07; reporter evidence, not an independent experiment.
- [Source tree at the examined commit](https://github.com/hearsay-tools/squeal/tree/b509d603f483e5b869eb11b6cfecc744b057193e): `src/core/keys/{observed,closure,runtime-files}.ts`, `src/core/scheduler/{keying,bootstrap,revision}.ts`, `src/core/daemon/daemon.ts`.
- [011 spec C3/C9/C12/C13](../spec.md) and [amendments](../status.md), read at that commit.
- [Probe instructions](../../../../research/probes/issue-166/README.md), [captured output](../../../../research/probes/issue-166/result.jsonl), and [stderr](../../../../research/probes/issue-166/stderr.txt).
