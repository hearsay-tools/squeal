# Issue 120: pinned runtime rejects `runtimeFiles`

Recommend a bounded compatibility diagnostic and recovery decision. The configuration mismatch is reproduced. Changing session pinning is a separate product decision.

Research date: 2026-10-28. Scope: documentation-only triage of [Squeal #120](https://github.com/hearsay-tools/squeal/issues/120). No repair, build, suite, daemon restart, installation change or real session change. Worktree source: `3bbcbcf805659b7365adb52fc42d1c7c8eb828ea`.

## Questions and verdict

| Question | Answer and evidence tag |
| --- | --- |
| Does 0.1.368 reject a rule a newer runtime accepts? | **verified by experiment**, retained 0.1.368 and 0.1.370: the same rule produces `unknown key "runtimeFiles"` only on 0.1.368. |
| When did support arrive? | **read in source code**, release tags 0.1.368 and 0.1.369: 0.1.369 adds the policy field, parser and effective-observation filter. |
| Does rejection discard all configuration? | **read in source code**, 0.1.368: no. The loader reports the unknown key and continues merging recognized keys. |
| What validation is lost? | **read in source code**, 0.1.368/0.1.369: the selected runtime-file exclusions are lost. Runtime observation and declared inputs remain. **inferred**: changing instance data can re-key tests or invalidate in-flight results, causing extra work or delayed current results. No missed test or false pass was demonstrated. |
| Did this reproduce a pinned session upgrade? | Not determined by experiment. The probe bypasses the launcher and runs retained CLIs directly. **read in source code**, adapter `store.ts`: an existing pin wins before current-runtime selection. |

## Experiment

Read the report and the exact Cezarion configuration it names:

```sh
gh issue view 120 --repo hearsay-tools/squeal --json number,title,body,url,comments
gh api 'repos/hearsay-tools/cezarion/contents/squeal.config.json?ref=0ca0abddbb4365bf0413634b9547484a1ba78f88' --jq .content | base64 -d
```

The second command returned this rule (**read in source code**, Cezarion commit above):

```json
{"runtimeFiles":[{"project":"e2e","tests":["packages/web/e2e/*.e2e.ts"],"paths":[".ai/qa/test-env.json"]}]}
```

The [probe](../../../../research/probes/issue-120/probe.mjs) uses that rule with `baseline.onStart: "lookup-only"` and `inputs: ["fixtures/meaningful.json"]`. It creates a disposable Git repository, runs each retained CLI with session-routing variables removed from the child environment, then removes the fixture. It verifies the CLI SHA-256 against its retained runtime manifest. It starts no daemon and creates no validation store.

Exact command, Node v24.22.1:

```sh
node research/probes/issue-120/probe.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.368 /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.370
```

Each child command is `/home/agent/.nvm/versions/node/v24.22.1/bin/node --disable-warning=ExperimentalWarning <runtime>/dist/cli/squeal.mjs status --json`, then the same command without `--json`. Working directory: the disposable repository. Before **each** child, `os.loadavg()[0]` is compared with `os.cpus().length`; load above CPU count skips it.

| Run | UTC time | One-minute load / CPUs | Result |
| --- | --- | --- | --- |
| Preliminary, generic reader `vitest` / `test/**/*.test.ts` | 12:32:29.656–12:32:30.052 | 5.55 / 24 for all four commands | Same rejection/acceptance pair |
| Exact reported rule, 0.1.368 JSON | 12:33:26.025 | 3.83 / 24 | Unknown key |
| Exact reported rule, 0.1.368 text | 12:33:26.189 | 3.83 / 24 | Config problem and fallback text |
| Exact reported rule, 0.1.370 JSON | 12:33:26.327 | 3.83 / 24 | No `configProblems` field |
| Exact reported rule, 0.1.370 text | 12:33:26.462 | 3.83 / 24 | No config problem line |

Initial parent load was 4.78 / 24. No probe was skipped. All eight commands exited 1, with empty stderr and no signal. This exit means **no store**, not configuration rejection. The probe itself exited 0. No validation pass is claimed.

0.1.368 JSON, omitting only the absolute scratch-store `message`:

```json
{"schemaVersion":1,"available":false,"reason":"no-store","configProblems":["unknown key \"runtimeFiles\""]}
```

0.1.368 text, after the no-store line:

```text
Config problem: squeal.config.json: unknown key "runtimeFiles"; the defaults apply in their place (`squeal setup --check` names each)
```

0.1.370 JSON has only `schemaVersion: 1`, `available: false`, `reason: "no-store"` and the scratch-store `message`. Its text has only the no-store line. The removed fixture was `.scratch-dFSN1B` under the probe directory.

Manifest-matched CLI SHA-256:

```text
0.1.368 255d91157acc834cf6afb0a7e6d145096db27fb26667e54542f194f1ad7df7e5
0.1.370 eb148a7bed0a09890ae8773c8a96c78d9d7cd93dc868449d90ef54b7f5372cfe
```

## Source evidence and coverage consequence

**read in source code**, release 0.1.368 (`d636093a1e6dd764d520e54f4b6f1fca3fec759b`) and 0.1.369 (`facafbacf19318935a4248868da4b92f444f1e93`):

```sh
git diff squeal--v0.1.368 squeal--v0.1.369 -- src/core/daemon/policy.ts src/core/types/policy.ts
git show squeal--v0.1.368:src/core/daemon/config-file.ts
git show squeal--v0.1.368:src/core/scheduler/keying.ts
git show squeal--v0.1.369:src/core/daemon/policy-runtime.ts
git show squeal--v0.1.369:src/core/keys/runtime-files.ts
```

The [old loader](https://github.com/hearsay-tools/squeal/blob/d636093a1e6dd764d520e54f4b6f1fca3fec759b/src/core/daemon/config-file.ts#L68) copies defaults, reports each unknown key, and merges recognized siblings. This is not an all-config fallback. `observe.runtimeInputs` still defaults to true. The old `setClosure` adds observed paths without the new exclusion filter.

The [new rule owner](https://github.com/hearsay-tools/squeal/blob/facafbacf19318935a4248868da4b92f444f1e93/src/core/keys/runtime-files.ts) selects exact paths for project/test readers. `effective()` removes accepted paths from raw observations. Classification protects declared inputs, test files, policy, manifests and directories. Scheduler `runtimeApplication()` also protects imports, environment/startup files, dependencies and observed modules; unverified closures cannot authorize exclusions. Raw observation storage remains separate from effective key inputs.

Thus the rejected Cezarion rule cannot omit `.ai/qa/test-env.json` from the observed inputs of `e2e` readers. **inferred**: its changing instance bytes can still invalidate their results. This is a loss of the intended exclusion policy, not evidence that those tests stop tracking inputs. The exact affected tests, frequency and time cost were not measured. Acceptance by 0.1.370 proves parsing only; no reader was loaded to prove rule application or absence of protection conflicts.

**read in source code**, current checkout and 002 D7–D9: [adapter/store.ts](https://github.com/hearsay-tools/squeal/blob/3bbcbcf805659b7365adb52fc42d1c7c8eb828ea/src/harness/codex/adapter/store.ts#L54) uses the existing session pin before choosing a current runtime. A missing runtime diagnostic says to start a new Codex session. C10 explicitly permits per-key fallback and continued operation; C6 reports config problems even without a store through `config-problems.ts`. 005 D3 and 002 D8 preserve active pins across updates. The generic config line gives `setup --check`, but does not explain that this key needs a newer runtime or what its absence changes.

## Recommendation and limits

**inferred**: triage this as configuration/runtime compatibility feedback and recovery friction. Explain the unsupported rule, active runtime and validation consequence together. The existing contract points to a new session on a compatible installed runtime; adopting a runtime inside an active session requires a separate decision because it changes 002 D9. No such mechanism was implemented or tested here.

The original revision-53 live store, launcher notice, plugin versions, update event and daemon-restart behavior were not reproduced. No real session pins were inspected or changed. No full suites or builds ran. The retained standalone probe is outside automated test coverage; Squeal reported its filter callback as `untested`, which is a probe coverage notice, not a product test failure.

Final checks: `git diff --check` passed. `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-120/probe.mjs docs/specifications/011-core/research/issue-120.md` exited 3 at revision 3: `No verdict: no test file's closure holds` either path. Worktree: known failures 0; 722 of 1315 test files unknown. This supplies no affected-test pass. The direct probe above supplies the experimental evidence.
