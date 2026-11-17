# Results at a commit (topic results-at-commit, 2026-11-16)

The human, 2026-11-16: an agent wants the results at a commit, the checks with no result there, and maybe to have Squeal run those. "Do we need the checkout if we already have the hash stored?"

Short answer: to look results up at a commit, no checkout is needed. Squeal can compute the keys from `git ls-tree` plus this worktree's closures and environment, and code for that already exists. To run the missing checks, a checkout is needed. The `commit_sha` label does not answer the question: at recent main commits it finds 0.9% (Squeal) and 4.1% (squawk) of the test files.

Source read at `36361d5e3` (Squeal 0.1.523). Stores read live and read-only on 2026-11-16, 15:05Z to 15:30Z, at a one-minute load of 26 to 30 on 24 CPUs. No timing is reported for that reason. Probes: `probes/results-at-commit/` (README lists each script and output).

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | What `WHERE commit_sha = X` returns against the test files at X | Almost nothing. At main commits less than a day old: 0.9% (Squeal) and 4.1% (squawk) of the listed test files. Reasons, by size: no daemon was ever at X (90.6% and 93.7% of main commits), unchanged files keep an older label, pruning after 7 days, dirty labels, labels replaced at the same key. |
| 2 | Keys at a commit from git objects alone | Only the closure segment. File hashes equal git blob ids (0 differences on 25,458 tracked paths). The environment hash, the per-file package segment, the closure lists and untracked inputs need this worktree, an install or a run. |
| 3 | A per-commit key history | 79 to 81 KB per commit in a compact table (8 to 23 KB as deltas), against about 600 KB in today's `test_file_keys` layout. It answers only for commits a daemon saw clean: 9.4% and 6.3% of main commits. It answers nothing for other commits. |
| 4 | Share of keys equal 1, 10, 50 main commits apart | Squeal: 90.8%, 50.4%, 27.4%. squawk: 73.3%, 25.0%, 1.9% (real keys at distance 1: 73.5%). The largest breaks are the release version in `package.json` (Squeal) and the environment (squawk: setup and config files, lockfile, Node pin). |
| 5 | Where `squeal code --base` and `refs/squeal/<sha>` already cover it | Only partly. `code --base` keys the working tree, not the base. CI refs cover main commits with a ref, passes only, and only at the worktree's start point. No command takes a commit. |
| 6 | Recommendation | Computed keys, through the existing re-key and commit-report code. Not label lookup, not a key history. Running the missing checks needs a checkout of X. |

## Findings

### 1. Label lookup against the files at X

