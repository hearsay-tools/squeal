# Keys by walk in the checkout (topic keys-by-walk, row 023-15, 2026-11-17)

Short answer: do not use the daemon. Use the gate's keyer (`openDaemonKeying` and `keyFiles`, row 020-51) in-process in the temporary checkout, and only for the test files the fast path cannot settle. The keyer walks each named file's closure fresh over a scratch store, so its keys are exact by construction. It keys every test file in 40 to 58 s, and 1 file in 4 to 6 s. A lookup-only daemon start takes 82 to 145 s. Most of that time is the store's integrity check (53 s and 98 s on these stores). The daemon also keys hits from stored closure lists, not from fresh walks. The fast path is a check from git objects: every input of the current key is unchanged at the commit. It accepted no wrong key in 11,385 file-commit comparisons with walked keys. It settles a median 99% (Squeal) and 91% (squawk) of the test files 1 commit back, 26% and 15% 10 commits back, and 15% and 1% 50 commits back. The parked environment steps add at most 0.1 points on top of it.

Versions: Squeal source and bundle at `9820b54b5` (0.1.538), squawk at `e50c45c72`, Node v26.13.0, pnpm 12.15.0 (12.11.2 pinned in squawk). Stores copied whole with `VACUUM INTO` on 2026-11-17 at 07:56Z. Runs between 07:55Z and 08:34Z on 24 vCPUs, at a one-minute load of 11 to 26, stated beside each number. Probes and outputs: `probes/keys-by-walk/` (README).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Time and memory to list and key every test file in a fresh checkout | Checkout 0.5 to 1.8 s, warm install 0.5 to 0.9 s. Keyer, every file: 40 to 58 s, of which 35 to 52 s is the transform walk; peak 0.75 to 1.2 GB. Lookup-only daemon: 82 to 145 s to its baseline, 60 to 107 s of it before the first key rows, mostly the store's integrity check (53 and 98 s); peak 0.9 to 1.4 GB. | verified by experiment |
| 2 | Bounded, headless run | The daemon can run headless and stop with nothing left, but no command stops it when keying ends. It writes the checkout's `test_file_keys` and overwrites shared closure lists. The keyer is bounded and headless already, and writes nothing shared. No new command is needed. | verified by experiment; read in source code |
| 3 | Partial walks | Yes: `keyFiles` takes named files. Keys equal a full walk's (222 of 222). 1 file: 4.2 to 6.1 s; 10: 6.3 to 8.7 s; 100: 13 to 14 s; all: 57 to 58 s. | verified by experiment |
| 4 | Fast path | Every key input unchanged at X: blobs, absent paths still absent, `dir/` listings, declared patterns, lockfile; plus no change to resolution fields of a `package.json`, or to a `tsconfig*.json`, on the inputs' path, and no untracked input. 0 wrong accepts. Share: see finding 4. | verified by experiment (six commits); inferred (sliding askers) |
| 5 | Flow, wait time, parked code | Fast path, then the checkout and the keyer for the rest, then lookup, then `--run`. About 10 to 25 s one commit back, 45 to 65 s ten or more back. Of the parked code, the untracked-input and tree-listing helpers serve the fast path. The coverage proof is superseded. The environment steps add ≤ 0.1 points. | inferred from 1 to 4 |

## Findings

### 1. Time and memory (verified by experiment)

**Keyer, every test file** (`walk.ts`: `daemonAdapters`, `openDaemonKeys`, adapter `closure` per file, `trackUntracked`, store lookup). The scratch store has no closure lists, so every closure is a fresh walk:

| Checkout | Files | Total | Runner start | Env. read | File hashing | Walk | Keying | Lookup | Hits | Peak RSS | Load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Squeal tip `9820b54b5` | 1,907 | 54.3 s | 0.8 s | 0.6 s | 2.4 s | 47.6 s | 2.3 s | 0.5 s | 1,591 | 749 MB | 22.0 |
| Squeal −1 `8f2b9ecfd` | 1,907 | 50.1 s | 0.6 s | 0.5 s | 1.9 s | 44.4 s | 2.3 s | 0.5 s | 1,591 | 825 MB | 15.8 |
| Squeal −10 `c40cef15e` | 1,907 | 58.1 s | 0.9 s | 0.5 s | 1.9 s | 51.9 s | 2.5 s | 0.3 s | 1,820 | 853 MB | 14.8 to 21.0 |
| Squeal −50 `ad4f00cb2` | 1,898 | 43.4 s | 0.6 s | 0.7 s | 2.7 s | 36.8 s | 2.1 s | 0.3 s | 1,005 | 886 MB | 11.5 |
| squawk tip `e50c45c72` | 1,923 | 40.3 s | 1.3 s | 0.6 s | 1.3 s | 35.3 s | 1.3 s | 0.6 s | 1,624 | 1,197 MB | 21.7 |
| squawk −1 `20e368f85` | 1,917 | 39.2 s | 1.5 s | 0.7 s | 1.7 s | 33.6 s | 1.3 s | 0.4 s | 223 | 1,087 MB | 15.4 |
| squawk −10 `46ffd4917` | 1,906 | 57.4 s | 1.6 s | 0.5 s | 1.6 s | 51.5 s | 1.5 s | 0.6 s | 1,620 | 1,124 MB | 21.0 |
| squawk −50 `7ff341b6e` | 1,908 | 43.9 s | 1.5 s | 0.5 s | 1.1 s | 39.0 s | 1.2 s | 0.5 s | 1,010 | 1,047 MB | 11.2 |

"Runner start" is opening the Vitest and node:test adapters. "Env. read" is reading their environments and setting them on the keys. "File hashing" is the keys' bootstrap (every git-known file hashed in a new worktree). "Keying" is `setClosure`, `trackUntracked` and the key reads. Earlier runs on the two tips took 52.8 s (940 MB, load 20.0) and 45.8 s (998 MB, load 17.7). Peak RSS is the probe process (Vitest runs in-process here); `time -v` gave 0.83 to 1.40 GB.

**Checkout and install**: `git worktree add` 1.8 s (Squeal) and 0.5 s (squawk); warm `pnpm install --frozen-lockfile` 0.47 to 0.85 s, `downloaded 0`; load 19 to 20 (`out/install.txt`). This matches 023-01.

**Lookup-only daemon** (`daemon-start.mjs`: `squeal daemon <root>` on a reflink of the store copy, until the `baseline` checkpoint completes):

| Checkout | Baseline done | First key rows | Hits | Peak tree RSS | Stop | Left running | Load |
|---|---|---|---|---|---|---|---|
| Squeal tip | 88.1 s (first try 97.6 s) | 60.5 s | 1,591 | 898 MB (1,154 MB) | 3.2 s | 0 | 23.1 to 20.6 |
| Squeal −10 | 82.4 s | 65.0 s | 1,820 | 896 MB | 3.5 s | 0 | 25.0 to 16.0 |
| squawk tip | 145.2 s | 106.5 s | 1,624 | 1,394 MB | 7.4 s | 0 | 18.5 to 19.0 |
| squawk −10 | 115.0 s | 100.9 s | 1,620 | 1,355 MB | 7.8 s | 0 | 17.5 to 19.8 |

The daemon opens the store with `checkIntegrity: "quick"` (`src/core/daemon/open.ts:228`), and that runs `PRAGMA quick_check` (`src/core/store/open.ts:208`). On the copies it took 53.4 s (Squeal, 3.95 GB, load 15) and 97.6 s (squawk, 4.88 GB, load 20) (`out/quick-check.txt`). That accounts for most of the time before the first key rows. Keying from stored lists took the next 5 to 10 s. The recheck walk of the misses took 14 to 39 s. The daemon's keys equal the keyer's for 7,643 of 7,643 files at the four commits, and so do its hits.

