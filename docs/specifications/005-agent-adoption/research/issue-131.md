# Issue 131: repeated session/runtime version notice

Keep this as an evidence request under 005 D3; the normal pinned-session notice already deduplicates.

## Verdict and scope

The normal case did **not reproduce**. A synthetic failure to save the notice
marker reproduced a line on every call, but this is an explicit D3 fallback.
The original cause is **not determined**, because issue 131 records neither the
exact warning nor the incident version, launcher path, session identity or marker
state. Do not infer a second warning implementation from that report.

Research date: 2026-10-31. Checkout `e59ed2260d21616ddd529f8a5a5dcf4dde8dc2fc`,
package 0.1.384. Examined release 0.1.383 at commit
`2e62ee7c30f7fe06197dd08800a1fd1bf312d9f0` (annotated tag object
`7e58c75551acadb71f6ff75e5141f77629fad9ac`). Both have identical format-8 launcher
bytes, SHA-256 `40cc06b2aafeb239cd5b84d2a58858c4a18067d257636c54abffe288ea6e31e6`.
The session's installed launcher has that same hash (read-only comparison).
Node 24.22.1, Linux, 24 CPUs. Initial read: load 12.47 at 13:18:05 UTC.
Probe: load 9.98 at 13:19:18 UTC and before each of its 17 calls, below 24.

The brief supplies no numbered questions. These four questions make its scope explicit.

| Question and method | Answer | Tag and version |
| --- | --- | --- |
| 1. Does an unchanged pinned-session warning repeat? Run isolated launcher fixtures. | No with writable state: first call warns, next two do not, for both data and terminal launchers. | **verified by experiment**, format 8, 0.1.383/0.1.384 identical launcher |
| 2. Can the symptom occur without changing the pin? Force a failed marker write. | Yes: all three calls warn, preserve the pinned runtime and forward the status arguments. This matches D3's stated fallback. | **verified by experiment**, same launcher |
| 3. Is this separate from issue 85's deduplication? Read both issues and launcher source. | Different text suffix, same `notice()` function. Issue 85's existing contract includes the version running Codex sessions keep. A distinct incident warning remains unproven. | **read in source code**, 0.1.383/0.1.384; issue records fetched 2026-10-31 |
| 4. Which sections own a follow-up? Read 005 and 002 specs. | 005 D3 owns notice persistence and cadence; D6 owns user-facing text. 002 D7–D9 owns adapter/runtime separation, update selection and immutable session pins. | **read in official docs**, repository specs at `e59ed2260` |

## Evidence per question

### 1. Normal deduplication works

**verified by experiment, format 8 (0.1.383/0.1.384).** The probe places complete
synthetic runtime manifests and stub CLIs under a scratch Codex data directory.
Session A pins 0.1.382 while `current.json` names 0.1.383. It invokes:

```text
/bin/sh <scratch>/data-writable/codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/example.ts
```

First stderr, verbatim:

```text
squeal: this command runs squeal 0.1.382; plugins: Codex 0.1.383; this Codex session started on 0.1.382 and keeps it until it restarts.
```

Second and third stderr are empty. All exit 0 with stdout:

```json
{"syntheticRuntime":"0.1.382","args":["status","--wait","60000","src/example.ts"]}
```

A second pinned session warns once. Changing current to 0.1.384 warns again in
session A, then stays quiet. The terminal-path launcher gives the same sequence,
using the scratch XDG state directory instead of the plugin data directory.
A thread-only identity also warns once and then stays quiet; its saved notice
scope is the empty string. Full outputs and assertions are in the probe files.

### 2. Failed persistence repeats the notice

**verified by experiment, same launcher.** Making `launcher-notices.json` a
directory prevents the atomic file rename. Three unchanged calls emit the same
line above. Each exits 0 and still selects 0.1.382. No validation result is claimed:
the runtime CLI is a stub that only echoes selection and arguments.

**read in source code, same launcher.** Lines 174–197 read an array of scope/line
pairs, skip a previously seen pair, retain the newest 64 scopes and write through
a temporary file plus rename. The catch ignores persistence errors and then
prints the line. D3 explicitly says: “a mark it cannot write prints at every call,
as before.” This is a possible explanation, not proof of the incident's cause.

### 3. The two notice variants share one owner

