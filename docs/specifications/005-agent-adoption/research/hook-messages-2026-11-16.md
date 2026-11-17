# What Squeal tells agents at session start and after tool calls, 2026-11-16

Source: the review the human asked of coordinator 4d2ecbfc on 2026-11-16. Rows 005-89 to 005-94 come from it (the human, 2026-11-16: "All six, A to F").

## Method

- Code read: `src/harness/shared/primer.ts`, `src/harness/shared/deliver.ts`, `src/core/delivery/format.ts`, `header.ts`, `provenance.ts`, `code-format.ts`, `src/core/status/feed-late.ts`, at main `870cc16a7`.
- Real messages: two Haiku subagents scanned the Claude Code transcripts under `~/.claude/projects/` modified in the 4 days to 2026-11-16, for this repository and for cezar (Squawk). They counted each hook message once, from its `hook_additional_context` entry. The coordinator counted the message titles and the figures marked "recounted" again from the extracted messages.
- Limits: Claude Code only (no Codex, Pi or OpenCode sample). The 4 days mix several Squeal versions. A hand run "after" a message is a position in the transcript, not a proven cause. The agent quotes were not checked one by one. The extracted data was in the task's scratch directory and is not kept.
- The transcripts name the tool-boundary hook `PostToolBatch`.

## Volume

| | Squeal | cezar |
|---|---|---|
| Transcripts scanned | 2,512 | 3,713 |
| SessionStart messages | 2,370 | 409 |
| SessionStart size, median / p90 / max (characters) | 1,727 / 1,958 / 9,671 | 2,580 / 3,457 / 9,847 |
| PostToolBatch messages | 1,017 | 1,081 |
| PostToolBatch size, median / p90 / max | 587 / 1,865 / 9,902 | 551 / 2,216 / 9,794 |
| PostToolBatch per session, median / max | 5 / 78 | 3 / 45 |
| Transcripts with a direct `vitest`, `pnpm test` or `npm test` | 114 | 157 |
| Transcripts with `squeal status --wait` | 117 | 106 |

PostToolBatch messages by title (recounted, both projects, 2,098):

| Kind | Squeal | cezar | Share |
|---|---|---|---|
| `N check(s) changed` | 493 | 145 | 30% |
| `SQUEAL · revision N` only | 184 | 375 | 27% |
| heartbeat late, or current again | 118 | 201 | 15% |
| `registered at revision N` with the whole primer | 57 | 130 | 9% |
| no daemon, stopped by request, stopped until start | 43 | 107 | 7% |
| complexity, lint, code, holds, other | the rest | the rest | 12% |

## Findings

### Session start

1. **The primer over its cap loses the CLI name and the path wait.** `folded` returns the last fold tried when no fold fits `PRIMER_CAP_CHARS` (1,500). In cezar the primer is 1,611 to 1,655 characters (check groups plus slow sentences; recounted: 408 of 409), so every session reads "`status --wait 60000` on the CLI SQUEAL messages name" and "the CLI's `run browser`"; none names `squeal status --wait 60000 <path>...`. 258 of the 409 carry both slow sentences beside "with 0 slow test files at the daemon's last listing".
2. **A worktree with no listing reads as all clear.** "Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. The daemon has not listed this worktree's test files yet; these counts are not complete. … Known failures: 0; the daemon has not listed this worktree's test files yet" (213 cezar messages carry the zeros). The primer then permits a hand run "when results are unknown". `../../011-core/research/hand-runs-2026-11-16.md` item 1: 84 of 254 hand-run commands followed a "has not listed" message.
3. **The full-suite checkpoint sentence** is in every registration; it names `squeal run --all`, which this host's rules forbid for routine work, and a starting agent does not act on it. "Inherited: …" and "Imported: …" are the same kind.
4. **Words with no definition.** The primer defines a revision only. Not defined: check beside tests and "test files loaded", "test files without checks", current, stale, "lookup-only", "re-keyed", "closure", and "· c99d5246 + 3, dirty". Example: "4400 unknown (3932 tests, 468 test files loaded)" beside "not current: 468 of 468 test files (468 unknown), 3932 tests (3932 unknown)".
5. **Every session pays.** 2,041 of this repository's 2,370 SessionStart messages went to sessions in the main checkout, many of them short helper sessions; one task-naming session answered about the stopped daemon.
6. **Another tool's files as the change.** "dirty (changed .ai/squawk/legacy-runs.json …)" in 344 messages. Whether those files are git-ignored was not checked.

