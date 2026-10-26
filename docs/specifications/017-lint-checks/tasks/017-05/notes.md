# 017-05: notes for the next rows

Worker 8f337351, 2026-10-26. The daemon's lint pass over a fake `LintProvider`, and review 0.1.344 S1. The coordinator (605ca21e) approved the design before the build (reply 6e23518b). 017-04's provider was not used: every test drives `FakeProvider` in `test/lint/pass/helpers.ts`.

## Seam map

| File | What it holds |
| --- | --- |
| `src/core/lint/pass/provider.ts` | The wave 1 interface, as the coordinator gave it: `LintProvider` (`open`, `refresh(level)`, `inputs`, `lint`, `close`), `LintOff`, `LintDeclaration`, `LintEnvironment`, `LintSnapshot`, `LintRunReport`. |
| `src/core/lint/pass/types.ts` | `LintSource` (what `codePass.mainStoreSource` gives), `LintPassOptions`, `LintPassReport`, `LintCapacity`. |
| `src/core/lint/pass/index.ts` | `createLintPass`: the loop, one wake timer, the feed set, the store opener (a corrupt store is deleted and made again), shut while `lint.enabled` is false. |
| `src/core/lint/pass/run.ts` | One pass: the provider ready, then `rekey`, then `lintParts`. |
| `src/core/lint/pass/session.ts` | `ProviderSession` (open, refresh, off, close), `refreshLevel` (D4), `mayTurnOn` (D9), `isFlatConfig`. |
| `src/core/lint/pass/keys.ts` | `lintKey` over `checkKey` (D5), `environmentOf`, `programSegment`, `includedSet`. |
| `src/core/lint/pass/keyer.ts` | `Keyer`: cached blobs, inputs and the program segment for one pass. |
| `src/core/lint/pass/rekey.ts` | D7 steps 1 to 3: plan (`first`, `edit`, `config`), key, look up, judge hits, mark misses `pending` and other whole-program files `stale`, all in one transaction with the cursor. |
| `src/core/lint/pass/parts.ts` | D7 step 4: parts of at most `PART_FILES` (16), the order, the pool slot per part. |
| `src/core/lint/pass/lint-part.ts` | One part's lint call and its results: judged, `unknown`, `LintOff`, a grown closure or program. |
| `src/core/lint/pass/judge.ts` | States and transitions from a result (D2), with 017-03's `lintTransition`. |
| `src/core/lint/pass/records.ts` | The pass's meta rows in `lint.sqlite`: `lint-cursor:`, `lint-quiet:`, `lint-program:`, `lint-off:`, `lint-failed:`, each followed by the worktree id. |
| `src/core/lint/pass/idle.ts` | `lintIdleIn`: when stale files may lint (004's slow trigger). |
| `src/core/lint/transition.ts` | S1 only: `unmatched` marks matched positions, so one finding object given twice is two occurrences. |
| `src/core/daemon/daemon.ts` | `DaemonOptions.lintProvider`, the pass created beside the code pass, its nudges, the `lint.close` step. |
| `src/core/scheduler/scheduler.ts`, `src/core/types/scheduler.ts` | `capacity()` and `SharedCapacity` (agreed with 011, own commits). |

## Decisions the spec did not settle

1. **The first pass is quiet**, as 015's first count is. A first or config keying puts its misses in the quiet set. A quiet file records no transition when it lints. An edit to a quiet file before it lints keeps it quiet. Each time the queue is read, the set is pruned to the files still `pending` or `unknown`.
2. **Meta keys carry a `lint-` prefix.** The main store's meta key registry test scans every key literal, and `quiet:` collided with it.
3. **Feed.** Every changed program file goes in the edit's lint call, including hits and files ESLint does not lint (017-04's contract). A part's results count only when every changed program file was fed by the end of its call. With more than 16 fed files, the earlier parts leave their misses `pending`, and the queue is read again.
4. **Refused inputs keep the cursor (D9).** The files with a state read `unknown` with the reason, `lint-failed:` holds it, and the next pass keys them again.
5. **A pass that throws gets no retry timer.** The pass tells the error once per message and closes the provider. The next nudge, which comes with the next revision, opens a new provider.
6. **An off provider opens again only on a change that may turn it on.** `LintOff` sets `lint-off:` and closes the provider. Only a changed flat config at any depth, a `package.json` or the installed lockfile opens it again.
7. **A removal is a transition only in an edit keying,** and only for a file outside the quiet set. A file that a config change excludes leaves with no transition.
8. **A nested `eslint.config.*` is a config change** (017-04: `configFiles` lists only the root config). It refreshes the instance before the closure is checked, and every file is keyed again with no transition. The environment hash does not hold nested configs. The changed paths since the cursor carry them, also across a daemon restart.
9. **Deviation from D5, approved:** the key's package part is the whole `installedDependenciesFingerprint`, and only when the config loaded a package. 017-04's `packages` are absolute real paths, so they never go in a key. The coordinator records this in `status.md`.
10. **Stale files wait for 004's slow trigger.** With `continuous`, the latest revision must be `slow.quietMs` old and the scheduler must have no work in use. With `idle`, no consumer may be in a turn. While busy, the pass looks again after `SLOW_RECHECK_MS`.
11. **Pool (011 C10, as agreed):**
    - An edit's own part calls `running(1)`.
    - A first, config or stale part calls `take(1, "slow", 1, "backlog")` and releases the lease in a `finally`. No lease is held across parts.
    - A refused lease ends the pass, with one wake at `CAPACITY_RECHECK_MS`.
    - With a `null` pool, or one that failed, the part runs ungranted.
    - The pass never closes the shared `TierCapacity`.

