# Issue 60: declared inputs leave browser preparation stale

Treat preparation freshness as a validity requirement before accepting results for changed declared inputs.

Research, 2026-10-20 UTC. **Reproduced** with shipped Squeal **0.1.233**, Node **24.21.0**, Vitest **5.0.3**, Vite **8.3.4**. Product source read at `cc7047f2b232df419cd6025841c5005d38aece34`. Owner: 013 V1/V3/V5/V6/V8, with 011 C3/C12/C13. Both status logs were read; no decision or existing hold changed. No product fix is included or authorized.

## Questions and verdicts

| # | Question | Tagged answer and version |
|---|---|---|
| 1 | Can two runs in one daemon use new declared source inputs but old prepared assets? | **verified by experiment**, Squeal 0.1.233 / Vitest 5.0.3: yes. Revision 0 passed. After changing only the declared source, revision 1 stored a current FAIL while HTTP served the revision-0 asset. |
| 2 | Does input declaration refresh successful `globalSetup`? | **read in source code**, Squeal 0.1.233 / Vitest 5.0.3: no. Declared inputs enter core closures and keys. Instance recreation uses config files and the global-setup import closure, not all declared inputs. Vitest returns immediately when `_globalSetups` already exists. |
| 3 | Does changing an existing recreation trigger restore preparation and teardown? | **verified by experiment**, same versions: a comment appended to `environment.ts` in the same daemon caused old teardown, new setup, and revision-2 PASS. Final stop ran the new teardown. |
| 4 | Does this explain the reported Cezar shape? | **inferred**, Squeal 0.1.232 incident / Cezar `5fb37b19`: strongly consistent. Fetched Cezar config declares UI sources; its setup invokes a shell script rather than importing those sources. The incident reports old prepared assets and recovery after rebuilding. The original session was not replayed. |
| 5 | Are other worktrees and full browser behavior proven safe? | **not determined, because** the bounded experiment uses one private repository and Node HTTP. No other worktree or browser suite was exercised. Two local teardowns are proven; cross-worktree ownership remains a required future check. |

## Experiment

Load gate: initial inspection at 23:19:06 UTC found load **6.09** on **24 CPUs**. Immediately before the live probe, 23:20:27.856 UTC, load was **18.66**, still below 24; final load was **18.77**. Available parallelism was also 24. One Vitest worker was configured. These are host load averages, not CPU utilization. The probe completed within the 20-minute research bound.

The throwaway fixture has `inputs: { "browser-check.test.ts": ["src/**"] }`. `globalSetup` reads `src/ui.txt` through `fs`, writes ignored `.prepared/index.html`, starts an HTTP server on an allocated loopback port, and returns a server-close teardown. The test fetches the asset and compares it with the source. Runtime observation is off to isolate declared-input behavior. The build input is not a JavaScript import of setup. The source stays stable during each run.

One foreground daemon, PID **1448592**, served all three checkpoints:

| Step | Source / served asset | Setup calls | Result |
|---|---|---:|---|
| First checkpoint, revision 0 | `Run activity` / `Run activity` | 1 | Exit 0, current PASS |
| Change only `src/ui.txt`; checkpoint, revision 1 | `Session activity` / **`Run activity`** | **1** | Exit 1, **current FAIL**, no pending/stale/unknown checks |
| Append a comment to setup; checkpoint, revision 2 | `Session activity` / `Session activity` | 2 | Exit 0, current PASS; old setup teardown ran before replacement setup |
| Stop this fixture's daemon | Unchanged | 2 | Daemon exit 0; replacement setup teardown ran |

The second result said `expected 'Run activity' to be 'Session activity'` and `observed at revision 1, current`. `why --json` recorded distinct keys: revision 0 `fe613915…f5320b`, revision 1 `b6e912bb…9186940`. Thus input keying and scheduling worked; preparation did not follow. The final event log was exactly:

```text
setup:Run activity
teardown:Run activity
setup:Session activity
teardown:Session activity
```

Commands, complete output, assertions and fixture generation are committed under [probes/issue-60](probes/issue-60/README.md). The probe exited 0, meaning the defect reproduced. It did not change any assertion to get the positive control. No broad daemon kill, shared asset rebuild, or other worktree action ran.

## Why it happens

**read in source code — Squeal 0.1.233.** `src/core/scheduler/keying.ts:342` adds policy-declared inputs through `assembleClosure`; 011 C3 explicitly puts them in closures rather than the environment hash. `src/runners/vitest/project.ts:63` builds recreation triggers from config dependencies and global-setup imports plus missing import candidates. `adapter.ts:345-375` recreates for those triggers, installed lockfiles, or exclusion changes; otherwise it invalidates Vite files and keeps the instance. The adapter options in `index.ts` do not receive policy `inputs`. The Vitest adapter has no source diff between tag `squeal--v0.1.232` and the examined commit.

