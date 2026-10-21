# 011-61: validation on hold while the index has unmerged paths, and a hold bound to a command, a design for the human

Board row 011-61, a docs-only design draft (brief: `tasks/wave-8.md`, section W5). The human approved the row on 2026-10-21 (triage round 9, group B), with gh-68 and gh-49 merged into it. Code follows the human's acceptance.

Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in "Spec text" go into 011 C9, with one sentence each in C2, C6, C8 and C15; `status.md` gets a dated line, and the board numbers the code rows in section 4.

Sources: `research/issue-68.md` and its probe `research/probes/issue-68/` (Squeal 0.1.235); `research/issue-49.md`; issues #68 and #49 with their comments (read 2026-10-21); 011 C2, C4, C6, C8, C9, C15 and `status.md`; board rows 011-08 (stop until the next edit) and 011-30 (handoff). Source read at `abb858c9` (main): the brief's seams `src/core/hash/git-index.ts`, `src/core/watcher/paths.ts`, `src/core/daemon-loop/head.ts`, `src/core/scheduler/head-move.ts`, `src/cli/stop.ts`, `src/cli/stopped-mark.ts`, and, to name the code rows, `src/core/scheduler/scheduler.ts` (`#pump`, `#record`), `batch.ts`, `src/core/daemon/daemon.ts` (`#cancelTiers`), `src/core/delivery/harness-process.ts`, `src/core/delivery/header.ts` and `src/core/types/store.ts`.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Reporter evidence from an issue is named as such.

**Probe status.** One git-only probe is written: `probes/git-unmerged.sh` (no Squeal, no daemon). It did not run. The one-minute load was 47.57, 30.16, 32.37, 49.17 and 43.53 on 24 CPUs at five checks during this session, the last at 14:50 UTC, and the brief allows probes only below 24. The git facts it would check are tagged `read in official docs` below, with the probe named. Nothing in the recommendations depends on a fact the probe could overturn, except the write order in section 1.4, which the design covers both ways.

## Summary

- **The merge hold is a gate, not a re-plan.** While git lists an unmerged path, the daemon records revisions, keys and queues as usual, and starts no tier. The queue keeps the work. When git lists none, the queued work starts in its usual order. No revision is needed, so `git add` ends the hold even though it changes no byte the watcher sees (the ordering problem in `research/issue-68.md`).
- **The unmerged paths cost no new git call per revision.** Each revision already runs `git status --porcelain=v1` for its dirty flag (`readHead`). Its unmerged codes name the paths. While on hold, one stat of the index file per second notices `git add`, `git reset` or an abort. The hold then ends within about a second.
- **No false FAIL, no false recovery.** The conflicted bytes never run. A key that names an unmerged path takes no stored result either, so a FAIL stored for the same conflict earlier is not promoted. Status and the hooks say one line, which names the paths and what ends the hold.
- **The command hold is `squeal hold -- <command>`.** It lasts as long as the command's process does, with a cap of 3 hours. The daemon stays up and records each edit as a revision and queues its work. It cancels the tiers in flight that it can cancel and starts no tier until the command exits. `squeal start` ends a hold early, as it already ends a stop and a stuck handoff.
- **Both holds share one gate, one status line shape and one hook rule.** Three code rows: R1 (the gate and the merge hold), then R2 (what status, hooks and waits say) and R3 (the hold command), side by side.

## Decisions for the human