Method (verified by experiment, `label.mjs`): 100 first-parent main commits per repository (the newest 40, then 60 spread back to the store's first row). A test file is "at X" when a live worktree lists it (`test_file_keys`) and `git ls-tree X` holds its path: about 1,870 files (Squeal) and 1,926 (squawk) per commit. For each file the probe asks: is there a clean row labelled X? If not, is there a clean row under another label whose content at that label equals X's? Content means the store's closure list plus the observed entries, over each commit's blobs, with the environment's runner files, the lockfile and the Node pin file (`lib.mjs`, "content proxy").

| Commit age | Commits | Clean row labelled X | Only dirty rows labelled X | Same content, older main label | Same content, newer main label | Same content, non-main label | No row with X's content |
|---|---|---|---|---|---|---|---|
| Squeal, under 1 day | 41 | 0.9% | 0.8% | 17.8% | 2.4% | 28.5% | 49.5% |
| Squeal, 1 to 7 days | 12 | 0.0% | 0.0% | 14.9% | 6.2% | 16.6% | 62.3% |
| Squeal, 7 days or more | 47 | 0.0% | 0.0% | 0.1% | 0.6% | 0.1% | 99.3% |
| squawk, under 1 day | 41 | 4.1% | 1.7% | 6.2% | 3.5% | 9.0% | 75.5% |
| squawk, 1 to 7 days | 13 | 7.5% | 1.6% | 40.6% | 12.8% | 8.5% | 29.0% |
| squawk, 7 days or more | 46 | 0.0% | 0.1% | 0.0% | 0.1% | 0.3% | 99.6% |

Only 9 (Squeal) and 10 (squawk) of the 41 newest main commits have any clean row labelled with them.

The reasons the label and the files differ:

- **No daemon at X.** Over the last 1.98 days a live daemon had 41 of 438 Squeal main commits (9.4%) and 6 of 96 squawk main commits (6.3%) as a clean revision head (`seen.mjs`; removed worktrees' revisions are pruned, so this is a lower bound). Worktrees work on their own branches: 72 of 113 and 27 of 33 clean heads were not main commits. Since baseline is lookup-only, a new worktree at main runs nothing that is not changed. So most main commits get no row of their own, except through an import (verified by experiment).
- **Reused rows.** A key written once is never written again while it holds a row. The daemon looks a key up before it runs, and an import keeps a key the store already holds (`holdsKey`, `src/core/store/transfer-rows.ts:59`, read in source code). Of 152,474 file keys that squawk's 100 imports stored, 36.0% still carry the import's own commit, 45.2% carry an earlier import's commit (the key did not change between the two main commits), and 18.7% carry a local worktree's commit (`import-labels.mjs`, verified by experiment).
- **Replaced labels.** `putMany` writes with `INSERT OR REPLACE` (`src/core/store/repos/results.ts:141`), so a rerun at the same key (a retry, a rerun under load) moves the label to the rerun's commit. `copyNewest` (row 011-38, same file, line 63) copies rows to a new key with their old commit label. Read in source code. The 18.7% above includes these cases. The probe cannot separate them from local runs that came first.
- **Dirty rows.** 51.0% of Squeal's rows (733,160 of 1,437,098) and 32.9% of squawk's (1,320,824 of 4,009,420) have `dirty = 1`. Their label names `HEAD`, but the content was not `HEAD`'s (verified by experiment, `q.mjs`).
- **Pruning.** Results under no live key, other than the newest per check on the main worktree, are deleted after 7 days (`src/core/store/prune-rules.ts`, `UNPROTECTED`, read in source code). Rows older than 7 days are 1.0% (Squeal) and 1.8% (squawk) of all rows (`out/ages.txt`). This is why commits older than 7 days show 99% or more "no row" (verified by experiment).

How exact the content proxy is (verified by experiment, `agree.mjs`): on 110,921 file pairs from consecutive squawk imports with one environment hash, the proxy and the real key agree on 94.6%. It calls 2.2% equal where the keys differ, and 3.2% different where the keys are equal. "Same content" in the table does not mean "same key here": squawk's matches held more than one key for 34.9% of the files (10,546 of 30,240), because of other environments (Node 24 and 26, CI and local, nine projects). Squeal's held more than one key for 0.7%.

### 2. Keys from git objects alone

A key is `sha256(environment hash, project, test path, dependency segment, runtime segment, (path, hash) over the closure list)` (`src/core/keys/check-key.ts`). Per input (read in source code unless marked):

| Input | Where it comes from | From git objects? |
|---|---|---|
| File hash of a closure path | Git blob id of the bytes on disk, no filters (`src/core/hash/blob.ts`) | Yes, for tracked files. Verified by experiment (`blobs.mjs`): in two clean worktrees, 12,418 and 13,040 stored hashes equal `git ls-tree HEAD`, 0 differ. Files that git converts (`eol`, `filter`) differ: spec 019 row 019-37 handles this through `storedBlobs`. |
| Listing paths (`dir/`) | Entry names of the files the watcher tracks, plus names on disk for ignored directories (`src/core/keys/observed.ts`, `Listings`) | From the commit's tree when the directory holds no untracked file. D11 does this (`commitSegments`, `src/core/store/transfer-rekey.ts`). |
| Untracked or ignored inputs | Files on disk | No. squawk's worktree hashed 893 such paths (`packages/cezar/dist` 788, `packages/cezar/web` 105), and 14 of its 821 listed test files name one. Squeal: 0 of 1,742 (verified by experiment, `disk-only.mjs`). |
| Closure list | Vitest's transform graph, declared inputs, observed reads (`src/core/keys/closure.ts`) | No. The store holds today's list and the shared observed union, not X's. A list that lacks a path X's run would read can match a result whose content differed in that path. D11 rejects that case with "the local list holds every exported path". A computed lookup must reuse that rule. |
| Environment hash | Node version, platform, arch (the machine); runner and adapter versions, key format (installed packages and Squeal); resolved config (Vitest loads it); allow-listed environment variables; installed-dependency fingerprint from `node_modules/.pnpm/lock.yaml`; runner files (config, setup closure) (`src/core/keys/environment.ts`, `environment-hash.ts`) | No. From git alone Squeal can only decide that X's environment equals this worktree's: equal blobs for the runner files, the lockfile and the Node pin. |
| Dependency segment | The installed package graph and the packages the file imports (`src/core/keys/dependencies.ts`) | No. The store does not keep it; exports carry it as `keyParts` (018 D11). |
| Runtime segment | `runtimeFiles` paths from `squeal.config.json` (`src/core/keys/runtime-files.ts`) | Yes (the policy file is tracked). |

So the keys at X are exact from `git ls-tree X` only as "this worktree's environment, closure lists and dependency segments, over X's blobs". Two shipped paths already compute keys that way. One is 018 D11's re-key at import (`committedBlobs` in `src/core/commit/tree.ts`, `keyOver` in `transfer-rekey.ts`). The other is 019 D5's commit report, which marks a file "not determined" where the working tree and the commit differ (`src/core/commit/compute.ts`).

### 3. A key history by commit

Today `test_file_keys` keeps one row per worktree and listed file: 29,409 rows (Squeal) and 57,947 (squawk). With its two indexes, a row costs 320 and 396 bytes (`dbstat`). That is 598 KB and 762 KB per recorded commit (verified by experiment).

A history table of (commit id, file id, 32-byte key), measured in a scratch SQLite file with 100 commits (`history-size.mjs`, verified by experiment):

| Repository | Files | Full rows per commit | Delta rows only (rate from Q4, distance 1) | Today's layout per commit |
|---|---|---|---|---|
| Squeal | 1,870 | 79 KB | 8 KB (9.2% change) | 578 KB |
| squawk | 1,926 | 81 KB | 23 KB (26.7% change) | 596 KB |

Daemons saw 57 (Squeal) and 17 (squawk) clean heads a day. That is 4.5 and 1.4 MB a day for full rows, or 0.5 and 0.4 MB with deltas (inferred from the two measurements). The bytes are cheap, but the coverage is poor:

- A history answers only for commits a daemon saw clean: 9.4% and 6.3% of main commits (Q1). It answers nothing for any other commit, which is most of them.
- Results under those keys are still pruned after 7 days, so an older history points to deleted rows.
- Each key-format or adapter-version change moves every key of a runner at once. The key format changed 21 times from 2026-10-10 to 11-01 and 0 times since. Vitest and node:test adapter versions changed 8 times from 11-07 to 11-12 (`git log -G` on main, verified by experiment).

### 4. Reuse rate 1, 10 and 50 main commits apart

Method (verified by experiment, `reuse.mjs`): 40 pairs per distance, spread over first-parent main. For Squeal the pairs start on 2026-10-28, because Squeal moved from npm to pnpm on 10-27. Before that day the proxy would read `package-lock.json`, which every release rewrites. For squawk the pairs start on 2026-10-15. A pair is "equal" when the content proxy is equal. Otherwise the first part that differs is named. A lockfile change re-keys only the files whose packages moved (row 011-85), so the lockfile column is an upper bound. Real keys come from squawk's imports (`import_files`), compared where both commits hold the file under one environment hash.

| Distance | Squeal (3,243 commits, ~170 a day) | squawk (1,282 commits, ~40 a day) | squawk real keys, same environment | squawk real keys, environment differs |
|---|---|---|---|---|
| 1 | 90.8% | 73.3% | 73.5% of 110,921 | 23.5% of 144,982 files |
| 10 | 50.4% | 25.0% | 36.0% of 46,470 | 65.9% |
| 50 | 27.4% | 1.9% | 29.3% of 368 | 99.6% |

First break, as a share of file pairs:

| Distance | Squeal: lockfile / runner files / closure (with `package.json`) | squawk: Node pin / lockfile / runner files / closure (with `package.json`) |
|---|---|---|
| 1 | 0 / 0 / 9.2% (2.3%) | 0 / 0 / 3.0% / 23.5% (4.3%) |
| 10 | 2.6% / 0 / 46.9% (22.0%) | 0 / 4.7% / 42.6% / 26.8% (3.7%) |
| 50 | 6.8% / 2.3% / 63.0% (37.7%) | 3.2% / 28.5% / 51.4% / 11.7% (4.3%) |

Expected breaks, counted on main (verified by experiment, `git log`): `pnpm-lock.yaml` changed in 4 of 3,243 Squeal commits and 13 of 1,282 squawk commits. Node: Squeal has no pin file. Its daemons moved from v24.22.1 to v26.13.0 on 2026-11-11 (`environments` table), and that moved every key once. squawk's `.node-version` changed once (2026-11-10). Squeal's largest cause is the release version in `package.json`, which 37.7% of the pairs 50 apart break on. This is "results survive releases" (row 011-35), already named in `ci-run.md` 4. squawk's largest cause is its runner files (config and setup closure).

### 5. What already covers this

- **`squeal code --base <ref>`** (020 D3, D11.7, D17.3, read in official docs): it selects test files from the diff between the base and the working tree, keys them at the working tree, reads stored results at those keys, runs the rest, and writes completed files at their keys. It answers the "after" side. It never computes keys at the base.
- **`refs/squeal/<sha>`** (018 D2, D13, D14, read in official docs): one CI export per main commit. squawk has 47 refs, and 7 of its newest 9 main commits have one. Exports resumed on 2026-11-16 after #228 (`refs.mjs`, verified by experiment). Squeal's own repository has none, because its `squeal.config.json` has no `shared` key. The reader imports only the worktree's start point. An export holds passes and skips only: "a file with any failure at its key is left out whole" (D2). So it cannot say whether a check already failed at X, which is the case a before/after comparison needs most.
- **Commit report** (019 D5, `src/core/commit/`): it computes keys from committed blobs at each `HEAD` the worktree moves to. It stores counts and up to 10 not-determined files, and keeps 20 reports per worktree.
- **`squeal export`** (018 D2): the worktree's `HEAD` only.

No command takes an arbitrary commit. The pieces exist: `committedBlobs`, D11's `commitSegments` and `keyOver` with its closure rule, 019's `differingPaths` for "not determined", and `ResultRepo.keysWithResults` for the lookup.

The smallest shape that answers the three asks (inferred; the spec decides):

1. "Results at X": one read-only command with a commit argument, for example `squeal status --at <commit>`. It computes this worktree's keys over `git ls-tree <commit>` and prints, per test file, the result at that key with its origin, or "no result", or "not determined". "Not determined" applies when the runner files, the lockfile or the Node pin at X differ from this worktree's, or when a closure path is untracked.
2. "Missing at X": the same output, filtered.
3. "Run the missing": tests read files on disk, so X's bytes must be on disk. That means a temporary checkout at X (`git worktree add --detach`) with its install, then `squeal code --test <files>` there. That checkout shares the store, and 020 D17.3 writes the completed files at X's keys, so step 1 then finds them. This works today as a manual recipe (inferred from 020 D17.3 and the shared store; not run).

## Recommendation for Squeal

Use computed keys, built from the existing D11 re-key and 019 commit-report code. Do not use label lookup, and do not add a key history.

- Label lookup fails by construction. It finds 0.9% and 4.1% of the files at recent main commits. Only 36% of imported keys keep their own commit label, and 33% to 51% of rows carry a dirty label.
- A key history is cheap, at 8 to 81 KB per commit. But it covers 6% to 9% of main commits, and those are the commits a daemon was already at.
- Computed keys need no checkout and cover any commit whose environment equals this worktree's. One main commit apart that is 91% (Squeal) and 73% (squawk) of the files. Fifty commits apart it falls to 27% and 2%. That bounds how far back a before/after comparison can reuse results before it must run tests.
- Whatever the lookup, results older than 7 days are pruned (99% or more missing). So "results at X" is a recent-commits feature, unless retention changes.
- Running the missing checks needs a checkout of X: tests read files on disk.

## Open questions for the human

1. Retention: should results at main commits survive longer than 7 days, so that "results at X" works for older bases? This changes the prune rule (001 D8 as amended). It is not a lookup question.
2. Failures at X: CI exports leave out every file with a failure. Should a before/after answer rely on local runs for failures at X, or should exports carry failures for this use (018 D2 rejected that for import)?
3. Should "run the missing" stay a printed recipe (checkout, install, `squeal code --test`), or should Squeal make the temporary checkout and install? The cost is one install per commit asked.
4. Where X's environment differs (lockfile, Node), should the answer stop at "not determined", or run at X's environment? The second needs an install at X.

## Sources

- Code at `36361d5e3` (Squeal 0.1.523): `src/core/keys/check-key.ts`, `environment-hash.ts`, `environment.ts`, `dependencies.ts`, `closure.ts`, `observed.ts`, `runtime-files.ts`; `src/core/hash/blob.ts`; `src/core/store/schema.ts`, `repos/results.ts`, `prune-rules.ts`, `transfer-rekey.ts`, `transfer-rows.ts`, `imports.ts`, `environments.ts`, `import-edges.ts`; `src/core/commit/tree.ts`, `compute.ts`, `store.ts`, `report.ts`; `src/core/types/state.ts` (`importMark`).
- Specs: 018 D2, D3, D4, D11, D13, D14 (`../spec.md`); 019 D5 (`../../019-run-triggers/spec.md`); 020 D3, D11.7, D17.3 (`../../020-quality-gate/spec.md`); `ci-run.md` 4 (earlier key-reuse replay over 20 landings).
- Stores, read-only: `~/projects/squeal/.git/squeal/store.sqlite`, `~/projects/cezar/.git/squeal/store.sqlite`. Git: `origin/main` of both checkouts. `git ls-remote origin 'refs/squeal/*'` (read-only) in squawk's checkout.
- Probes and outputs: `probes/results-at-commit/` (README).