**read in source code — Vitest 5.0.3.** The fetched npm package's `dist/chunks/index.DpLw24bj.js:12180` begins `_initializeGlobalSetup()` with `if (this._globalSetups) return;`. Setup succeeds once, then later `initializeGlobalSetup` calls reuse that state. Teardown functions remain stored there. Squeal's `#recreate` closes the old instance before starting the new one (`adapter.ts:318`), which explains the positive control's cleanup order.

**read in source code — Cezar `5fb37b19`.** `packages/web/e2e/vitest.config.ts:29` names `./environment.ts` and `./workspace-registry.ts` as global setups. These are plain Node tests driving an external browser, not Vitest browser mode. `environment.ts:38` invokes `.ai/scripts/test-env-up.sh` through `execFile`; it does not import UI source. `squeal.config.json:34-54` declares `packages/web/src/**` and build scripts for `packages/web/e2e/*.e2e.ts`. Setup's returned cleanup restores its short temp directory; it does not itself stop the shared server. This makes ownership a separate concern from the probe's private server teardown.

**inferred — examined versions.** V5's source stamps cannot prove what bytes an external preparation process built. Its touch rule is a different case: this probe changes bytes between completed runs, with no revert or same-bytes touch. V8's failed-start recovery also does not apply: setup succeeds and the test later fails normally. 011 C12 explicitly excludes the Vitest main process/global setup and shell reads from observation and leaves these to declared inputs. Declaration alone therefore does not establish prepared-asset freshness. Neither a false PASS nor a setup crash was tested here.

## Recommendation, limits and open questions

**inferred — Squeal 0.1.233.** Give freshness priority over keeping preparation warm when its declared source inputs change. A current key is insufficient evidence if setup still serves older assets. The coordinator must decide the refresh contract and its scope; this finding does not choose an implementation, retry policy, build command, or broaden existing holds. The deciding tradeoff is preparation cost versus truthful current results, as required by the vision.

Not reproduced: the original 12 browser failures on 0.1.232, its exact Vitest version, real browser execution, slow-lane reuse, observer-on behavior, edits during a run, setup failure on refresh, parallel projects, or other worktrees' shared-server ownership. The fetched incident reports recovery of all 12 failures after rebuilding, but that is reported evidence, not this probe's measurement. A fix needs teardown/ownership coverage and an unchanged-input control so preparation is not repeated without cause.

Repository gates were attempted in this dependency-free worktree: `npm run lint` exited 127 (`biome: not found`); `npm run typecheck` and `npm run build` exited 127 (`tsc: not found`). The absolute installed CLI's `run --all --wait` exited 3: `Checkpoint … has no verdict: it was abandoned before every test file had a result`; its note says no dependencies are installed, so no repository tests run or inherit results. The fallback `flock -w 10 /run/user/$(id -u)/squeal-full-run.lock npx --offline --no-install vitest run --maxWorkers=4` could not acquire the shared full-run lock within 10 seconds (exit 1, no output); a confirmation with `flock -E 75 -w 1` exited 75, its explicit lock-conflict code. No independent suite started. No repository-suite PASS is claimed. The separately installed probe dependencies supported the real daemon experiment above.

## Sources

- [Issue 60](https://github.com/hearsay-tools/squeal/issues/60), read with `gh issue view 60 --repo hearsay-tools/squeal --json number,title,body,url,comments`; comments [incident](https://github.com/hearsay-tools/squeal/issues/60#issuecomment-6302454362) and [recovery](https://github.com/hearsay-tools/squeal/issues/60#issuecomment-6302569352).
- Squeal source at [cc7047f2](https://github.com/hearsay-tools/squeal/tree/cc7047f2b232df419cd6025841c5005d38aece34): paths and lines above; 013 spec/status and 011 C3/C12/C13/status; prior `001-core-loop/research/cezar-e2e-setup.md` (failed setup, a different trigger).
- [Vitest 5.0.3 npm source](https://registry.npmjs.org/vitest/-/vitest-5.0.3.tgz), fetched by the probe install; exact paths, extracts and fetch commands in [source-evidence.txt](probes/issue-60/source-evidence.txt).
- [Cezar source at the incident commit](https://github.com/hearsay-tools/cezarion/tree/5fb37b19b93d6401eb1c41cfbc110ccdc092456e): three files fetched through `gh api`, paths and commands in the same evidence file.
- [Probe transcript](probes/issue-60/output.txt) and [probe script](probes/issue-60/probe.mjs).