### 2. A bounded, headless run

- **The daemon** (verified by experiment; read in source code). `squeal daemon <root>` runs in the foreground with no hook and no consumer, and `squeal stop <root>` ended it in 3 to 8 s with no process left (4 of 4). Three things stand against it. No command or flag waits until every file is keyed and then stops: the probe polled the store for the `baseline` checkpoint. A start keys each file "from the stored closure list" and accepts a hit (`bootstrap.ts:34-38`). That is the restart premise, which `glob-membership.md` S7 proved false for a retargeted `package.json` `imports` until row 023-14 lands. Its keys equal fresh walks here, but they are not exact by construction. And it writes to the shared store. The checkout gets a `worktrees` row and 1,907 `test_file_keys` rows, which are deleted only when the worktree is removed from the store (`WORKTREE_SCOPED_TABLES`, `repos/worktrees.ts:19`). The recheck stores commit X's closure lists over the shared ones (log: `storeClosures … 1032 rows written`). Other worktrees then start from X's lists.
- **The keyer** (read in source code, `src/core/scheduler/daemon-keying.ts`, `src/core/code/gate/stored.ts:272`). It is "the one path that keys test files as a daemon in this checkout keys them". `squeal code --base` and `squeal ci export` use it. It runs in-process over a scratch store in `$TMPDIR`. It copies the shared store's observed rows (`observedFrom`), takes named files, and opens the shared store read-only for the lookup. It opens no socket and leaves no rows. No CLI exposes it alone: `squeal code` keys and then runs. So 023-16 needs a function call in the `--at` and proof flow, not a new subcommand or daemon flag (inferred).
- Both paths left a `squeal-links-<worktree id>` folder (4 to 8 KB) in `$TMPDIR` per root (`src/core/watcher/links.ts:70`). D4's per-run `TMPDIR` would hold it and its removal would delete it (inferred).

### 3. Partial walks (verified by experiment)

Named files picked at random from the files whose key differs between the tip and 10 back, keyed at 10 back:

| Files | Squeal total (walk) | squawk total (walk) | Peak RSS | Load |
|---|---|---|---|---|
| 1 | 6.1 s (1.0 s) | 4.2 s (0.2 s) | 562 to 632 MB | 22 to 27 |
| 10 | 8.7 s (4.1 s) | 6.3 s (2.5 s) | 574 to 726 MB | 23 to 26 |
| 100 | 13.3 s (9.0 s) | 14.1 s (9.7 s) | 501 to 764 MB | 25 to 26 |
| all (1,907 and 1,906) | 58.1 s (51.9 s) | 57.4 s (51.5 s) | 853 to 1,124 MB | 15 to 21 |

The fixed part before the walk is 3.7 to 4.6 s: runner start, environments and file hashing. The first file's walk also warms the transform graph that later files share. All 222 keys of the partial runs equal the full walk's keys for the same files. A partial walk saves 76% at 100 files and 90% at 1 file.

### 4. Fast path

**The rule** (`fastpath.mjs`). Take the current key's inputs: the keys' `stabilityPaths`, which are the closure with `dir/` listings, the observed and declared inputs, the project's environment files and the lockfile. Then:

1. Every tracked input has the same blob at X.
2. Every absent input (a resolution candidate that hashes as absent, for example `src/package.json` or `.postcssrc.*`) is still absent at X.
3. Each `dir/` listing has the same entry names in X's tree.
4. No path changed between X and here matches a declared pattern.
5. The installed lockfile's committed `pnpm-lock.yaml` is unchanged.
6. No added or deleted file has the stem of an input module in its folder.
7. No `package.json` on the inputs' path changed `imports`, `exports`, `main`, `module`, `browser`, `type` or `name`.
8. No `tsconfig*.json` on that path changed.
9. No input is on disk without being in git.

