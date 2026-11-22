# 023-56 notes: how round 7 ran

Row 023-56, wave 29, 2026-11-22. The results go to `../../lessons.md`, "Round 7 (023-56)". These notes are the residue: what changed from round 6's harness, where it ran, and where the data is.

## Scripts (`bin/`)

Round 6's scripts (`../023-44/bin/`, described in `../023-44/notes.md`), changed only where listed.

| Script | Change from round 6 |
|---|---|
| `deploy.sh` | Hub entry `7e42195` ("squeal 0.1.599"), `install.sh` from `squeal--v0.1.599`; scratch `t/<id8>/w29`. `LAB` is the ssh target, never written down. |
| `setup.sh`, `as-user.mjs`, `session.mjs`, `batch.mjs` | User `squeal-w29`, case root `~squeal-w29/runs/w29`, Node under `/opt/squeal-w29`. No other change. |
| `summarize.mjs` | Adds `estimates`: each line an `--at` call printed with a time estimate ("about N min"), with the call's second, for V2. |
| `results.mjs`, `prompts.json` | Unchanged (`prompts.json` checked with `cmp` against round 6's). |

Claude Code stays at 2.1.327, as in rounds 4 to 6, so the agent side does not change between rounds.

## Where it ran

The lab VM, which the human allowed for this round ("Lab VM", 2026-11-22). At 22:41Z the 1-minute load was 0.00, no other user job ran, no throwaway user from an earlier round was left, and `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` were present by name in the login shell. Order: setup; the `dryat` check (`data/dry-at.txt`, its tail only); s1-01 alone as a trial (147 s); then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, s1 and s2 interleaved), 22:48Z to 23:34Z. Teardown at 23:38Z.

## Data (`data/`)

- `judgements.tsv`: per session, round 6's columns plus one per fix under test: V1 (the symlink files), V2 (the estimate quoted and what was measured), V3 (named folder or file at the commit), V4/V8 (a narrowed count read as the whole answer), V6 ("still running" after a failed setup).
- `summary.tsv`: as round 6's, plus `estimates`.
- `<id>/`: `timeline.txt`, `summary.json`, `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`.
- `batch.log`; `dry-at.txt`.

The streams and transcripts were deleted with the work folder. The `git show` lines that named the commit's author read `Author: [redacted]`; home paths read `~squeal-w29`.

## Things worth knowing next time

- In s1 the change selects 110 files at the parent: 13 unit files and 97 browser files; the working tree adds the new test file (111). All 13 unit files are on both sides within about 200 s, so "all 13 compared" is the most the store can give on this VM without Chrome.
- In s2 the named file `test/store/open.test.ts` is often already running at the commit when the agent narrows to it: it sits in the commit daemon's first batch of about 65 files (the pending count drops from 1,337 to 1,272 when that batch ends). Its result then comes when that batch ends, about 250 to 420 s after the first call, whatever the narrowing. In s2-02, 04 and 07 the narrowed call answered in 9 to 20 s.
- Unchanged files are not listed by name in a report, only counted. To tell which earlier "still running" files now have both sides, compare the counts: s1's 9 selected lint files are `ast-rules-owners`, `lint-ast-grep-1`, `lint-ast-grep-2`, `lint-runner`, `plugin`, `run-history-reader`, `ast-grep-groups`, `ast-rules-active-run` and one more.
- `squeal ps` lists every daemon of the OS user, so the pending counts in `commit-left.txt` include other sessions' commit daemons. Count a session's own commit daemon from `meta.commitStop`.
- `deploy.sh fetch` must run from `023-56/bin`; the round 6 copy fetches into the `w27` scratch.
