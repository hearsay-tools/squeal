# Probes for topic `transport` (row 018-14): throwaway

These scripts are throwaway research probes. They are not product code and not tests. Each takes a work directory, which must be under `$TMPDIR`, and makes scratch git repositories there. They use no user or system git config (`common.sh`) and start no Squeal daemon. Delete the work directory after use.

| Script | What it shows |
|---|---|
| `common.sh` | Shared setup: clean git identity, `GIT_TERMINAL_PROMPT=0`, a bare origin with three commits. |
| `notes-2mb.sh` | The brief's first step: a 2 MB blob as a note on `refs/notes/squeal`, written, pushed and fetched by a new clone, timed; the same as one parentless commit per main commit at `refs/squeal/<sha>`. Also shows that `git notes add -F` changes a binary file and `-C` does not. Refuses to time above load = CPUs. |
| `concurrent.sh` | Two CI writers at once: one notes ref (the second push is rejected; fetch, `git notes merge`, push again) against one ref per commit (no conflict). A ref pointing at a blob. Deleting a per-commit ref. |
| `reader.sh` | The developer side: a configured refspec for a missing ref breaks `git fetch` and `git pull`; `FETCH_HEAD`; notes stay out of `git log`; linked worktrees share the ref; fetching one per-commit ref; offline and credential failures. |
| `no-ref.sh` | `git log --all` lists fetched results refs; a fetch with no destination reads one export and leaves no ref. Run after `reader.sh` on the same directory. |
| `refs-scale.sh` | 400 per-commit refs on the origin: a plain `git fetch` with protocol v2 does not list them; protocol v0 does. |
| `synth-exports.mjs` | N successive exports made from the real cezar export (run 42596322864): per commit, 35% of test files re-key (cezar: 604 files a landing, `main-results.md`) and durations change. |
| `retention.sh` | Bytes per layout over 12 commits: notes with gzipped or raw JSON exports, per-commit refs gzipped or raw; origin after `gc`, a new reader, one more commit, and the notes ref pruned to the last K. |
| `chain.sh` | One ref whose commits chain (parent = previous export): what a reader that holds the previous export receives. |
| `nearest.sh` | In a treeless clone of cezarion, stand-in exports for every main commit with a successful `merge_group` run at that SHA; the nearest-export lookup, timed. |
| `github-rtt.sh` | Read-only network steps to GitHub from this host: `git ls-remote`, a one-commit fetch, the 2 MB artifact download. |

## Recorded output (2026-11-09, git 2.43.0, Node 24.22.1, 24 vCPUs)

`notes-2mb.sh` (load 22.6):

```
run 1 notes: add 72 ms, push 128 ms, fetch (new reader, 1 notes) 130 ms, read 13 ms [-C same, -F changed]; per-commit ref: push 94 ms, fetch one 150 ms [same]
run 2 notes: add 97 ms, push 179 ms, fetch (new reader, 2 notes) 259 ms, read 8 ms [-C same, -F changed]; per-commit ref: push 86 ms, fetch one 125 ms [same]
run 3 notes: add 71 ms, push 144 ms, fetch (new reader, 3 notes) 450 ms, read 12 ms [-C same, -F changed]; per-commit ref: push 104 ms, fetch one 145 ms [same]
run 4 notes: add 68 ms, push 125 ms, fetch (new reader, 4 notes) 639 ms, read 13 ms [-C same, -F changed]; per-commit ref: push 92 ms, fetch one 142 ms [same]
run 5 notes: add 83 ms, push 153 ms, fetch (new reader, 5 notes) 800 ms, read 11 ms [-C same, -F changed]; per-commit ref: push 90 ms, fetch one 153 ms [same]
```

`concurrent.sh`:

```
--- notes ref: two pushes started together
w2:  * [new reference]   refs/notes/squeal -> refs/notes/squeal
w1: remote: error: cannot lock ref 'refs/notes/squeal': reference already exists
w1:  ! [remote rejected] refs/notes/squeal -> refs/notes/squeal (failed to update ref)
--- the loser fetches, merges and pushes again
w1 retry:    eae9312..e03f351  refs/notes/squeal -> refs/notes/squeal
notes on origin: 2 (expect 2)
--- one ref per commit: two pushes started together
w1:  * [new reference]   76a58b4… -> refs/squeal/203f36f…
w2:  * [new reference]   c9f8649… -> refs/squeal/fd583a9…
per-commit refs on origin: 2 (expect 2)
--- a ref pointing at a blob directly
 * [new reference]   7eb6f9a… -> refs/squeal-blob/203f36f…   (cat-file -t: blob)
--- notes ref that already exists: both writers start from the same tip
w2:    196dafa..d024dd7  refs/notes/squeal -> refs/notes/squeal
w1: remote: error: cannot lock ref 'refs/notes/squeal': is at d024dd7… but expected 196dafa…
w1:  ! [remote rejected] refs/notes/squeal -> refs/notes/squeal (failed to update ref)
--- pruning a per-commit ref: delete it on the origin
per-commit refs left: 1
```

`reader.sh` (sections 8 and 11 ran at load 34 to 50, so their milliseconds are not timing results; they show that the command fails at once):

