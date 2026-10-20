# Issue 53: a nodeTest project removed during a session

Reproduction research for hearsay-tools/squeal#53 ("Discard removed test projects after configuration changes during a session"). Researcher worker 49a7398b, 2026-10-20. Product read-only. This file designs nothing and approves nothing.

Question: after a `nodeTest` project is removed from `squeal.config.json` while the daemon runs, does its test file stay runnable and count as a current failure, and does `squeal retry` still accept it?

Versions: incident on Squeal 0.1.228 (issue text, under Codex). Reproduced on this checkout, 0.1.229 at `8c37e28c` (tag `squeal--v0.1.229`), CLI `plugins/claude-code/dist/cli/squeal.mjs` as committed, Node v24.21.0. The source paths below are byte-identical between `squeal--v0.1.228` (`2958813a`) and `8c37e28c`: `git diff --stat 2958813a HEAD` over `daemon.ts`, `node-test-runners.ts`, `composite-runner.ts`, `scheduler/revision.ts`, `scheduler/keying.ts`, `policy.ts` and `cli/retry.ts` prints nothing.

Host load before the live run: 15.48 at first read, 18.95 when the probe started (`/proc/loadavg`, one-minute), on 24 CPUs. Below the CPU count, so the live probe ran.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the removed project's file stay runnable in the same session? | Yes. An edit to it after the removal ran it again at the new revision. | verified by experiment, 0.1.229 |
| 2 | Does its failure count as a current known failure? | Yes. `Known failures: 1`, `observed at revision 2, current`, and `status --wait <file>` and `run --all --wait` exit 1 on it. | verified by experiment, 0.1.229 |
| 3 | Does `squeal retry --reason environment` accept it? | Yes, while the daemon that started under the old config runs: `Retry queued`, the file ran and `failed again`. | verified by experiment, 0.1.229 |
| 4 | Does a daemon restart clear it? | Yes. After `squeal stop` and `squeal start`, `run --all --wait` reports 1 test file and 0 known failures, and retry answers `not a test file Squeal has keyed in this worktree` (exit 1). The status the start prints shows the old FAIL until the new daemon lists its files. | verified by experiment, 0.1.229 |
| 5 | Why? | The node:test runners are built once, from the start-time policy. A reload swaps the policy object and re-keys `inputs` and `env.allowlist` only; no runner is added or dropped. | read in source code, 0.1.229 and 0.1.228 |
| 6 | Is this the incident's exact path (merge of `origin/main`, `test:package` e2e file, missing `web/dist`)? | Not determined, because the cezarion worktree at `8b5ac0937` was not replayed. The synthetic probe reproduces the mechanism the issue describes. | inferred |

## Findings

**F1, reproduced (verified by experiment, 0.1.229).** `research/probes/issue-53/run.sh` builds a git repository in `/tmp` from `fixture/` with two nodeTest projects, `keep` (passes) and `gone` (`assert.fail("removed project still ran")`), and runs the checkout's CLI with `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under the temp directory. Full output is `research/probes/issue-53/run.log`. Excerpts, in order:

```
$ squeal run --all --wait            # revision 0, both projects configured
  FAIL  [gone] gone/gone.test.mjs > gone fails
== remove project gone from squeal.config.json   (committed; revision 1)
  2026-10-20T15:51:56.163Z, revision 1: squeal.config.json changed; policy reloaded
Known failures: 1 (1 test)  ... observed at revision 0, current
== edit gone's test file             (revision 2)
$ squeal status --wait 30000
  FAIL  [gone] gone/gone.test.mjs > gone fails
        at gone/gone.test.mjs:3:35, observed at revision 2, current
        recorded just now in this worktree at revision 2
$ squeal retry gone/gone.test.mjs --reason environment
Retry queued (reason: environment): gone/gone.test.mjs runs once more now. ...
[exit 0]
        ... retry asked (environment) at these inputs: it failed again
$ squeal run --all --wait
Checkpoint ... completed at revision 2: 1 known failure: 1 test; 2 test files, 2 already current, 0 run now
[exit 1]
$ squeal failures                     # two stored runs of the removed project
  FAIL  2026-10-20T15:52:03.583Z  [gone] ... revision 2, commit 2461511, dirty
  FAIL  2026-10-20T15:51:55.224Z  [gone] ... revision 0, commit 152a783, clean
== restart the daemon on the new config
$ squeal run --all --wait
Checkpoint ... completed at revision 2: no known failures; 1 test file, 1 already current, 0 run now
$ squeal retry gone/gone.test.mjs --reason environment
Not retried: gone/gone.test.mjs is not a test file Squeal has keyed in this worktree.
[exit 1]
```

The removal itself queued no run of `gone` (its key did not change, so revision 1 kept the revision-0 result as current). A run needs something that re-keys the removed project's files, as an edit does. In the incident the merge changed files in the closure of `package-cli.test.ts` ("the reported closure also cites files updated by the merge"), which fits this.