## Gaps

- **The program segment follows the policy.** The segment hashes the program files and the files the pass lints. A file ESLint lints but `lint.include` or `lint.exclude` leaves out does not move the segment.
- **Prune does not exist yet.** When the result a state was judged at is gone, `judge.ts` `changeOf` compares fingerprints. The transition then names the new findings as added and none as removed. Prune must keep every result a state's judged key names (017-03's notes).
- **No default provider.** `DaemonOptions.lintProvider` has no default, so a real daemon starts no lint pass. The integrator adds one line in `startDaemon`'s options, or in the daemon's own default: `lintProvider: () => <017-04's factory>(root)`.
- **Bundle drift.** `daemon.ts` changed, so `cli/squeal.mjs` and the plugin bundles differ from the build. This brief forbids `npm run build`, so the bundles were not rebuilt. Four tests fail in this worktree with "cli/squeal.mjs differs from the build", each named "has the bundles exactly as … produces them" or "are committed exactly as `npm run build` produces them": `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`.

## The first pass over this repository

Probe: `npx tsx docs/specifications/017-lint-checks/tasks/017-05/measure-first-pass.ts .`

The fake provider answers at once with no finding and makes no CPU load (011's rule). The numbers are Squeal's own cost: keying, lookups, store writes and leases. ESLint's cost is 017-04's measurement. The pool is a fresh temporary directory, so the probe takes no permit of the user's pool. Repository: 8,328 tracked files, 3,492 keyed (the fake lints `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.tsx` and `.jsx`), 3,488 linted.

Real load during the runs: 1-minute load average 32 to 37 on 24 cores. Part of it was this worktree's own Squeal queue after the `daemon.ts` edit, part the other coordinators' work. No load was made on purpose.

| Pass | Wall | Main-thread CPU | Host busy cores (of 24) |
| --- | --- | --- | --- |
| First pass, run 1 | 5,202 ms | 2,477 ms | 20.5 |
| First pass, run 2 | 3,825 ms | 1,961 ms | 17.4 |
| First pass, run 3 | 2,453 ms | 1,700 ms | 12.9 |
| Second worktree, every key a hit | 120 to 183 ms | 160 to 238 ms | |
| One-file edit (its computed config moved) | 10 to 19 ms | 11 to 13 ms | |

The host busy cores are the whole host's. The pass itself used one thread, at about 0.5 to 0.7 of a core: CPU divided by wall.

Before the last performance commit (`fd439c8a2`), the first pass took 4,967 ms wall and 3,578 ms CPU, and a one-file edit 40 ms and 53 ms. That commit made three changes:
- An edit reads the states of its own paths only, not every state.
- Parts come from a queue read once per pass, not once per part.
- The quiet set is held in memory and written when the pass ends.

## Type changes

All additive:
- `SharedCapacity` (new, `types/scheduler.ts`).
- `Scheduler.capacity(): SharedCapacity | null`, with `TierScheduler.capacity(): TierCapacity | null`.
- `DaemonOptions.lintProvider?: () => LintProvider`.
- The `LintProvider` interface and its types, new in `src/core/lint/pass/provider.ts`.

## What the next rows must know

- **Wave 2 (delivery and status)** reads the following from `lint.sqlite`:
  - The states: `outcome`, `stale`, and `reason` on `unknown`.
  - The transitions.
  - `lint-off:<worktree>`: why lint is off, set on `LintOff` and cleared when the provider opens.
  - `lint-failed:<worktree>`: why keying failed, cleared by the next keying that succeeds.

  `offKey` and `failedKey` are exported from `src/core/lint/pass/index.ts`.
- **`onPass`** is a test seam. The daemon passes none.
- **`LintSource`** is what the pass reads of the main store: `latestRevision`, `changedPaths`, `file`, `files`, `ignored`. The daemon gives it `codePass.mainStoreSource(...)`.
- **Tests.** The daemon test (`test/lint/pass/daemon.test.ts`) uses a real daemon over a fixture repository with the fake provider. Every other test in `test/lint/pass/` drives `createLintPass` over `FakeWorktree` from `test/code/pass/helpers.ts`.