```
--- 1. configured refspec, remote has no notes ref yet
fatal: couldn't find remote ref refs/notes/squeal        exit 128
fatal: couldn't find remote ref refs/notes/squeal        pull exit 1
wildcard refspec, no match: exit 0
--- 2. explicit fetch of a missing ref (command line)     exit 128
--- 4. FETCH_HEAD
--no-write-fetch-head kept FETCH_HEAD
plain fetch rewrote FETCH_HEAD: e9ffb1d…		'refs/notes/squeal
--- 5. git log -1 shows no note; git log --notes=squeal shows {"x":1}
--- 6. a linked worktree sees the fetched ref: {"x":1}
--- 7. fetch one per-commit ref only: {"x":1}
--- 8. offline: connection refused: "Failed to connect … Couldn't connect to server" (18 ms)
--- 9. offline: unroutable address, no timeout set: exit 124, took 20013 ms   (still waiting when timeout(1) stopped it)
--- 10. ssh: unroutable, BatchMode and ConnectTimeout=3: took 3024 ms
--- 11. https remote that asks for credentials, GIT_TERMINAL_PROMPT=0:
fatal: could not read Username for 'http://127.0.0.1:18765': terminal prompts disabled   exit 128, 32 ms
```

`no-ref.sh`: `git log --all in dev: 5 commits, of them results commits: 2`; `fetched 06964de… with no destination; read: {"x":1}`; `refs after: 0 squeal refs; git log --all: 3 commits`.

`refs-scale.sh`: `protocol v2: plain fetch saw refs/squeal/* in 0 packet lines`; `protocol v0: … in 800 packet lines`; `ls-remote of the prefix lists 400 refs`.

`retention.sh` (12 synthetic exports, K = 5; sizes in KiB):

```
notes-gz: origin 24924 KiB after 12 commits; new reader 24921 KiB (all 12); +1 commit 2076 KiB; after prune to 5: origin 10385 KiB, new reader 10382 KiB
notes-raw: origin 11033 KiB after 12 commits; new reader 11029 KiB (all 12); +1 commit 4266 KiB; after prune to 5: origin 5373 KiB, new reader 5369 KiB
refs-gz: origin 24925 KiB after 12 commits; new reader 2075 KiB (latest only); +1 commit 2075 KiB (reader holds the previous ref)
refs-raw: origin 11072 KiB after 12 commits; new reader 2134 KiB (latest only); +1 commit 2134 KiB (reader holds the previous ref)
```

"+1" is the reader's stored pack, which equals the bytes received when the pack is not thin. The `notes-raw` "+1" (4,266 KiB, twice one raw export) is not explained; it was not measured with `GIT_TRACE_PACKFILE`.

`chain.sh` (KiB): raw JSON: origin 11,072, new reader of the whole chain 11,069, +1 commit 2,135; gzipped: 24,925, 24,922, 2,076; raw JSON with durations changed only for re-keyed files: 6,017, 6,014, 2,133. Bytes received for one more chained raw export, from `GIT_TRACE_PACKFILE`: **2,184,465 with the origin's `pack.useBitmaps=true` (git's default after `gc` of a bare repository), 802,594 with `false`** (a thin delta against the export the reader has; the reader then stores about 4,154 KiB, because `index-pack --fix-thin` appends the base).

`nearest.sh` (load 23.2): 368 stand-in exports; `main~0`, `main~1`, `main~5`, `main~20`, `main~43`: nearest export at X itself, 18 to 23 ms each.

`github-rtt.sh` (load 22.3 to 23.5; this host reaches GitHub through an HTTPS proxy):

```
run 1: ls-remote (0 refs) 608 ms; one-commit fetch 593 ms; 2 MB artifact download 1291 ms (2074272 bytes)
run 2: ls-remote (0 refs) 467 ms; one-commit fetch 644 ms; 2 MB artifact download 2484 ms (2074272 bytes)
run 3: ls-remote (0 refs) 480 ms; one-commit fetch 615 ms; 2 MB artifact download 1885 ms (2074272 bytes)
run 4: ls-remote (0 refs) 449 ms; one-commit fetch 601 ms; 2 MB artifact download 1314 ms (2074272 bytes)
run 5: ls-remote (0 refs) 460 ms; one-commit fetch 701 ms; 2 MB artifact download 1404 ms (2074272 bytes)
```

cezarion data (read-only `gh` and `git`): `ci.yml` `merge_group` runs 2026-11-01T11:53Z to 2026-11-09T12:00Z: 462 (370 success, 84 failure, 8 cancelled). Main first-parent commits since 2026-11-01T13:00Z: 368 over 7.92 days (46.4 a day), no merge commits; 367 have a successful `merge_group` run at the exact SHA, 368 have a run of any result; 3 successful runs have a SHA that never reached main. Sample of 42 successful runs (every 9th): 41 ran all four `Vitest shard` jobs, 1 skipped them. Worktrees of `~/projects/cezar` (`git worktree list`, `merge-base` with its `origin/main` at `7b726e2a2`): 69 in all; the 18 whose index changed in the last 24 h are behind main by p50 1, p90 12, max 43 first-parent commits; the 29 of the last 72 h by p50 10, p90 541, max 928.
