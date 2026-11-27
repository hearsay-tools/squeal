# Spec 026 Wave 15: the remote cluster (rows `026-38`, `026-39`, `026-40`; `026-41` needs no code)

Approved by the human, 2026-11-27 (session bca5dbc3). Two workers on disjoint seams. Row `026-41` (#289) has no code: it closes with `026-38`'s release.

## W1: rows `026-38` (#304), then `026-40` (#300). Shape: **slice**, then **repair**. Use /worker.

Spec: D8, D10, D12; spec 021 D10, D11, D13; spec 011 C4/D4 (what keys keep from ignored observations). Research: `research/issue-304.md`, `research/issue-300.md`, with their probes under `research/probes/issue-304/` and `issue-300/` (reuse them as test leads).

**026-38 outcome.** Remote proof drops exactly what the result key drops, and a file that exists only on the remote is refused at once.

1. `src/core/runner-host/host.ts` (about line 298) proves the raw `report.observed[].paths`. Apply the same filter the key applies: `RuntimeFiles.effective` for the reader (`src/core/keys/runtime-files.ts`, `scheduler/keying.ts:effectiveObserved`) and the written-directory bound (`scheduler/observed.ts`). Lead: carry `runtimeFiles` in `HostPolicy`; one owner of the filter, not a copy.
2. `lane-proof.ts:classify`: a path absent locally that is not in the remote tree's synced-file ledger (`tree-host.ts` `files`) is unsyncable. Refuse with no resend; the message names the path and the two fixes (`runtimeFiles` for runtime state, `remote.alwaysLocal`). A path that was synced and then deleted locally still repairs on the resend.
3. A real ignored input (present locally, kept by the key) stays proven, as today.

The human is asked about files the remote run itself creates and then reads (Squawk's `.ai/qa/build/**` built on the VM by the test environment). Build the refusal above; the coordinator relays the answer by steer if it adds anything.

**026-40 outcome.** After a merge or a new helper, remote validation recovers or refuses once with the paths named.

1. First reproduce with a real Vitest runner over the fake SSH helper: merge-updated fixtures and a new helper file. Record local and remote blob ids, tree membership and invalidations in the notes. Fix the cause you find.
2. `lane.ts` (about line 735) refuses on a config/setup difference with no resend; `lane-compare.ts` repairs installed dependencies only. A difference in syncable file content gets the same single resend and re-compare as a proof difference.
3. A persistent difference refuses once, names the paths and the recovery in `squeal status`; unrun files stay unknown. Do not add local fallback under `whenLost: "not-run"` unless the coordinator steers it.

**Owns:** `src/core/runner-host/host.ts`, `src/core/runner-host/remote/lane*.ts`, `tree.ts`, `tree-host.ts`, `connect.ts`, `src/core/keys/runtime-files.ts`, `src/core/keys/environment-descriptor.ts`, their tests under `test/runner-host/` and `test/keys/`. Leave alone: `remote/providers/agent37/**` (W2). Do not run `pnpm run build`.

**Done when:** regressions for remote-only runtime file, screenshot under a written directory, remote-only unsynced file (one remote run, named refusal), synced-then-deleted file (repairs), real ignored input (still refused or proven as today), each under `whenLost` `"not-run"` and the default; config drift resent and recovered; merge and helper cases validated; persistent drift refused once with paths. Two commits, one per row. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No key-format change. Benchmark cells: none (no store, daemon, scheduler, hook or delivery path).

## W2: row `026-39` (#303). Shape: **slice**. Use /worker.

Spec: D7.3, D8.4; spec 021 D19. Research: `research/issue-303.md` and `probes/issue-303/` (its probe is the test lead).

**Outcome.** The remote Git index matches the local staged index after `git mv`, before and after the commit.

1. `src/core/runner-host/remote/providers/agent37/bootstrap.ts`: `localGitState`/`gitStateOf` key HEAD, branch and tags only. Add the index (lead: a hash of `git ls-files -s` output, or of `git write-tree` when it succeeds).
2. `SYNC_SCRIPT` resets the index to HEAD. After that, apply the local staged differences (`git diff --cached` from HEAD) so the remote index equals the local one. `machine.ts`'s `gitKeeper` then syncs on an index change.
3. Check the `ssh` and `command` providers for the same gap; fix it if they sync Git, or say why not in the notes.
4. Bounded diagnosis, at most about 30 minutes: why the reported stale `ENOENT` stayed current after the commit (`squeal run tests <file>` said "current; none runs again"). Notes only; a key change is a new row, not this one.

**Owns:** `src/core/runner-host/remote/providers/agent37/**` and other providers' Git sync, `test/runner-host/remote/providers/**`. Leave alone: `lane*.ts`, `tree*.ts`, `host.ts`, `connect.ts` (W1). Do not run `pnpm run build`.

**Done when:** a test with real Git: after `git mv` the remote `git ls-files --cached` equals the local one; after the commit it still does; an unchanged index makes no SSH call; the existing `agent37-git-sync.test.ts` cases pass. Notes give the post-commit diagnosis. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. Benchmark cells: none.

## Review

One `/reviewer` (`codex`, `gpt-6.1-sol`, `high`) on the exact `cand/<version>` SHA, rows `026-38`, `026-39`, `026-40`, findings in `reviews/<version>.md`.
