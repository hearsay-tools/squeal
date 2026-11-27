# Row 026-40 (#300): real-runner reproduction of merge and new-helper drift

Worker W1, wave 15, 2026-11-27. Follows [issue-300.md](issue-300.md), whose probe used a synthetic runner.

## Setup

`test/runner-host/remote/lane-drift.test.ts`: a real Vitest runner host on each side, the remote one started over the fake `ssh` of `test/runner-host/remote/helpers.ts` (it runs the remote command in a directory of this machine), the real lane, proxy and tree host. The fixture is `test/fixtures/vitest/basic` under Git, plus `fixtures/golden.json` and `test/golden.test.ts`, which reads it. `whenLost: "not-run"`, local planning. Each case first runs once to prove the tree, then changes it:

- **Merge**: branch `topic` changes `fixtures/golden.json` and adds `fixtures/README.md`; `main` changes `src/strings.ts`; `git merge topic`. The invalidation is the merge's `git diff --name-status` (`add` / `change`).
- **New helper**: add `src/helper.ts` and make `test/setup.ts` (a Vitest `setupFiles` entry) import it. The invalidation is `src/helper.ts` `add` and `test/setup.ts` `change`.

Each case runs twice: the invalidation **delivered** to the lane, and **undelivered** (the runner here is told, the remote is not). The second is what a lane does with an invalidation while it is `asleep` or `down` (`lane.ts`, `invalidate`: it queues only while `ready` or `connecting`) and what any missed write leaves behind.

## Findings

| Case | Before row 026-40 | After |
| --- | --- | --- |
| Merge, delivered | completed, 1 remote run, no resend | same |
| Merge, undelivered | completed: proof differs at `fixtures/golden.json`, `sending again`, retry proven | same |
| Helper, delivered | completed, 1 remote run | same |
| Helper, undelivered | **refused at once**: `config and setup files differ: test/setup.ts, src/helper.ts` (no resend, `not-run`: the file not run) | `config and setup files differ at test/setup.ts, src/helper.ts; sending again`, compared again, completed |

Blob ids recorded (local `here`, remote `there`, local tree membership), merge case after the run:

| Path | Delivered: here = there | Undelivered |
| --- | --- | --- |
| `fixtures/golden.json` | `f74921c1…` = `f74921c1…`, in tree | `f74921c1…` = `f74921c1…` after the resend |
| `fixtures/README.md` | `706f475d…` = `706f475d…`, in tree | here `706f475d…`, there absent: no run reads it, so no proof names it |
| `src/strings.ts` | `ea458953…` = `ea458953…`, in tree | here `ea458953…`, there `4c6f619e…` (the old bytes): read by no test that ran |

Helper case: `src/helper.ts` `0f680230…`, `test/setup.ts` `68d441b8…`, both in the tree, equal on both sides after the run in both variants once fixed.

1. **Cause reproduced: a config or setup file difference was refused with no resend** (`lane.ts` `attempt`: an unequal environment ends the tier; `lane-compare.ts` mended only the installed dependencies). A new helper that a setup file imports is a config/setup file of the Vitest project, so the issue's second message (`config and setup files differ: e2e/describe-error.ts`) is this path. Fixed: `lane-compare.ts` `resent` sends the files whose blob ids differ once and compares again.
2. **A resend can reveal more setup files.** With the runner here not told either (a first development variant), resending `test/setup.ts` made the remote Vitest re-read it and list `src/helper.ts`, which then differed (remote absent). So `resent` runs at most two rounds; the second sends only files the first comparison did not name. Each file goes at most once.
3. **The merge case validated.** A merged fixture the remote missed differs in the run's proof; the existing single resend repairs it. The issue's merge refusal (`its tree stayed different at …/__fixtures__/golden.json, README.md, cli-subagent.expected.json`) means the bytes still differed after the resend. Not reproduced. Ruled out by reading: the remote Git sync (`SYNC_SCRIPT` runs `git read-tree --reset HEAD`, which does not touch the working tree), `materializeFromGit` (it checks each blob's id), the local blob cache (stat- and racy-checked), and, less firmly, the reporting project's tests (a search of the runner's test files beside those fixtures found no write to them). A tree-host write is unconditional, so a resend that arrived leaves equal bytes. Something must change them after it, or the resend never arrived. Open: a run that rewrites them there, or a resend that failed. The status line now names the paths and `remote.alwaysLocal`.
4. **Undelivered paths that no run reads stay stale there** (`src/strings.ts`, `fixtures/README.md` above) until a later proof names them or a connect sends the tree. This does not weaken proof, because only proven inputs keep a result. A reconnect's `tree` message compares with the host's ledger (`files.json`), not with the bytes on disk.
5. **A file in only one side's config list** (remote Vitest lists it, the runner here does not) is a list difference, not a content difference. No resend repairs it, and it stays refused at once, as before.

## Changes (row 026-40)

- `lane-compare.ts`: `RemoteComparison.files` (the config/setup files whose blob ids differ); `CompareOptions.resend`; `resent` (at most two rounds, each file once); refusal texts `ignoredConfigReason` (git-ignored here, never synced: stop ignoring it, or `remote.alwaysLocal`) and `stayedConfigReason` (still different after one resend: `remote.alwaysLocal`).
- `lane.ts`: `compared` passes `resend` (queue as `change`, `sendPending`). A persistent proof difference's status line names the paths and the way out (`lane-proof.ts` `stayedStatus`). Unrun files stay not run under `not-run`; no local fallback was added.

Tests: `lane-drift.test.ts` (real runner, four cases), `lane-config-drift.test.ts` (recovered, persistent with paths, git-ignored, each under both loss policies), the two updated status lines in `lane.test.ts`.
