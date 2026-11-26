# Issue 289: browser startup difference and missing setup evidence

Recommendation: fold the setup-log evidence into #173; keep the worktree-versus-proof browser launch difference unverified. Preserving Squeal's available error cannot recover Chrome stderr that the application's bootstrap discarded. This is documentation-only triage, not implementation authorization.

## Scope and verdict

Examined 2026-11-26: reported installed Squeal **0.1.641**, release
`846c3a8069d2941eb5e63f590fd11047442202eb`; source checkout
`4ea368dde69eadcfb18fa7a49b0474ea38a7d0e6`. The inspected Squeal startup,
error conversion, setup sink, log lookup, proof environment and scheduler setup
files have no diff from that release. Application source is Squawk
`d71cb9b7f0b32a10121891bffae6667f4f479538`, fetched through GitHub's contents API.
The issue's installed runtime was not executed in this investigation.

| Question | Answer and provenance |
| --- | --- |
| Does 0.1.641 fail to launch Chrome in the daemon but launch it in proof? | **inferred**, from #289's report only: the author saw this difference; it is **not reproduced, because** the report lacks the exact proof invocation, original daemon environment, resolved launch descriptor and Chrome diagnostics. Reconstructing the application's installed browser, caches, lease, build and server in an isolated sandbox would not reconstruct those missing incident inputs within the bounded triage. |
| Does Squeal still lack setup-to-run evidence linkage? | **read in source code**, 0.1.641: yes. The setup outcome records known state without a result, run id or failure producer; `why` cannot identify its log through the keyed-result fallback. |
| Can richer Squeal logs recover the original Chrome stderr? | **read in source code**, Squawk d71cb9b7f: not from this bootstrap path. Its launch probe redirects stderr to `/dev/null`, tests stdout for a success boolean and discards its remaining content. |
| Is this an exact duplicate of #173? | **inferred**, comparing both issue bodies and the pinned source: partial duplicate. The missing setup log is the same gap; the daemon/proof launch difference is additional evidence with no demonstrated cause. |
| Is a cheap safe live reproduction available now? | **inferred**, from the missing inputs and bootstrap source: no incident-faithful one. A synthetic throwing setup would repeat #173's existing experiment without resolving Chrome behavior. |

Host gate, **verified by experiment** (read-only `cat /proc/loadavg` and `nproc`):
one-minute load **1.79 / 16 CPUs**, then **1.68 / 16 CPUs**. Load did not block
research. No browser, application bootstrap, daemon restart, test group or test
suite was started. No other task's daemon or worktree was accessed. The boat.dev
instructions were read; no sandbox was created because missing incident inputs,
rather than host capacity, prevent an equivalent reproduction.

## Evidence boundaries

**Read in source code, Squawk d71cb9b7f.**
`packages/web/e2e/vitest.config.ts` injects `environment.ts` as a reporter via
`configureVitest`. Its `onTestRunStart` awaits environment preparation. Thus
Squeal's `(global setup)` label here does not prove a configured Vitest
`globalSetup` function failed: its failed-start classifier also accepts a
rejection before any file was queued and can have no setup-file owner.

`environment.ts` runs `.ai/scripts/test-env-up.sh`, reads `.ai/qa/test-env.json`,
and throws `Browser E2E could not run: <browser.notes>` when
`browser.installed !== true`; it wraps this in `Browser E2E environment bootstrap
failed`. The wrapper's own cause preserves the generic descriptor message,
not the underlying browser process error.

In `test-env-up.sh:440–624`, launch settings come from
`resolve-browser-launch.mjs`: host/container signals, namespace and the caller's
temporary-directory length. `run_browser` applies those settings. Doctor output
is saved as JSON but its stderr is discarded. `probe_browser` runs:

```sh
out=$(run_browser --session "$session" open about:blank --json 2>/dev/null || true)
run_browser --session "$session" close --json >/dev/null 2>&1 || true
printf '%s' "$out" | browser_json_success
```

After unsuccessful doctor/live probes, including a `--no-sandbox` fallback when
needed, an installed-Chrome doctor check selects the exact reported note:
`installed Chrome failed to launch with resolved settings`. The script persists
launch settings and puts the generic note into the environment descriptor.
Those files would be useful incident evidence, but were not provided or read
from the original task. **Inferred:** this establishes an upstream diagnostic
loss, not the reason Chrome failed; temp-path length, namespace, sandbox and
cached state remain possibilities, not diagnoses.

**Read in source code, Squeal 0.1.641.** `src/cli/proof-run.ts:95–110` builds the
proof run's environment from the command's environment and requested conditions;
a separate HOME is created only for hidden-home conditions. A temporary proof
checkout therefore does not establish identical process environment or
application state to an existing daemon. The issue does not name its proof
conditions or both code sides, so even code equivalence is unverified.