**read in source code, same launcher.** Lines 200–212 compute `skewed`, `older`
and `behind`, then use one `notice(...)` call for all three. `behind` is the
pinned-session condition; it adds “this Codex session started on …”. There is no
separate session-warning deduplicator at this launcher seam. The pin lookup
accepts `CODEX_SESSION_ID` or `CODEX_THREAD_ID` (lines 113–132); notice scope uses
the former but not the latter (lines 175–176). The thread-only probe therefore
confirms machine-scoped suppression, not per-thread suppression.

**read in official docs, 005 status/spec at `e59ed2260`.** Row 005-84 already
records limits: A/B/A can print A twice, and concurrent calls can both print.
The marker is bounded to 64 scopes. None of concurrency, scope eviction or
alternating version states was attributed to this incident or tested here.

Issue 131 says “exact output not recorded” and incident version “not recorded
at the time; current version is 0.1.383.” Issue 85 is closed, with its maintainer
comment naming 0.1.339 and row 005-84. Those reports are evidence of the report
and its history, not experiment evidence for the original incident.

### 4. Recommendation and ownership

**inferred from the experiment and specs at the examined versions.** Request one
verbatim repeated stderr sample, the resolved launcher path and format/hash,
incident runtime versions, whether the effective session identity stays stable,
and whether the selected notice-marker location persists and accepts writes.
An exact sample decides whether this is this advisory, a missing-pin hard error,
or another output surface. No real install or pin needs changing to collect it.

Keep follow-up ownership in **005 D3**, with **D6** for any wording change and
**002 D7–D9**, especially **D9**, as constraints. Preserve the session's pinned
runtime. The tradeoff is notice silence versus losing an advisory when its state
cannot be saved. The existing contract chooses repetition on persistence failure;
changing that choice needs an explicit decision, not another deduplication layer.

## Commands, verification and limits

```sh
gh issue view 131 --repo hearsay-tools/squeal --json number,title,body,comments,url,state
gh issue view 85 --repo hearsay-tools/squeal --json number,title,body,comments,url,state
git rev-parse HEAD
git rev-parse squeal--v0.1.383
git rev-parse 'squeal--v0.1.383^{commit}'
git diff squeal--v0.1.383 HEAD -- plugins/claude-code/bin/squeal-launcher
sha256sum plugins/claude-code/bin/squeal-launcher /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal
git show squeal--v0.1.383:plugins/claude-code/bin/squeal-launcher | sha256sum
node research/probes/issue-131/probe.mjs > research/probes/issue-131/output.jsonl
```

The diff was empty; all three hashes match the hash above. Probe exited 0:
`PASS: 17 launcher calls; writable-state notices deduplicate; blocked-state notices repeat; pins and arguments preserved.`
The probe changed no product code, real plugin install or real session pin and
opened no daemon or test store.
No full suite, build, live upgrade or subject agent session ran. This verifies the
launcher seam, not full `status` behavior or the incident's Cezar environment.
The exact warning and original cause remain open.

Final checks: `node --check research/probes/issue-131/probe.mjs` and
`git diff --check` exited 0. The session's absolute `squeal status --wait 60000`
with all four changed paths exited 3 at revision 3: “No verdict: no test file's
closure holds” any of the four paths; “Worktree: known failures 0; all 1347 test
files current”. This is no affected-test verdict for the research. Squeal also
flags the throwaway script as untested/CRAP because no suite loads it; the direct
17-call probe is its verification. No repository suite was run by this task.

## Sources

- [Issue 131](https://github.com/hearsay-tools/squeal/issues/131), body and empty comments fetched through `gh`, 2026-10-31.
- [Issue 85](https://github.com/hearsay-tools/squeal/issues/85), including [release comment](https://github.com/hearsay-tools/squeal/issues/85#issuecomment-6414484220), fetched through `gh`, 2026-10-31.
- [Launcher at release 0.1.383](https://github.com/hearsay-tools/squeal/blob/2e62ee7c30f7fe06197dd08800a1fd1bf312d9f0/plugins/claude-code/bin/squeal-launcher#L113), read from local Git; lines 113–132 and 170–212.
- [005 spec D3/D6](../spec.md), [005 status](../status.md), [002 spec D7–D9](../../002-codex-adapter/spec.md), [002 status](../../002-codex-adapter/status.md), all at checkout above.
- Existing tests read, not run: `test/cli/launcher.test.ts` and `test/cli/launcher-codex-runtime.test.ts`.
- Probe: [`research/probes/issue-131/`](../../../../research/probes/issue-131/), with `probe.mjs`, `README.md` and captured `output.jsonl`.