When all nine hold, the key at X is the current key, with no checkout. The rule computes no new key. It states the premise a daemon restart relies on, "equal contents import the same files", and checks it. So 023-13 (glob listings) and 023-14 (manifests and shadowing candidates in the closure) close its gaps and the daemon's together (inferred).

**Validation against walked keys** (verified by experiment, the tip's inputs against fresh walks at X):

| | Squeal −1 | −10 | −50 | squawk −1 | −10 | −50 |
|---|---|---|---|---|---|---|
| Walked key equal to the tip's | 1,907 | 933 | 308 | 357 | 0 | 0 |
| Fast path accepts | 1,902 | 932 | 308 | 357 | 0 | 0 |
| Accepted but walked key differs | 0 | 0 | 0 | 0 | 0 | 0 |

That is 0 wrong accepts in 11,385 file-commit comparisons. The 6 Squeal files the rule rejects although their key held all read an untracked path (condition 9). The brief's literal condition 7, any change to a `package.json` or `tsconfig` on the path, accepts 0 Squeal files at −10 and −50. Version bumps change four `package.json` files there, none in a resolution field.

**Share by distance.** From the tip, the share drops at the commits that change widely read files. Squeal: 99.7% for 1 to 6 back, 48.9% at 10, 19.1% at 20, 16.2% at 50. squawk: 18.6% at 1 back, and 0% from 2 back, because its lockfile changed there (`out/fastpath-curve-*.jsonl`). One asker is noisy, so the same rule ran for 10 askers, the tip and every 5th main commit before it. It reused the tip's inputs, so these numbers are inferred (`out/fastpath-slide-*.jsonl`):

| Distance | Squeal median (mean, range) | squawk median (mean, range) |
|---|---|---|
| 1 commit | 99.4% (85.1%, 23.0 to 99.7) | 91.2% (71.8%, 18.6 to 96.6) |
| 10 commits | 26.1% (33.0%, 19.1 to 49.9) | 15.2% (18.0%, 0 to 44.4) |
| 50 commits | 15.1% (16.0%, 12.4 to 21.8) | 0.7% (2.3%, 0 to 8.7) |

Fifty main commits span about 6 hours in Squeal and 18 hours in squawk. These shares are below the first finding's key reuse of 91/50/27% and 73/25/2% (`../../018-ci-and-shared-results/research/results-at-commit.md`, Q4). That finding used another week of history and another rule. The walked keys here agree with this rule at every validated commit. Why the two differ is not determined.

**Runtime.** The decision for about 1,900 files took 1.1 s (Squeal) and 1.4 s (squawk), at load 14, with 190 to 250 MB, in an unoptimised probe.

**Limit** (inferred from `environment-at-commit.md` Q1). An environment input that the key does not list breaks condition 1's premise. squawk's `web` config runs a script that reads `src/home/identity.ts`, and that file is not a runner file. No such case showed in the validation. D2's existing refusal covers it: a project whose stored descriptors show a config-only difference skips the fast path.

### 5. Flow, wait time and the parked code

- **Parked environment steps** (verified by experiment, variant V5 in `out/fastpath-slide-*.jsonl`). Let a changed lockfile alone pass to D2.2's derived environment. The fast path then grows by 0.0 points in Squeal and by 0 to 0.1 points (mean) in squawk. Lockfile changes come with closure changes. The checkout's install gives the exact environment hash in under 1 s anyway (`environment-at-commit.md` Q3).
- **Parked helpers** (read at `park/023-03-git-keys` `0ca88170e`). `at-keys-untracked.ts` (`untrackedInputs`) is condition 9. `at-keys-globs.ts` (`entryNames`, `namesOf`) is condition 3, from a commit's tree. `at-keys-coverage.ts` (`targetCoverage`) is superseded: the fast path proves nothing about X's closure, it only checks that every input is unchanged. 023-14 puts `candidates` and `stemOf` into the closure itself.

## Recommendation for Squeal

1. **`squeal status --at X [paths]`.**
   1. Select the test files.
   2. Apply the fast path to each, against this worktree's current key inputs. Against a dirty tree, compare X's blobs with the current file hashes, not `HEAD`. About 1 s; no checkout.
   3. For the rest, make D4's checkout at X (about 1 to 2 s) with a warm frozen install (under 1 s).
   4. Key only those files with the gate's keyer in-process: 4 to 6 s fixed, plus 2.5 to 4 s for 10 files, 9 to 10 s for 100, 35 to 52 s for all.
   5. Look each key up in the shared store read-only. Remove the checkout (1 to 1.5 s, 023-01).
   6. With `--run`, the gate runs the misses with the same keyer in the same process before the removal.
   Never start a daemon in the checkout, and write no `test_file_keys` for it.
2. **What an agent waits for, on this host at load 11 to 26.** One commit back: about 10 to 15 s for Squeal (a median of about 11 files to walk) and about 20 to 25 s for squawk (about 170 files). Ten or fifty commits back: 45 to 65 s for every file. Paths narrow it, as finding 3 shows. Then D4's run budget applies.
3. **`squeal proof`.** A side is a mixed tree, so its key cannot come from the fast path unless it equals today's tree. Make the checkout at the side's code version, copy in the side's test files, and key that one file with the keyer: about 6 to 8 s before the store lookup or the run.
4. **Parked 023-03 code.** Land none of the environment steps for this slice. Reuse `untrackedInputs` and the tree-listing helpers in the fast path. Drop the coverage proof.

The tradeoff that decides it: the fast path costs one git diff and settles most near commits. A walk is exact by construction but costs about 25 ms per file in a full run and 90 ms per file in a run of 100. The daemon adds an integrity check that grows with the store (53 to 98 s here), and it adds shared-store writes, for no exactness gain.

## Open questions for the human

1. `status --at` without `--run` was specified as needing no checkout (D1). With the fast path it needs one only for files whose inputs changed. Should that checkout be made by default, as an extra 5 to 60 s, or only with a flag, printing `not determined (changed inputs)` otherwise?
2. Not determined: the source of the current key inputs when no daemon runs (the probe walked the tip). The daemon's index holds them; without a daemon, the keyer must walk here too.
3. Not determined: why the daemon's integrity check costs 53 to 98 s on every start in a new worktree. It is outside 023 but slows every first start on these stores.
4. Not determined: why these fast-path shares are below the first finding's key reuse at 10 and 50 commits.

## Sources

- Squeal source at `9820b54b5`: `src/core/scheduler/bootstrap.ts`, `daemon-keying.ts`, `daemon-keys.ts`, `keying.ts` (`stabilityPaths`, line 1035); `src/core/code/gate/stored.ts` (`openKeyer`, `keyFiles`); `src/cli/code-gate-stored.ts` (`daemonAdapters`); `src/core/store/open.ts` (`integrityProblem`); `src/core/daemon/open.ts:228`; `src/core/store/repos/worktrees.ts:19`; `src/core/keys/observed.ts` (`listingPath`, `Listings`); `src/core/watcher/links.ts:70`. Bundle `plugins/claude-code/dist/cli/squeal.mjs` (0.1.538).
- Parked 023-03 at `origin/park/023-03-git-keys` (`0ca88170e`): `src/core/commit/at-*.ts`.
- Findings: `temp-checkout.md`, `environment-at-commit.md`, `glob-membership.md`, `../reviews/wave-3.md`, `../../018-ci-and-shared-results/research/results-at-commit.md`.
- Stores, whole `VACUUM INTO` copies: `~/projects/squeal/.git/squeal/store.sqlite`, `~/projects/cezar/.git/squeal/store.sqlite`. Git: Squeal main `9820b54b5` and its 100 first-parent ancestors; squawk main `e50c45c72` and its ancestors.
- Probes and outputs: `probes/keys-by-walk/` (README).