### After tool calls

7. **Heartbeat notices.** 319 of 2,098 messages. In this repository's sample the late heartbeat was 14 s old at the median and under 30 s in 63 of 68; "validating again" followed 31 s later at the median (57 pairs).
8. **The news header counts the whole worktree's queue**: "8551 pending (8089 tests, 462 test files loaded). Test files without checks: 100 pending." Agents cite it for a hand run ("Squeal still has a long backlog, so I'll run the affected test files directly").
9. **Group lines repeat.** The `browser:` line (two sentences) is in 346 of 1,081 cezar PostToolBatch messages; `groupTiersChanged` holds whenever a count moves.
10. **`SQUEAL · revision N`** titles 559 messages whose content is the first-edit line, the owed counts, a group line or a commit line.
11. **A registration at a tool boundary carries the whole primer**: 187 messages. Cause not determined (an expired registration, or a subagent).
12. **Failure blocks** are the strongest part: failures first, equal errors grouped, error, location, one `why` command. Repeated per block: "its closure reads files changed here since this session started: …" (12 times with the same paths in one message); at registration about 390 characters of "No pass at these inputs is on record before this failure: … `squeal retry … --reason load` …" per failure (11 times in one message). "first observed: FAIL; no baseline result, may predate your edits" is in 160 messages and does not say what the agent should conclude.
13. **Smaller wording.** "passing results stay silent" beside 426 `FAIL -> PASS` messages; "it has not read edits made after 01:16:30" has no zone and no next step; "All 2 test files your edits since revision 4 re-keyed are current" needs "re-keyed" and "current" decoded and does not say that nothing failed; "Lint: off: the oxlint run failed 3 times" (4) beside "Lint: unknown: the oxlint run failed N times" (13), which may be a version difference.

### Not present

- No message says when results are expected.
- No message says, in plain words, that an edit's tests all ran with no new failure. Decided 2026-11-16 (the human): not pushed after each edit; pushed once after a late notice, and pulled otherwise (`../status.md`, row 005-93).

## The test for each sentence (the human, 2026-11-16)

A hook message is for the agent in the session. A sentence stays in a hook when the agent can act on it; a sentence that explains Squeal to the person who runs it is debugging information and moves to a place read on request (`squeal status --full`, a log).

| For the agent | For the person, on request |
|---|---|
| A failure, its error and location, the command for its output | Inherited and imported counts |
| Whether the tests its own edits affect have run, and the result | The full-suite checkpoint's history |
| That Squeal has no results yet, or does not validate, and the next step | The whole worktree's queue and its split into tests and test files |
| What Squeal does not cover | Heartbeat times, a short delay and its recovery |
| The one wait command, the retry command | "lookup-only" baseline, "test files without checks", commit and "+ N, dirty" detail |
| A group that the agent must start itself, once | Complexity and lint counting progress |

Not decided here: whether a log beside `status --full` is needed; no row adds one.

## Left without a row

| Finding | Reason |
|---|---|
| A short primer for helper sessions (5) | The hook cannot tell a helper session from a working one; 005-94 shortens the registration for all. |
| An expected wait time | An estimate under load would often be wrong; 005-93 gives progress without one. |
| `.ai/squawk` paths (6) | Cheaper on the Squawk side; not checked. |
| `Lint: off` beside `Lint: unknown` (13) | 17 messages across versions; check the current code first. |
| The complexity line at registration | One accurate line with its command; no evidence of harm. |