`src/runners/vitest/results.ts:39–101` retains the outer stack but limits causes
to three first-line messages of 200 characters and their codes; it copies no
attached stdout/stderr. `startup.ts:105–116` replaces the report failure with a
compact message/code/cause string. `src/core/state/sink.ts:181–202` writes a setup
known state with summary, fingerprint and location, without recording a producing
run. `src/core/status/why-log.ts:47–80` needs failure-producer/key evidence to
recover a log without a result; a current setup with no key falls through to
`unidentified`. These paths substantiate the diagnostic overlap without claiming
a new runtime reproduction.

**Read in source code/documented prior experiment, Squeal 0.1.426.**
[Issue 173's research](issue-173.md) previously reproduced zero result rows,
physical run logs and an unidentifiable `why` log, including available attached
subprocess streams lost during conversion. That experiment was not rerun here;
it does not prove the current browser environment or that upstream discarded
streams can be reconstructed.

## Contract relation and next evidence

**Read in source code/specifications**, checkout above: 011 **C5** intentionally
makes setup failure worktree-local, “never a result under a key”; a fix must not
turn setup into reusable test evidence. **C6** promises retrievable last-run
logs; **C7** owns persistence/provenance; **C13** distinguishes untrusted runs
and unknown tests; **C14** gives each run a unique log directory. 013 **V4**
requires fuller nested run-error diagnostics, while **V8** owns failed-start
classification and closing a rejected instance. The relevant status amendment
logs were read; no contract or status was changed.

**Inferred recommendation:** #173 owns bounded setup evidence and association
with its producing run. For #289's additional launch symptom, obtain both runs'
exact command/commit, browser and agent-browser versions, selected environment
variables, launch/doctor/environment descriptors and raw probe errors before
changing Squeal's launch behavior. Application-side capture is required for
bytes its script currently throws away. Do not restart or rerun the original
98-file browser group merely to fill this triage gap. Any future isolated probe
belongs on boat.dev and should run one file after capturing those inputs.

Unknown: original browser/Vitest versions, original host load, proof conditions,
whether either run reused a descriptor/server/browser process, environment drift,
restart recovery, and the actual Chrome error. No test-pass claim is made.

## Commands and sources

Evidence-bearing commands actually run (home paths abbreviated as `~`):

```sh
gh issue view 289 --repo hearsay-tools/squeal --json number,title,body,state,comments,url
gh issue view 173 --repo hearsay-tools/squeal --json number,title,body,state,comments,url
cat /proc/loadavg
nproc
git rev-parse HEAD
git rev-parse squeal--v0.1.641^{commit}
git show squeal--v0.1.641:package.json | head -18
git diff squeal--v0.1.641 -- src/core/state/sink.ts src/core/status/why-log.ts src/runners/vitest/startup.ts src/runners/vitest/results.ts src/cli/proof-run.ts
gh api repos/hearsay-tools/squawk/commits/d71cb9b7f --jq '.sha'
gh api repos/hearsay-tools/squawk/git/trees/d71cb9b7f?recursive=1 --jq '.tree[].path' | rg 'e2e.*(browser|environment)|vitest.*config|squeal.config'
gh api repos/hearsay-tools/squawk/contents/packages/web/e2e/environment.ts?ref=d71cb9b7f --jq .content | base64 -d
gh api repos/hearsay-tools/squawk/contents/packages/web/e2e/vitest.config.ts?ref=d71cb9b7f --jq .content | base64 -d
gh api repos/hearsay-tools/squawk/contents/.ai/scripts/test-env-up.sh?ref=d71cb9b7f --jq .content | base64 -d | sed -n '440,540p'
gh api repos/hearsay-tools/squawk/contents/.ai/scripts/test-env-up.sh?ref=d71cb9b7f --jq .content | base64 -d | rg -n -C 9 'failed to launch|browser|resolve-browser' | tail -145
gh api repos/hearsay-tools/squawk/contents/.ai/scripts/resolve-browser-launch.mjs?ref=d71cb9b7f --jq .content | base64 -d | rg -n -C 5 'stderr|stdout|launch|tmp|TMP|installed|notes' | tail -150
```

Additional reads used `cat`, `sed` and `rg` on the cited source/spec/skill files.
Read the session-pinned Squeal 0.1.641 skill before evaluating test evidence.
No probe was created and no runtime test command was run.

- [Issue 289](https://github.com/hearsay-tools/squeal/issues/289), reported revision 1.
- [Issue 173](https://github.com/hearsay-tools/squeal/issues/173), open, proposed row `gh-173`.
- [Squeal 0.1.641 source](https://github.com/hearsay-tools/squeal/tree/846c3a8069d2941eb5e63f590fd11047442202eb).
- [Squawk incident source](https://github.com/hearsay-tools/squawk/tree/d71cb9b7f0b32a10121891bffae6667f4f479538).