One recommendation each. The spec text below follows the recommendations.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | What starts and ends the merge hold? | (a) The index only. The hold holds while git lists an unmerged path. The paths come from the `git status` each revision already runs, and also at the daemon's start, at each reconciliation pass, before each tier, and every second while on hold when the index file moved. (b) The index and the bytes. An unmerged path holds only while its bytes have a conflict marker line, so the resolved write resumes the runs before `git add`. (c) Markers only, without the index. | (a). It is exact and has one rule. It resumes the runs about a second after `git add`, with no edit. Option (b) gains only the time between the resolved write and `git add`. It adds a byte heuristic, which `conflict-marker-size` and files that hold marker-like lines on purpose defeat. Section 1. |
| Q2 | What does the merge hold cover? | (a) The whole worktree. No tier starts in any lane. A key that names an unmerged path takes no stored result. A tier in flight runs to its end. (b) Only the files whose keys name an unmerged path, through a closure or a project's environment inputs. Every other file runs as usual. | (a). This is what the approved row and the issue ask for. It does not depend on closures, which are incomplete by construction (C3: `complete: false`). A stopped rebase's tree is transient anyway. Cost: a conflict in a file that no test reads, for example `docs/board.md`, also holds validation until it is resolved. Section 1.5. |
| Q3 | What does the command hold bind to? | (a) The command's process lifetime: `squeal hold [--max <duration>] -- <command>`, capped at 3 hours by default. (b) A time window: `squeal hold --for 90m`. (c) Both forms. (d) A process the agent names: `squeal hold --until-exit <pid>`. | (a). It cannot be forgotten, and it cannot end in the middle of a gate. The cap only guards against a command that hangs. A gate run as separate steps wraps each step. Between steps no gate runs, so validation does not compete with one. Section 3. |
| Q4 | What does the daemon do during a command hold? | (a) It stays up. It watches, records revisions, keys and queues. It cancels the tiers in flight whose runners can cancel, and starts no tier. (b) As (a), and it also closes its runner, as the install wait does (C9). (c) It stops, and the hold is a stopped mark that edits do not clear until the command exits (011-08's mark with a holder). | (a). Status stays true during the hold: revisions advance, and the queued files are listed with the hold as their reason. At the end, the queued work starts at once, with no daemon start and no reconciliation of the whole tree. Not known: how much memory a held daemon keeps on a large repository. R3 measures it. (b) is the step to take if that number matters. Section 3.3. |
| Q5 | What ends a hold early? | (a) `squeal start` ends every command hold of its worktree. No command ends a merge hold. (b) A new `squeal resume` command. | (a). One recovery command for every state in which no test runs: a stop (011-08), a stuck handoff (011-30 Q4 (a)), and a hold. A merge hold is a fact about the tree, not a request, so only git ends it. |
| Q6 | What does a wait do while on hold? | (a) It returns at its first decided read, with the hold as its verdict line, and exits 3. (b) It waits up to its deadline for the hold to end. | (a). Nothing runs until the agent acts, so waiting only spends the deadline. The wait's sync pass reads the index first, so a wait that starts right after `git add` does not report a hold that has already ended. Section 2.3. |

## 1. What starts and ends the merge hold (brief question 1)

### 1.1 Today

A conflicted `git merge` writes the conflicted bytes into the worktree. The watcher sees them, and they become a revision. The importers re-key and run. Each run fails with `Transform failed with 1 error:`, and status and the hook deliver the failures. The write of the resolved bytes is the next revision, and the runs recover. `git add` and `git commit` create no revision. *Verified by experiment* (`research/issue-68.md`, findings 1, 2, 4, 5). Nothing in `src/` reads the unmerged state. *Read in source code* (the same file, finding 6; one comment in `git-index.ts:40`). The watcher ignores the index file, because every `.git` segment is metadata (`isGitMetadata`, `src/core/watcher/paths.ts`), and a linked worktree's index lies outside its root (`<common-dir>/worktrees/<name>/index`). *Read in source code.*

Reporter evidence (issue #68): in cezarion, a helper that 45 test files import held markers for about two minutes. 353 checks went PASS -> FAIL at load 40 to 55, and the hook printed two batches of about 20 failures plus "Not shown: 75 more" and "240 more". All recovered at the next revision.

### 1.2 The signal: unmerged index entries, read from the status each revision already runs

`git status --porcelain=v1` lists an unmerged path with one of seven codes: `DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`. *Read in official docs* (git-status(1), "Short Format"). `readHead` runs exactly that command (`--porcelain=v1 -z --untracked-files=normal --ignore-submodules=all`, `--no-optional-locks`) once for each batch that has changes (`src/core/scheduler/batch.ts:46`, `src/core/revision/reconcile.ts:192`) and at the daemon's start (`bootstrap.ts:79`). Today it keeps only `lines > 0` as the dirty flag. *Read in source code.* So `HeadState` can carry the unmerged paths at no extra cost. This type change is additive.

Every conflicting operation leaves the same entries: merge, rebase, cherry-pick, revert, `stash pop`, `checkout -m`, `apply --3way` and `am -3`. *Read in official docs* (git-merge(1) "How conflicts are presented", git-rebase(1), git-cherry-pick(1), git-stash(1)). `probes/git-unmerged.sh` steps 1 and 4 to 6 check merge, rebase, cherry-pick and `stash pop`. They have not run (probe status above). An operation in progress with no unmerged entry holds nothing. Examples are an interactive rebase stopped at an `edit` step, and `merge --no-commit` with no conflict. In both, the tree is consistent.

### 1.3 The end: an index observation, and the queue keeps the work

A hold that ends only at a revision would wait for an edit after `git add` (`research/issue-68.md`, "For the spec"). The fix is to keep the work instead of re-planning it. The revisions during the hold are recorded, keyed, looked up and queued as at any time (C2, C4 steps 1 to 4). The scheduler only does not start a tier. `#pump` already has this shape for the install wait: `if (this.#awaitingInstall || this.#reinstalled) break;` (`scheduler.ts:588`). *Read in source code.* The resolved write's revision re-keys the conflicted file's importers again, so the queue holds them at the resolved keys. When git lists no unmerged path, the pump runs, and those files start in their usual group: edit, catch-up or backlog (C4 step 4). *Inferred.*

How the daemon sees the index clear without a revision:

- **While on hold**, it stats the index file once a second (path from `git rev-parse --git-path index`, read once at start). When the inode, size or mtime moved, it reads `git ls-files -u -z` again. Git writes `index.lock` and renames it over `index`, so every write moves the inode. *Inferred* from git's lock-file protocol. The probe's step 1 records the stats. Watching size and mtime as well covers an index written in place. An idle hold costs one `stat` per second. This repository's index is 783,032 bytes with 5,773 entries, and `ls-files -u` reads it once.
- **Before each tier and in each sync pass**, the same check runs when the index moved since the daemon's last read. So a wait started after `git add` reads the index before it answers (Q6). *Inferred.*
- **At start and at each reconciliation pass** (every 30 s), the status already run gives the paths. This is the backstop. *Read in source code* (C2, reconciliation pass).

A synthetic revision at `git add` is rejected. A revision records changed paths and their hashes, and C2 says no revision is created by a no-op. The queue already has the work.

What ends the hold, by example. Each is inferred from the rule and checked by R1's tests:

| Action | Bytes | Index | Hold |
| --- | --- | --- | --- |
| Write the resolved file | revision | still unmerged | holds (Q1 (a)) |
| `git add <path>` | none | entry staged | ends at the next index read, about 1 s |
| `git add` with markers still in the file | none | entry staged | ends. The runs fail: the markers are now in the change. That is a real failure. |
| `git merge --abort`, `rebase --abort`, `cherry-pick --abort` | revision (bytes restored) | cleared | ends. The importers' keys return to their stored results, with no run. |
| `git reset` after a `stash pop` conflict | none (markers stay) | cleared | ends. The runs fail on the markers, as above. |
| `git rm <path>` | revision | cleared | ends |
| `git checkout --theirs <path>` | revision | still unmerged | holds until `git add` |

### 1.4 The race at the start: files before the index

`git merge` writes the conflicted files, then commits the index lock (inferred from merge-ort's order: the checkout writes the worktree, then the unmerged entries are written to the index). The probe's `strace` step records the order. If a tier is selected after the files land but before the index lands, the check before the tier finds no unmerged path, and the tier runs the conflicted bytes. The debounce (100 ms of quiet) makes this rare. Two rules close it whatever the order:

1. The check before each tier reads the index again when it moved.
2. When a run is recorded while the hold holds, nothing is stored for a file whose key names an unmerged path. That file stays queued. `#record` already withholds per file for touched paths (`barredByTouch`, task 013-02) and counts repeat withholds toward `unknown` (`#withholds`, task 007-30). *Read in source code.* A hold's withhold counts toward neither limit.

A tier already in flight when the hold begins runs to its end. Its files whose keys name no unmerged path store results as usual, and the completion barrier guards any input that changed (C2, C4). *Inferred.* Cancelling it would discard valid results for files the merge did not touch.

### 1.5 Scope (Q2) and stored results

Under (a), no tier starts anywhere in the worktree. Lookups go on (C4 step 3, and 011-23's read of other worktrees' keys, `stored-keys.ts`). A clean file that the merge brought in can still become current from a stored result. A key that names an unmerged path takes no stored result while the hold holds. Without this rule, a FAIL stored for the same conflicted bytes would be promoted and delivered. Such a FAIL comes from an older release, from another worktree on an older release, or from the same conflict before `merge --abort`. *Inferred.* The file stays queued.

Option (b) would let the rest of a merge validate during the window. Its risk: a test that reads a conflicted file at run time, outside its recorded closure (observed reads off, or a read the recorder cannot see), runs against the markers. That gives the false FAIL and the false recovery that the issue reports. *Inferred from C3 and C12.* The reported window was about two minutes (reporter evidence), so (a) delays the rest of a merge's work by about that much.

### 1.6 The runner part, the key format, other worktrees

- **Runner part.** The refinement (C2, D5 step 5) is not a test run, and it goes on during the hold. The conflicted file fails to parse in Vite's transform, so its importers' closures may lose its imports until the resolved write refines them again. Those keys take no stored result and run nothing (1.5). R1 tests that after resolution each held file's key equals the key a fresh daemon computes at the same bytes. *Inferred, not verified:* how the Vitest adapter's `fetchClosures` treats a parse failure was not read.
- **Key format.** The hold changes what is looked up and what is recorded, but only while it holds. If the check sat inside the store decision or `stability.ts` (011-47 moves the barrier there), the 011-37 comparison would see a changed line on the validity path. A case with an unmerged index would then need a raise. So the checks belong in the scheduler, before it calls the lookup or the store decision. R1's done-when includes `test/keys/key-format.test.ts` passing with no raise. *Read in source code* (C3, the key format bullet; `status.md` 2026-10-20, 011-41).
- **Other worktrees.** The hold is per worktree. Another worktree's daemon validates as usual.

## 2. What status, the hooks and a named wait say (brief question 2)

### 2.1 Status

One line per hold, after the revision line, because it qualifies everything below it. The paths are named as the install wait names workspaces: three, then `and N more` (`awaitingInstallSentence`, `src/core/scheduler/awaiting-install.ts`; `src/core/delivery/header.ts:58`). *Read in source code.* Drafts:

```text
Revision: 5 · 3213a9e7 + 1, dirty
On hold: unresolved merge since 10:01:07, git lists 1 unmerged path (packages/cezar/src/workflows/fixture-cleanup.testkit.ts); no test runs until git lists none. Resolve it and `git add` it, or abort.
Known failures: 0; not current: 45 of 410 test files (45 queued)
...
Outstanding:
  45 test files queued, on hold for the unresolved merge: none of Squeal's commands advances them
```

```text
On hold: `squeal hold` since 10:01:07, for `npm run gate` (pid 4242), until it exits, at most until 13:01:07; edits are recorded and not run. `squeal start` ends the hold.
```

`status --json` adds `holds`: an array of `{ cause: "merge", since, revision, paths, pathCount }` or `{ cause: "command", since, command, pid, until }`. Absent from an older daemon. The change is additive, with no `schemaVersion` raise, as `yields` was added (`status.md` 2026-10-21, 011-51). The merge row is trusted only from a live daemon, written since its start, as `promotions:<worktree>` and `yields:<worktree>` are (C15). The command row is a request, like the stopped mark, and is read as written. Status judges each holder's process (section 3.4) and says `its command is gone; the daemon ends the hold at its next heartbeat` for a holder whose processes are gone.

Wording: the state is "on hold". C5's "held fail" and C6's "the wait holds for" already use "held", and one word means one thing.

### 2.2 The hooks

The hold is told as liveness is (C8: "liveness is told once per change", `liveness-told:<worktree>` per consumer, `src/core/delivery/liveness.ts`). Its start is one line at each consumer's next boundary, and its end is one line. *Read in source code* (the told-liveness slot). Drafts:

```text
SQUEAL · validation on hold at revision 5: git lists 1 unmerged path (packages/cezar/src/workflows/fixture-cleanup.testkit.ts). No test runs until git lists none: resolve it and `git add` it, or abort.
```

```text
SQUEAL · validating again at revision 6: git lists no unmerged path; 45 test files queued.
```

The registration header carries the status line while the hold holds. No FAIL is delivered for the conflicted bytes, because none ran and none was promoted (section 1.5). No recovery follows, because there was no failure. After the hold, transitions are delivered as usual. A file that passed before the merge and passes after it says nothing.

The hooks need no new ensure rule. A daemon on hold is alive, and a daemon that starts while a hold holds starts on hold (section 3.5). Every harness maps the same rule (C8). Codex's `post-tool-use.mjs` was not probed for #68 (`research/issue-68.md`, open questions). R2's end-to-end test covers every hook plugin.

### 2.3 Waits and named files (C6, C15)

- `status --wait` (with or without paths), `status <path>` and `run --all --wait` return at the first read that finds their files on hold. They print the snapshot, then the hold as the verdict line: `On hold: unresolved merge, ...; no verdict`. They exit 3, the code for no verdict. `run --all` still records its request, and the checkpoint runs after the hold.
- The wait's sync pass reads the index when it moved (section 1.3). The sequence `git add x && squeal status --wait 60000` therefore waits for x's importers. It does not report the hold that just ended.
- A named file that a hold keeps queued reads `queued, on hold for the unresolved merge (git lists helper.ts unmerged)` or `queued, on hold for \`npm run gate\` (pid 4242) until it exits`.
- Stop's wait (at most 1.5 s, C6) does not wait while on hold. The idle wake records the pending files as it does today, and their results wake it after the hold.

## 3. The command-bound hold (brief question 3)

### 3.1 The need

Reporter evidence (issue #49, not reproduced at load 28.97): a cezar worker ran a 70-minute gate, one step at a time, at load 40 to 80, with Squeal stopped as the repository asks. Every edit cleared the stopped mark, and the next boundary started a daemon, which revalidated thousands of stale checks beside the gate. That is 011-08's rule: the mark holds until the next edit or `squeal start` (C9). *Read in official docs* (C9). One run died with exit 137 while a restarted daemon also ran. No causal claim is established (`research/issue-49.md`).

### 3.2 Process lifetime against a time window (Q3)

| | Process lifetime (`squeal hold -- cmd`) | Time window (`--for 90m`) |
| --- | --- | --- |
| Ends when the gate ends | yes | no: too early (validation returns mid-gate) or too late (it stays off after the gate) |
| Forgotten | cannot be | holds until expiry |
| A gate run as separate steps | wrap each step; between steps validation runs, but no gate competes then | one window |
| Crash of the command | ends the hold at once | no effect |
| What the agent must know | the command | the gate's duration in advance |

*Inferred.* The window's one advantage is a gate run as many small steps. The cost of wrapping each step is that validation starts between steps and is cancelled at the next one: at most about 2 s of runner cancel per step (section 3.3). The issue's example `squeal stop --until-exit <pid>` (Q3 (d)) binds to the life of a process too. It needs the agent to find a pid, and it puts a hold under `stop`, whose daemon exits. The wrapper gives the same binding with no pid to find.

### 3.3 What the daemon does (Q4)

At `squeal hold`, the daemon starts no tier and cancels each tier in flight whose runner cancels: Vitest, fast and slow. It re-queues their unfinished files as the supersession cancel does (C4 step 5, row 011-51; the tier's `cancel`, `scheduler.ts:118`). A node:test or pytest slot in flight finishes its one file, and no slot starts after it (C10: "at most until the holder's next slot ends"). `#cancelTiers` cannot be reused: it is terminal, because it sets `#stopRequested` and closes the loop (`daemon.ts:695`). *Read in source code.* R3 adds a cancel that leaves the scheduler open. The wrapper waits for the cancel, at most 3 s (the Vitest cancel is forced after 1 s, `tasks/011-30/design.md` section 1; `CANCEL_GRACE_MS` is 2 s, `daemon.ts:69`), then starts the command, so the gate starts with the CPU free.

During the hold, the watcher, revisions, keys, lookups and the runner part go on. The only CPU cost is the debounce, re-hashing and refinement of each edit, plus the 30 s reconciliation pass. The memory of the daemon process and its Vitest instance stays. Its test workers are not running. How much memory that is on a large repository is not known (section "What is not known").

### 3.4 Expiry, explicit resume, crashes

The hold row is `command-hold:<worktree>` in `meta`, so it outlives any one process. It holds one entry per `squeal hold`: a random token, the start time, `until`, the command's text, and two process identities, the wrapper's and the command's. Each identity is `(pid, /proc/<pid>/stat start time, PID namespace)`, read as a harness process is (`readProcStat`, `src/core/delivery/harness-process.ts`; C8). *Read in source code.* A holder holds while either of its processes lives.

| Event | What happens |
| --- | --- |
| The command exits, with any code or signal | The wrapper removes its entry. If it was the last, it asks the daemon to resume. It exits with the command's code, or `128 + n` for signal `n`. |
| The wrapper is killed (SIGKILL, OOM), and the command lives on | The entry stays. At each heartbeat (5 s), the daemon finds the wrapper gone and the command alive, so the hold holds. When the command ends, the next heartbeat removes the entry and writes one note. |
| Both processes are gone without a clean exit | Removed at the next heartbeat. With no daemon, the next daemon's start removes it. |
| The daemon dies or steps down during the hold | The next daemon reads the row at its start, before the baseline queues anything. It starts on hold while a holder lives (011-30's handoff carries the queue; C4). |
| A PID is reused | A different start time means the process is gone. A process in another PID namespace is not judged, as C8 rules for harness processes, and only `until` ends its hold. |
| `until` passes (default 3 hours, `--max <duration>`) | The daemon removes the entry with one note: `the hold for \`npm run gate\` (pid 4242) passed its 3 h bound; validating again`. The command keeps running. Its later exit finds no entry and does nothing. |
| `squeal start` | Removes every entry and says which commands still run. The commands keep running. |
| `squeal stop` during a hold | The daemon stops and leaves the stopped mark (011-08). The hold row stays. The two states are independent: an edit clears the mark, and the daemon that starts then starts on hold. |
| Two `squeal hold` at once | Two entries. The hold ends when the last one goes. |
| macOS (no `/proc`) | Only the wrapper's removal, `squeal start` and `until` end a hold. Not verified on macOS, as nothing in C8's process rule is. |
| No store (Squeal never ran here) | The command runs. One line says nothing is on hold, because no daemon has run here. A store is not created for a hold. |

3 hours is about two and a half times the reported gate (70 minutes at load 40 to 80; reporter evidence). The bound guards against a command that hangs, not against a slow gate. No policy key is proposed. The flag is enough until a project needs a different default.

### 3.5 How it differs from `squeal stop`

| | `squeal stop` (011-08) | `squeal hold -- cmd` |
| --- | --- | --- |
| Daemon | exits; its test processes are stopped (D12) | stays; tiers it can cancel are cancelled and re-queued |
| Edits meanwhile | the first one clears the mark, and a boundary starts a daemon | recorded as revisions and queued; nothing runs |
| Ends | the next edit, or `squeal start` | the command's exit, `until`, or `squeal start` |
| Status | `no daemon running`; the daemon is stopped by request | revisions advance; queued files are listed with the hold as their reason |
| Hooks | ensure no daemon while the mark holds | no change: a daemon on hold is alive |
| Resume cost | daemon start, reconciliation, Vitest instance | none: the queued work starts |
| Use | before deleting a worktree; to free the memory | a long gate during which the agent keeps editing |

A hold is no request and no activity for the idle and unused periods (C9). The edits made during it count as activity, as they do today. A departure while on hold drains nothing, since nothing may start. The daemon exits at the departure grace, and the next daemon takes the queue. *Inferred, from C9's drain rule.*

## 4. The code rows (brief question 4)

R1 comes first. R2 and R3 own disjoint files and can then run side by side. R1 defines both rows' types and their readers, so R2 words both causes, and R3 writes the command row. Each row's done-when lists its tests. Red before, green after. Each row ends with `npm run lint`, `npm run typecheck` and `squeal run --all --wait` passing.

**R1. The merge hold and the gate (gh-68).** Seams: `readHead` in `src/core/daemon-loop/head.ts` (it parses the unmerged codes; `HeadState.unmerged`, additive); a new `src/core/scheduler/hold.ts` (the hold's state, the index stat, the `merge-hold:<worktree>` row, and the types and readers of both rows); `scheduler.ts` (`#pump` gates on the hold beside `#awaitingInstall`; `#record` withholds per section 1.4); the lookups of `keying.ts` and `stored-keys.ts` (section 1.5); the sync pass and reconciliation in `src/core/daemon-loop/`; `WORKTREE_META_ROWS` (`mergeHold`, `commandHold`). Owns those and their tests. Not R1's: `src/core/status/`, `src/core/delivery/`, `src/cli/`, `src/core/daemon/`, `stability.ts` and the store decision. Done when, with a real git repository and a fake runner:

1. A conflicted `git merge` records a revision that re-keys both importers. No tier starts. The row lists `helper.ts`.
2. Write then stage: the resolved write records a revision and starts no tier. `git add` alone, with no write, makes both importers run within 2 s at the resolved bytes' keys, and records no new revision. Each key equals the key a fresh daemon computes at those bytes.
3. `git add` of the conflicted bytes ends the hold. Both importers run and store FAIL.
4. `git merge --abort` ends the hold. Both importers take their stored passes, with no run.
5. Rebase, cherry-pick and `stash pop` conflicts hold. After `stash pop`, `git reset` ends the hold.
6. The race: a tier forced past the check runs the conflicted bytes. Nothing is stored for the importers. They stay queued, and no `unknown` follows a second such withhold.
7. A FAIL stored beforehand at a conflicted key, by this worktree and by another, is not promoted while the hold holds.
8. A tier in flight at the hold's start finishes. Its files whose keys name no unmerged path store results.
9. A second worktree's daemon runs its edit during the first's hold.
10. `test/keys/key-format.test.ts` passes with no raise.

**R2. What status, the hooks and waits say (C6, C8, C15).** Seams: `src/core/status/` (`snapshot.ts`, `format-status.ts`, `standing.ts`), `src/core/types/standing.ts`, `src/core/delivery/` (`header.ts`, `liveness.ts`), `src/cli/status-wait*.ts`, `verdict.ts`, `named-*.ts`, Stop's wait in `src/harness/shared/`. Owns those, their tests, and `test/e2e/merge-hold.test.ts`, which turns `research/probes/issue-68/run.sh` into a test. Not R2's: R1's and R3's files. Done when:

1. During a merge hold, plain status prints one `On hold:` line after the revision line, naming at most three paths and `and N more`. `--json` has `holds` with all paths up to 50 and `pathCount`. No `FAIL` line names an importer.
2. During a command hold (its row written by the test), status names the command, the pid and `until`, and says `squeal start` ends the hold. A holder whose processes are gone reads `its command is gone`.
3. A boundary after the hold starts delivers one line and no FAIL. The next boundary delivers nothing. The end delivers one `validating again` line. Files that passed before and after deliver nothing.
4. `status --wait`, a named wait and `run --all --wait`, started on hold, return within one poll with the hold as their verdict line and exit 3. `git add x && squeal status --wait` waits for x's importers instead.
5. Stop's wait returns at once on hold.
6. A merge row from a dead daemon, or written before the live one started, is not shown.
7. Every hook plugin, through `test/e2e/plugins.ts`: one line on hold, no FAIL.

**R3. The hold command (gh-49).** Seams: `src/cli/hold.ts` (new), `main.ts` (the command table and `--help`), `start.ts` (it ends command holds), `src/core/daemon/` (`protocol.ts` `hold` and `resume`, `handlers.ts`, `daemon.ts`: the cancel that leaves the scheduler open, and the holder check at heartbeat and at start), `src/core/scheduler/` (the cancel), the command row's writer, and `commands.md` in every plugin copy. Owns those and their tests. Not R3's: R2's files. The primer is 005's and is unchanged. Done when:

1. `squeal hold -- <a 3 s command>`, started while a Vitest tier runs, cancels the tier within 2 s, and its files stay queued. An edit during the command records a revision and starts no tier. When the command exits, the queued files run. The wrapper exits 0, 7 and 143 for a command that exits 0, exits 7, and is killed by SIGTERM.
2. SIGKILL of the wrapper while the command runs: the hold holds until the command exits, and ends within one heartbeat after.
3. SIGKILL of the daemon during a hold: the daemon started next starts on hold and resumes at the command's exit.
4. `--max 2s` with a 5 s command: the hold ends at 2 s with one note. The command's exit changes nothing.
5. `squeal start` ends the hold, and the command keeps running. `squeal stop` during a hold leaves the mark and the row. The daemon started by the next edit starts on hold.
6. Two holds: the hold ends when the second command exits.
7. A holder with a reused PID (another start time) is removed at the next heartbeat.
8. Measured and noted in the row's notes: the RSS of a held daemon on the largest worktree available, against the same daemon idle and not on hold.

## Spec text (drafts, for the amendments)

**C9, a new paragraph after the stopped mark's:**

> **Holds** (amended 2026-10-2x, the human, row 011-61, gh-68 and gh-49, `tasks/011-61/design.md`). A worktree's validation is on hold for two causes, independent of each other and of a stop: an unresolved merge and a hold command. While either holds, no tier starts in any lane of the worktree, slow and backlog included. The daemon goes on recording revisions, keying, looking up and queueing (C2, C4), so the work an edit made waits in the queue. When the last hold ends, that work starts in its usual order, with no further edit. A hold is no request and no activity for the idle and unused periods. A departure while on hold drains nothing, and the next daemon takes the queue (C4). A daemon starts on hold when either cause holds at its start.
>
> *Unresolved merge.* The worktree is on hold while git lists an unmerged path (`git ls-files -u`), whatever operation left it. The daemon reads the unmerged paths from the `git status` each revision runs (C2), at its start and at each reconciliation pass. It reads them again before a tier and in each sync pass when the index file's inode, size or mtime moved since its last read. While on hold, it stats the index file every second and reads them again when it moved, so `git add`, `git rm`, `git reset` or an abort ends the hold within about a second, without a revision. A tier in flight when the hold begins runs to its end. While the hold holds, a key that names an unmerged path, through its closure or its project's environment inputs, takes no stored result, from this worktree or from other worktrees' keys (C4 step 3). A run recorded then stores nothing for that key. The file stays queued, and that withhold counts toward no withhold limit. These checks run in the scheduler before the lookup and the store decision, never on the validity path (C3). The daemon publishes the hold as `merge-hold:<worktree>` in `meta`, `{ v: 1, since, revision, paths, count }`, with the first 50 paths in git's order. The row is trusted as `promotions:<worktree>` is (C15) and removed when the hold ends.
>
> *Hold command.* `squeal hold [--max <duration>] -- <command> [args...]` puts the current directory's worktree on hold for the life of the command, and exits with the command's exit code, or `128 + n` for signal `n`. It adds an entry to `command-hold:<worktree>` in `meta`. The entry holds a random token, its start, `until` (the start plus `--max`, by default 3 hours), the command's text, and its own process and the command's, each as a harness process is recorded (C8). It asks the daemon to hold, waits at most 3 s for the tiers in flight to be cancelled, then runs the command with the inherited stdio and forwards SIGINT, SIGTERM and SIGHUP to it. The daemon cancels each tier in flight whose runner cancels and re-queues its unfinished files, as C4 step 5's supersession cancel does. A node:test or pytest slot in flight finishes its file, and none starts after it. When the command exits, the wrapper removes its entry. The removal of the last entry ends the hold, and the wrapper asks the daemon to resume. At its start and at each heartbeat, the daemon removes, with one note, each entry whose two processes are both gone (judged as a harness process is, C8) or whose `until` has passed. `squeal start` ends every command hold of its worktree, as it clears a stopped mark. An edit does not end a hold. `squeal stop` stops the daemon and leaves the hold as it is. Without a store, `squeal hold` runs the command and says that nothing is on hold.

**C2, appended to the revision paragraph:** The `git status` a revision runs for its dirty flag also gives the worktree's unmerged paths (codes `DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`), for the merge hold (C9).

**C6, a new amendment:**

> Amended 2026-10-2x (the human, row 011-61): while the worktree is on hold (C9), status prints one `On hold:` line per cause after the revision line, naming at most three paths and `and N more`, and what ends the hold. `Outstanding:` names the hold as the group of the files it keeps queued. `status --json` adds `holds`, an array of `{ cause: "merge", since, revision, paths, pathCount }` or `{ cause: "command", since, command, pid, until }`, which is additive. A wait (`status --wait` with or without paths, `status <path>`, `run --all --wait`) that finds its files on hold returns at that read, with the hold as its verdict line, and exits 3. Its sync pass reads the index first. Stop's wait does not wait while on hold.

**C8, appended to the behavioural layer:** a hold's start and end are told as liveness is, once per change and in one line each, and the registration header carries the status line (C6). The ensure rule is unchanged: a daemon on hold is alive.

**C15, appended to the reasons:** a file a hold keeps queued reads `queued, on hold for the unresolved merge (git lists <paths> unmerged)` or ``queued, on hold for `<command>` (pid N) until it exits``.

## Rejected options

- **Conflict markers alone as the signal (Q1 (c)).** These would hold files that contain marker-like lines on purpose, for example tests of merge tooling and documents that show a conflict. They would miss modify/delete and binary conflicts, which have no markers. They break under the `conflict-marker-size` attribute. `diff3` and `zdiff3` add a `|||||||` line. *Read in official docs* (git-merge(1), "How conflicts are presented"; `probes/git-unmerged.sh` step 7 checks it).
- **Markers to end the hold early (Q1 (b)).** This gains the time between the resolved write and `git add`. It costs a byte scan and the heuristic above, and it still needs the index read for `git add` of marker-like content and for `git reset`.
- **A hold while an operation is in progress** (`MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD`, `rebase-merge/`). An `edit` stop of an interactive rebase and `merge --no-commit` without a conflict would hold a consistent tree. `stash pop` leaves no such file.
- **Watching the index through the watcher.** `.git` is excluded at watch time (C2), and a linked worktree's index lies outside its root. One stat a second, only while on hold, costs less.
- **A revision at `git add`.** C2 creates a revision only for changed bytes, and the queue already has the work.
- **A hook that asks for an index check after `git add`.** This couples the hold to one harness's tool events, and it misses a `git add` typed in a terminal.
- **Running the files that no unmerged path reaches (Q2 (b)).** Section 1.5.
- **Cancelling the tier in flight at a merge hold's start.** It would discard valid results for files the merge did not touch. The record rule (section 1.4) covers the rest.
- **A time window (`squeal hold --for`, `squeal pause --for 90m`) and `squeal stop --until-exit <pid>` (Q3 (b) to (d)).** Section 3.2.
- **A hold bound to the session.** It outlives the gate by the rest of the session, and it binds the hold to one harness's session identity.
- **A stopped daemon as the hold (Q4 (c)).** Status would lose the revisions made during the gate, and the end would pay a daemon start and a reconciliation. It keeps a second meaning of the stopped mark.
- **`squeal resume` (Q5 (b)).** A new verb for what `squeal start` already means in the other states in which no test runs.
- **No cap on a command hold.** A hung command would hold the worktree for the next session too. The 12-hour consumer expiry (C9) is the precedent for a backstop.
- **An override that runs tests during a merge hold.** The agent can run the runner itself. A Squeal result on conflicted bytes is the noise #68 reports.

## What is not known

- **Git's write order in `git merge`** (files before the index): inferred, not probed (load). Section 1.4's two rules cover both orders.
- **The porcelain codes and the index's inode change for each operation** (merge, rebase, cherry-pick, `stash pop`, reset, abort): read in git's docs, not probed here. `probes/git-unmerged.sh` checks them when the load allows.
- **The cost at the reported scale** (353 checks, 45 importers, load 40 to 55) of today's behaviour and of the hold. The fixture had 4 checks (`research/issue-68.md`, Q7).
- **How the Vitest runner part refines a closure through a file that fails to parse** (section 1.6). R1's test 2 catches a key that differs from a fresh daemon's.
- **The memory a held daemon keeps** on a large repository (Q4). R3's test 8 measures it.
- **Codex, OpenCode and Pi hooks** were not probed for #68. C8 maps one contract, and R2's end-to-end test covers every plugin.
- **Whether #49's exit 137 was memory pressure** from the restarted daemon: reporter evidence, not reproduced (`research/issue-49.md`).