**F2, runners fixed at start (read in source code, 0.1.229 = 0.1.228).** `src/core/daemon/daemon.ts:427` reads `const configured = this.#policy.nodeTest;` once in `#run()`, and `:467` builds `nodeTest.createNodeTestRunners(configured, ...)`, one `RecoveringRunner` per project (`src/core/daemon/node-test-runners.ts:130`), handed to `createCompositeRunner` (`:488`). `#reloadPolicy()` (`daemon.ts:335`) only assigns `this.#policy`, restarts the timers and notes the reload. The scheduler's `reloadPolicy` (`src/core/scheduler/revision.ts:127`) applies `context.keys.setPolicy(policy)`, which re-keys what `inputs` and `env.allowlist` touch. Nothing reads the new `nodeTest` list during the session, so the composite keeps listing, keying and running the removed project. The same holds for `pytest` (`daemon.ts:428`, `:477`), not exercised here.

**F3, the spec is silent (read in official docs, `011-core/spec.md` at `8c37e28c`).** C10 (`spec.md:246`, lifted from 001 D11): "a revision that changes the file reloads it and re-keys what `inputs` and `env.allowlist` touch". Its `observe.runtimeInputs` bullet (`:252`) adds that a change "recreates the Vitest instance". No rule covers adding or removing a `nodeTest` or `pytest` project during a session. 003 D7 says "one runner per configured or detected runner" and 003 D1 defines the `nodeTest` list, both without a reload rule. C14's adapter contract has no call for withdrawing a project. So the behaviour is not a deviation from a written rule. It is a gap: the daemon follows the reloaded policy for some keys and the start-time policy for the project list.

**F4, retry follows the keys (read in source code, 0.1.229).** `src/cli/retry.ts:254` `notKeyed` refuses only a path with no `TestFileKeyRecord` in this worktree. The daemon that started under the old config keeps keying the removed project's files (F2), so retry accepts them. After a restart they are no longer keyed and retry refuses them (F1).

**F5, the issue's related reports (inferred).** #16 and #35 were missing-prerequisite failures of a configured project. Here the failure itself (missing `web/dist/index.html`) is the same kind, but it comes from a project no longer in the config. The probe shows the config part alone, with a plain assertion failure and no prerequisite.

## Recommendation for Squeal

Treat #53 as confirmed on 0.1.228 and 0.1.229 by mechanism: a running daemon keeps running, counting and accepting retries for a `nodeTest` project removed from `squeal.config.json` until it restarts. The workaround today is `squeal stop` then `squeal start` (verified above). A fix needs a C10 rule first, for the coordinator to propose: what a revision that adds or removes a `nodeTest` or `pytest` project does to the composite runner, the files and states of the removed project (forgotten, or kept and marked as outside the current configuration, as the issue offers), queued and running work, and retries. Vitest's recreate-on-`observe.runtimeInputs` path (`spec.md:252`) is the nearest precedent.

## Limitations and open questions

- The cezarion incident was not replayed (merge at `9adb3f1d9`, Codex harness, `test:package` e2e file). The synthetic probe used Claude Code's committed CLI bundle directly, with no harness hooks.
- One run, one host, at load 18.95 on 24 CPUs. The result is deterministic in mechanism (F2), so repetition was not needed for the verdict.
- Not probed: adding a project mid-session (by F2, it would not be listed until a restart), renaming a project, a removed `pytest` project, a removed project whose run was queued or running at the moment of the reload, and other worktrees sharing the store.
- After the restart, the status `squeal start` printed still listed the old FAIL until the new daemon listed its files. Whether a status read in that window should already drop it is open.

## Sources

- Issue: `gh issue view 53 --repo hearsay-tools/squeal`, read 2026-10-20 (opened 2026-10-20T14:26:26Z, labels bug, friction, needs-triage, area-core).
- `docs/specifications/011-core/spec.md` C2 (`:72`), C4 (`:110`), C6 (`:183`), C9 (`:230`), C10 (`:246`, `:252`), C14 (`:317`); `status.md` amendment log; `docs/specifications/003-node-test-runner/spec.md` D1, D7, at `8c37e28c`.
- Source at `8c37e28c`: `src/core/daemon/daemon.ts:335`, `:427`, `:467`, `:488`, `:515`; `src/core/daemon/node-test-runners.ts:130`; `src/core/scheduler/revision.ts:103`, `:127`; `src/cli/retry.ts:254`. Same bytes at `squeal--v0.1.228` (`2958813a`).
- Probe: `research/probes/issue-53/` (`README.md`, `run.sh`, `fixture/`, `run.log`), run as `timeout 400 research/probes/issue-53/run.sh <checkout>`.
