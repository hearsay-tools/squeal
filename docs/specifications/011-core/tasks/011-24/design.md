# 011-24: status organized around the verdict, a design for the human

Board row 011-24, a docs-only design draft (brief `brief.md`). Approved by the human on 2026-10-20 as the design row for digest groups A and B (`docs/triage/2026-10-20-digest.md`): gh-42, gh-44, gh-45, with gh-38, gh-40, the guidance of gh-39, gh-41 and gh-43, and gh-46's single-file retry hint folded in. The direction is the human's of 2026-10-19 at the end of `research/issue-44.md`: shorter, better organized status, notes behind a flag, verdict, outstanding work and actionable failures first, provenance and uncertainty kept.

Nothing here is in `spec.md` until the human accepts it. On acceptance, the three amendments in "Spec text" below go into 011 C6, 011 C15 and 005 D2 (and one sentence into C5 if question 3 is answered with option 1), `status.md` gets a dated line, and the code rows in section 5 are numbered on the board. They run after 011-22 lands.

Sources: `research/issue-{38,39,40,41,42,43,44,45}.md`, `../004-slow-suites/research/issue-46.md`, 011 C4, C5, C6, C15 and `status.md`, 005 D2 and D6, board row 011-10. Before-samples are rendered by today's formatters (0.1.224, `26975590`) on seeded snapshots: `scratch/before.mjs`, output `scratch/before.md`, method in `scratch/README.md`. After-samples are derived by hand from the same seeds, since their formatters do not exist yet.

## Summary

- `squeal status` keeps the vision's head (revision, known failures, affected checks, checkpoint), adds to the `Known failures:` line what is not current, in test files and tests, and replaces the idle, discovery, retry and "without a result" lines with one `Outstanding:` block, one line per group of files, each naming the command that advances it or saying none does. Worktree, daemon, inheritance, the per-file list and notes move behind `--full`; `--notes` keeps its meaning and implies `--full`. Default length on gh-44's worktree: 7 lines instead of 36.
- A named wait prints the revision line, the selection, the selected failures, the class lines (now with each group's next step) and last its verdict. The worktree's status prints only with `--full`. gh-44's wait: 3 lines instead of 39.
- `squeal status <path>...` without `--wait` answers with the same lines once, worded as a snapshot (gh-42).
- The same not-current clause rides on the registration header's and Stop's `Known failures:` line and on every wait's verdict line, and `status --json` gains `testFileCounts`, `testFilesByPhase` and `outstanding` (gh-45).
- Every selected file without a verdict names what advances it: `squeal retry <file>` for stale, never-run and timed-out files, `squeal run --slow` for slow ones (as today), the tier or claim it waits for and that no command runs it sooner, the base directory of an unmatched path, and a running slow file's single-file retry (gh-38, gh-39, gh-40, gh-41, gh-43, gh-46).
- Four code rows, R1 to R4 (section 5). R1 and R2 can run side by side; R3 and R4 follow in order.

## Decisions for the human

One recommendation each; the samples below follow the recommendations.

**Decided 2026-10-20 by the human:** Q1 (a), Q2 (a), Q3 option 1, Q4 (a); Q5 (a) as the coordinator's stated default, which the human did not change. The spec text below is in 011 C5, C6, C15 and 005 D2 (`status.md` 2026-10-20). R1 to R4 are board rows 011-26 to 011-29.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | Where does `Outstanding:` sit in `squeal status`? | (a) After the vision's head and the failures: revision, known failures and their blocks, affected checks, checkpoint, slow tier, then outstanding. (b) In the human's literal order: verdict, outstanding, then the failure blocks, then the counts. | (a). Its first four lines stay the vision's example and the registration's shape (count, then each failure under it); outstanding is at most six lines, so it is never far down. |
| Q2 | Notes in the default text? | (a) None; the `More:` line counts them and names `--full`. (b) The newest note's first line on the `More:` line. | (a), as the human asked: notes behind a flag. A note that explains a file without a result already reaches the file's reason (a runner failure is the file's `unknown` reason, C4). |
| Q3 | The command for a file with no result at its key (stale, never run, timed out). Today `retry` runs it once but demands `--reason`, which it then ignores (C5 as amended for gh-36). | (1) `squeal retry <file>...` with `--reason` optional for such a file; a counted failure still needs it. (2) No CLI change: name `squeal retry <file> --reason environment`. (3) A new `squeal run <test file>...`. | (1). One existing path, one sentence of C5, and the text never names a reason that means nothing. (2) teaches agents a reason that is not true of the file. (3) is a second verb for the same queue entry. |
| Q4 | Exit code of `squeal status <path>...` without `--wait`. | (a) As 005 D1 for the selected files: 0, 1 with a known failure among them, 3 without a verdict. (b) 0, as `squeal status`. | (a). The form exists to answer "do these files pass now"; the named wait already exits so. |
| Q5 | A source path that selects many stale files (81 browser specs on cezar). | (a) Up to three files the line names `squeal retry` with their paths; above that it names `squeal retry <test file>...` and `squeal run --all --wait`, with how many files the latter runs. (b) `squeal retry <source path>` runs once every selected test file with no result. | (a). C15 decided that a source path's selection is the queue's ordinary work and not promoted; (b) reverses that for retry. gh-38's own probe found the exact-path half needs no new command. |

## 1. Order and length

### 1.1 `squeal status`

In order, each line printed only when it has content:

1. `Revision: N · <commit> + k, dirty` (unchanged).
2. `Known failures: N (<parts>)` and, after a semicolon, the not-current clause (section 2). This line is the verdict.
3. `Earlier failures: K pending rerun, S stale (not counted until a rerun fails)` (gh-34, unchanged).
4. Each known failure in full, as today, current ones first, then pending, then stale. The block shape stays: `evals/lib/squeal-text.mjs` (`checksOf`) reads a failure's validity from its `observed at revision N, <validity>` line, so a one-line form for earlier failures would read as current.
5. `Affected checks:` and `Full-suite checkpoint:` (unchanged), the `Slow tier:` line (004 D8, unchanged).
6. `Outstanding:`, then one indented line per group of test files that are not current (section 3): `<k> test files <state>: <up to 3 paths> and N more; <next step>`. At most six groups, then `` and K test files in M more groups (`squeal status --full` lists every group) ``. Slow files the `Slow tier:` line already counts are left out, except a running one whose project has a global setup (section 3, gh-46). It replaces the `Idle:`, `Discovery:`, `Checkpoint in progress:`, `Pending retries:` and `Test files without a result:` lines and the daemon line when no daemon validates; each becomes a group.
7. Coverage lines, unchanged: `Not run:` (excluded Vitest projects and globs) and configuration problems. The `Codex:`, `Pi:` and OpenCode lines stay where they are.
8. `` More: `squeal status --full` adds <what is hidden> ``: the worktree and daemon, inheritance with its count (`3,240 current results from 2 worktrees`), the test files without a result one by one with their count, and the notes with their count. Only parts with content are named.

What moves behind `--full`: the `Worktree:` line, the `Daemon:` line while a daemon validates, `Inherited from other worktrees:` and its sources, `Test files without checks:`, the per-file list under `Test files without a result:`, `Closure method:`, `Store schema:` and `Notes:`.

### 1.2 `squeal status --full` and `--notes`

`--full` prints the default text with `Outstanding:` uncapped, then a blank line and today's detail block unchanged: worktree, daemon, inheritance and its sources, test files without checks, test files without a result (20 named, then a count), closure method, store schema, notes folded as today. `--notes` is `--full` with every note in full, today's meaning (task 001-222). `--json` stays the whole snapshot and needs no flag.

`--full`, not `--all`: `run --all` means the whole suite and `failures --all-worktrees` every worktree, so `status --all` would read as one of those.

### 1.3 `squeal status --wait <ms>` without paths

The default text of 1.1, then its verdict line last (011-10). The verdict line's worktree part becomes the known failures and the not-current clause; the quiet line says its scope (gh-41): `Returned on quiet: none of the 91 test files the edits since revision 1 re-keyed is pending, at revision 1 after 0.0 s; this wait does not hold for the rest of the worktree.` The `0 checks and 553 test files without checks pending in all` part goes, since the worktree part now counts them. `--full` prints the full text before the line.

### 1.4 `squeal status --wait <ms> <path>...`

1. The `Revision:` line, as a short header.
2. `Selected: <files>` (unchanged, 10 then `and N more`).
3. The selected files' failures in full (unchanged).
4. Without a clean verdict, the class blocks: `Pending (n):`, `Current (n):`, `Stale (n):`, `Unknown (n):`, each followed by one indented line per reason group, `<k> <reason>: <paths>; <next step>`, in the same form as `Outstanding:`. Up to 10 paths a group, then `and N more`.
5. The verdict line, last (011-10), its reason groups each carrying its command where one exists, then the worktree part.

The worktree's status prints only with `--full`, before the selection, as today. `--json` is unchanged in shape: stdout is the snapshot plus `wait`, stderr the selection and verdict lines.

### 1.5 `squeal status <path>...` without `--wait` (gh-42)

Today it exits 2 (`takes paths only with --wait <ms>`, pinned by `test/cli/status-wait-paths.test.ts:285`). Proposed: it answers once with 1.4's lines and promotes nothing.

- Before reading, it asks the daemon's sync once and reads when the answer lands or after `STATUS_WAIT_SETTLE_MS` (750 ms), whichever comes first. An edit the daemon has not stored yet could otherwise leave an old result current and exit 0. When the sync did not reach the store's revision, the line says `results are as of revision N; the daemon has not stored its pass over the latest edits` and gives no verdict.
- The last line reads as a snapshot: `Named test files at revision N: ...` with a verdict, or `Named test files have no verdict at revision N: ...` with the reason groups and their commands. No deadline is named.
- Exit code per Q4.
- `--json`: the snapshot plus a `named` field, the named wait's payload with `outcome: "snapshot"` and `waitedMs` the sync's time.
- `--wait 0 <path>` is not the snapshot: it is a wait whose deadline has passed, worded `the deadline passed after 0.0 s`. It sends no promotion: its first read is final, and a promotion for 0 ms lapses at once (corrected 2026-10-20, 011-28).

## 2. Stale and pending counts beside `Known failures` (gh-45)

**The clause.** One formatter, `notCurrentText`, appends to every `Known failures:` line, the registration header's and Stop's included, and ends a wait's verdict line:

- `Known failures: 0; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)`
- Parts: running, queued, stale, unknown, each only when not zero; the tests part only when not zero.
- Everything current: `Known failures: 0; all 10 test files current`. Only with a live daemon, the test files listed and the revision's runner part done; otherwise the clause says which of those is missing (`the daemon has not listed this worktree's test files yet`; `revision 12 is not listed yet, so test files it adds are not counted`) and a down daemon is said by the header's sentence and status's first outstanding group, as today.

**Units.** 005 D1 asks every count of checks to name its tests and file-level checks apart. A test file has one file-level check (001 D4), so `8 test files` and `80 tests` are the not-current checks split as D1 asks; a test file without checks counts as a file only. The checks count stays on `Affected checks:` and the header's count line.

**Words.** `running` and `queued` are C4's pending split by phase; status says them apart on `Affected checks:` already, and the verdict line has carried `running` and `queued` since 011-10. That clause replaces the verdict line's `checks N running, M queued; K test files without checks: r running, q queued`.

**Where it is derived.** `readHeader` (`src/core/state/header.ts`) already reads every test file's key row and every check. A test file's class is `fileClassOf`'s (`src/cli/verdict.ts`, which the named wait uses): current, pending (with its row's phase or a check's), stale, unknown. Counted in the same pass, it is one more map over rows `readHeader` already holds, on the hook path's budget. It moves from `src/cli` to `src/core/status` so the header can use it.

**JSON.** Additive on `StatusHeader`, so in `status --json` and the hook payloads: `testFileCounts: { current, pending, stale, unknown }` and `testFilesByPhase: { running, queued }`. `counts` stays the checks; `knownFailureCounts` (gh-34) is unchanged.

**Declined.** gh-45's second ask, calling a failure observed at an older revision stale while its key has not moved, breaks C4's one validity rule and C5's counted-until-retry rule (the human, 2026-10-20). The same-key failure stays `observed at revision 6, current`.

## 3. What advances each file

One pure function, `nextStep` (`src/core/status/next-step.ts`), maps a test file's state to the words and, where one exists, the command. The named class lines, the verdict line's groups and status's `Outstanding:` all use it. "No command runs it sooner" is said where Squeal has none, with the reason.

| State, from the store | Reason the line gives | Next step |
| --- | --- | --- |
| No daemon validating | `no daemon has validated since <time>; results are as of revision N` | `` `squeal start` starts one `` (today's) |
| Discovery: test files or the revision's runner part not listed | today's `Discovery:` and `revision N not listed yet ...` (C15) | none needed: the runner part is bounded at N s per call, and `` `squeal status --wait 60000` `` waits for it |
| Stale, nothing queued (key moved, no run) | `last passed at other inputs, nothing queued it`, plus `(the baseline is lookup-only)` under that policy (gh-38) | `` `squeal retry <file>` runs it once `` |
| Unknown, never run at its key, nothing queued | `never run at its inputs, nothing queued it` (same lookup-only clause) | `` `squeal retry <file>` runs it once `` |
| Unknown, timed out in a tier of its own (C4) | `timed out after 600 s; Squeal does not run it again at these inputs by itself` (gh-43) | `` `squeal retry <file>` runs it once ``, and while the one-minute load is at or above the CPU count `(load 30.2 on 24 CPUs now: under that load it may time out again)` |
| Unknown, ran and recorded nothing (withheld, inputs moved, paths first read) | the recorded reason, as today | `` `squeal retry <file>` runs it once `` |
| Unknown, its project's global setup failed | `its project's global setup failed` (the setup FAIL is listed) | `` the next edit or `squeal run --all --wait` starts the runner again `` (C4; retrying the setup itself is 001-397) |
| Unknown, no key (a runner call failed) | the runner's message, as today | `` the next edit or `squeal run --all --wait` calls the runner again `` |
| Unknown, no dependencies installed | `no dependencies are installed in this worktree` | `` `npm ci` installs them `` (the header's install command; a daemon then runs them) |
| Pending, another worktree's claim (C7) | `waiting for <worktree>'s run of its key, at most until HH:MM:SS` (C15) | none: `its result is shared here when that run stores it` |
| Pending, slow (004 D2) | today's `` slow, run after the fast tests or on `squeal run --slow` `` | the command is in the reason |
| Pending, running, alone in its run | `running since HH:MM:SS in the <lane> lane` (C15) | none needed |
| Pending, in a run of several files (gh-40 run A) | `in the <lane> tier of 27 test files running since HH:MM:SS`. Not `running since`: the store cannot tell whether the file has started or waits for a worker | `no command runs it sooner (a running tier is not interrupted, 001-381)` |
| Pending, queued behind a running tier | `queued behind the <lane> tier of 4 test files running since HH:MM:SS`, `promoted` when the daemon published it (C15) | in a named wait: `no command runs it sooner`; in status: `` `squeal status --wait 60000 <test file>` moves a named one ahead when that tier ends `` |
| Pending, queued with no open run, claim, slow turn or unlisted revision (gh-41) | `queued; no run is open and nothing recorded holds it` | none known: `` the store records no reason the daemon has not taken it (`squeal status --json` lists each file's state) `` |
| A pending retry (C5) | `<file> (<reason>)` | `runs at the daemon's next look: the one-minute load average is below the CPU count (7.45 on 24 CPUs now)`, or today's waits-for-load text when it is not below, or `running since HH:MM:SS` when its run is open (gh-41's comment) |
| A checkpoint in progress | today's line | `` `squeal run --all --wait` waits for it `` |
| A running slow file whose project has a global setup (gh-46) | `running since HH:MM:SS; its project's global setup (<file>) ran once when this slow pass started, and Squeal does not hold what it started, so another run of that project meanwhile may replace it` | `` after a failure from that, `squeal retry <file> --reason environment` runs this one file again `` |
| An unmatched path (gh-39) | `no test file's closure holds <resolved> (<given>, resolved against <cwd>)`, and when the same path from the worktree root is a listed test file, `; from the worktree root that path is the listed test file <path>` | name the test file by a path that reaches it; it is never selected silently |

Rules:

- **Order.** A file has one state. Another live worktree's claim on its key is tested before stale and unknown: the file waits for its claimant even when it is also stale or never run here, so the line never names `retry` for a run that would only wait behind that one (C4, C15).
- **Commands with paths.** A group of up to three files names its command with every path (`` `squeal retry tests/a.test.ts tests/b.test.ts` ``). A larger group names `` `squeal retry <test file>...` `` and `` `squeal run --all --wait` runs all N test files not current here `` (Q5). In `--json` every file's `next` carries its own command.
- **Retry wording.** The commands above follow Q3 option 1. Under option 2 each reads `` `squeal retry <file> --reason environment` ``.
- **The verdict line.** Each of its reason groups (C15's cap of five) carries `` : `<command>` `` when its next step is a command, so a `tail -1` keeps it. `--help` says that `retry` also runs once a file with no result at its key (gh-38's third point).
- **gh-46's evidence.** The Vitest adapter lists each project's global setup files among its environment inputs (`src/runners/vitest/environment.ts:39`). Whether the store keeps them per project where the CLI can read them is R2's first probe. If it does not, the clause names no file (`its project's global setup ran once ...`) when the adapter recorded that the project has one, and is left out otherwise; the retry hint stays, since it is true of any slow file.
- **What stays as it is.** No automatic retry of a timed-out file, no per-file cap, no load-waiting retry for a file without a result (gh-43, held); connection refused is not classified (gh-46, dropped); no interruption of a running tier (001-381); no scheduler change (gh-41 waits for the reporter's evidence).

## 4. Texts that change with it

- **Primer** (`src/harness/shared/primer.ts`): no change. It names the path wait, the pathless wait and `retry` already, and it is at its 1,500-character cap in two shapes (005 D6). The setup block (`src/cli/setup/block.ts`) does not change either, since its version raise would fail `setup --check` everywhere.
- **Help** (`src/cli/main.ts` `HELP`): `squeal status [--full] [--notes] [--json]`, `squeal status <path>... [--json]` with its exit codes, `--full` on both waits, and `squeal retry <test file>... [--reason load|environment]` saying a file with no result at its key runs once at once, any reason or none. Pinned by `test/cli/subcommand-help.test.ts` and `test/cli/main.test.ts`.
- **Skills**, every copy (`plugins/claude-code`, `plugins/codex`, `plugins/pi`, `skills/squeal/`): `SKILL.md` step 4's "`Known failures: 0` with checks pending means no known failures yet" becomes "the `Known failures:` line says what is not current; claim no known failures only with it", step 3 unchanged. `references/commands.md`: the status sample, "then it prints status" in both wait sections (the default text, `--full` for the rest), the named-wait paragraph (revision, selection, failures, class blocks with each group's next step, verdict), a paragraph for `status <path>...`, and `retry` for a file without a result. `references/reports.md`: checked, no status sample found.
- **Evals parser** (`evals/lib/squeal-text.mjs`): `/^Known failures: (\d+)/` still matches. `countsOf` reads a named wait's counts from the verdict line's worktree clause, since its output no longer holds `Affected checks:`; until it does, `squealEvidence` returns `null` counts for a named wait and `clear()` is false. `selectedOf` and `NAMED` are unchanged. `evals/lib/transcript.mjs`'s squeal-line pattern gains `Outstanding:` and `More:`. Old transcripts keep parsing: every change is additive to what the parser reads.
- **Eval pins** that round-trip the formatters (memory: gate parsers on real formatters): `test/evals/evidence-squeal.test.ts` (with its frozen `fixtures/squeal-text-c6320866.mjs`, compared only on fields both versions read), `header-forms.test.ts`, `named-wait.test.ts`, `slow-wait-text.test.ts`, `squeal-state.test.ts`, `retry-claim.test.ts`. Each round-trips the new `formatStatus`, `namedText`, `formatRegistration` and Stop text, plain and hook JSON. `evals/lib/rubric.mjs`'s "Known failures: N ... lists every known failure" stays true, since every failure keeps its block.
- **Product tests pinning today's text**: `test/cli/status-wait-paths.test.ts` (the refusal at :285 inverted; the worktree clause), `status-wait.test.ts`, `status-wait-edit.test.ts`, `status-wait-reasons.test.ts`, `status-wait-paths-slow.test.ts`, `status-wait-promoted.test.ts`, `test/status/known-failure-counts.test.ts`, `status.test.ts`, `work-line.test.ts`, `unknown-files.test.ts`, `pending-retries.test.ts`, `slow-tier.test.ts`, `test/delivery/format.test.ts`, `test/harness/known-failures-line.test.ts`, `session-start.test.ts`, `user-prompt-submit.test.ts`, `test/harness/codex/command.test.ts`, `test/cli/run-all-verdict.test.ts`, `test/scheduler/first-observation.test.ts`, `slow-pending.test.ts`, and `test/e2e/transitions.test.ts` (outside Squeal's coverage; CI runs it).
- **Vision** (`docs/vision.md`, "The desired experience"): its four-line example stays the first four lines under Q1 (a), since outstanding work prints after them. No edit.

## 5. Code rows

Provisional names; numbers come from the board on acceptance. All after 011-22, which changes what is an edit's work and so the pending reasons. Each row: version bump, review PASS on its candidate.

**R1. `Known failures:` says what is not current (gh-45).** Seams: `src/core/state/header.ts` (`readHeader`: `testFileCounts`, `testFilesByPhase`), the file class moved from `src/cli/verdict.ts` into `src/core/status/`, `notCurrentText` in `src/core/status/checks.ts`, its callers `src/core/status/format-status.ts`, `src/core/delivery/format.ts` (`formatRegistration`), `src/harness/shared/text.ts` (`knownFailuresLine`) and `src/cli/status-wait-lines.ts` (`worktreeText`); types `src/core/types/status.ts` (additive). Texts: skill step 4, evals `countsOf`. Done when: gh-45's `zero` scenario prints the clause in status, the registration header, Stop and both waits' verdict lines, plain and `--json`; the evals round-trip passes. Most likely false: the test-file classes agree with the named wait's for a file without checks, a file whose open run a re-key queued (C15: counted running), a slow file and a failed setup's files; and `all N test files current` never prints while the files are unlisted, the runner part is pending or no daemon validates. A test seeds each.

**R2. Every file without a verdict names what advances it (gh-38, gh-39, gh-40, gh-41, gh-43, gh-46's hint).** Seams: `src/core/status/next-step.ts` (new, pure), `src/cli/named-files.ts` (`PendingReason.running` gains the run's file count; additive), `src/cli/named-file-lines.ts` (class blocks and reason groups with next steps), `src/core/status/unknown-files.ts` and the scheduler's unknown records (an additive structured `cause`, so the timeout is not matched by its words; records without one get the generic `retry` step), `src/cli/status-wait-paths.ts` (`NamedSelection.unmatched` keeps the given path, the cwd and the root reading; additive), `src/cli/retry.ts` and `HELP` (Q3), `src/core/retry/text.ts` (`waitsText` below the CPU count and running), the global setup files per project (probe first, section 3). Done when: one test per row of section 3's table over a seeded store, gh-38's scenario A under `lookup-only` among them, and `retry` without `--reason` on a stale, a never-run and a timed-out file, refused on a counted failure. Most likely false: the order rule, that a stale file whose key another live worktree is running names the claim and not `retry`. A test seeds that claim.

**R3. A named wait and `status <path>...` print the selection, not the worktree (gh-42, gh-44).** After R2. Seams: `src/cli/status-wait-lines.ts` (`namedText` short; `--full`), `src/cli/main.ts` (`--full`; paths without `--wait`), a new `src/cli/status-paths.ts` for the snapshot over `selectNamedFiles` and `readNamedFiles` with one sync and no promotion, `src/cli/status-wait-paths.ts` (`--full`; the `named` JSON payload; outcome `snapshot`). Texts: `commands.md`'s named-wait paragraph and the new `status <path>` one, `HELP`, evals `countsOf` for named output, eval pins. Done when: gh-44's E1 prints 3 lines ending with the verdict; gh-42's two selected files answer without `--wait` with exit as Q4; a snapshot after an edit the daemon has not stored says so and gives no verdict; `--full` gives today's output. Most likely false: the snapshot's sync bound, that an edit made just before `status <path>` never yields a stale exit 0. A test holds the daemon's pass behind the 750 ms.

**R4. `squeal status` leads with its verdict (the human's direction).** After R3. Seams: `src/core/status/format-status.ts`, already 323 lines, split into the default text, `--full`'s detail block and `src/core/status/outstanding.ts` (groups over `nextStep`), replacing `work-line.ts`'s `Idle:`/`Discovery:` and `unknownFilesLines` in the default; `snapshot.ts` builds `outstanding` for `--json`; `src/cli/status-wait-lines.ts` (`waitText` short, the quiet line's scope). Texts: `commands.md`'s status sample and wait section, eval pins. Done when: gh-44's worktree prints 7 lines and `--full` today's 36; each `Outstanding:` group of section 3 renders from a seeded store; the quiet line of gh-41's E1 says its scope; `--notes` unchanged. Most likely false: that nothing an agent acts on moved behind `--full`. A test lists every line `--full` adds and asserts each is detail (worktree, daemon while alive, inheritance, per-file list, closure method, schema, notes).

R1 and R2 touch different files except one line each of `format-status.ts` and `status-wait-lines.ts`; they can run side by side within the host's limit of three workers. R3 needs R2's class blocks; R4 needs R3's `--full` path in `status-wait-lines.ts`.

## Spec text (drafts, for the amendments)

**011 C6**, a paragraph after the gh-34 amendment: "Amended 2026-10-NN (the human, 011-24, gh-42, gh-44, gh-45; `tasks/011-24/design.md`): `squeal status` leads with its verdict. Its text is the revision line; `Known failures: N` with, after a semicolon, what is not current, in test files and tests by running, queued, stale and unknown (`not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)`), or `all N test files current` only with a live daemon, the files listed and the runner part done; the earlier-failures line and every known failure in full, current first; `Affected checks`, the full-suite checkpoint and the slow-tier line; `Outstanding:`, one line per group of files not current with the command that advances it or that none does (C15), at most six groups; the coverage lines; and a `More:` line naming what `--full` adds. `--full` adds the worktree, daemon, inheritance, every file without a result and the notes; `--notes` is `--full` with every note in full. The registration header, Stop and every wait's verdict line carry the same clause on their known-failures part. `status --json` adds `testFileCounts`, `testFilesByPhase` and `outstanding`. A wait prints this text, or with `--full` the full one, and its verdict line last (011-10); a quiet line says the rest of the worktree does not hold it."

**011 C15**, replacing the closing sentence of "What status and the named line say about each file": "Amended 2026-10-NN (the human, 011-24; gh-38, gh-39, gh-40, gh-41, gh-43, gh-46): every selected file without a verdict names the command that advances it, or says that none does and why: `squeal retry <file>` runs once a stale, never-run or timed-out file (the last with the load when it is at or above the CPU count), `squeal run --slow` a slow one, a claim or a running tier is waited for and nothing runs it sooner, a file in a run of several files is said to be in that run and not running, a file queued with nothing recorded holding it says so, and a running slow file whose project has a global setup names `squeal retry <file> --reason environment` as its one-file rerun. The class lines group the files by reason with that step, and the verdict line gives each of its reason groups its command. An unmatched path names the directory it was resolved against and, when the same path from the worktree root is a listed test file, that file; it never selects it."

**005 D2**, after its print-order sentence: "Amended 2026-10-NN (the human, 011 row 011-24): the wait prints the revision line, the files it selected, their failures in full, the class lines with each group's next step (011 C15) and last its verdict; the worktree's status precedes them only with `--full`. `squeal status <path>...` without `--wait` answers once with the same lines after one sync of at most 750 ms, promotes nothing, words its last line as a snapshot, and exits as D1 for the selected files."

**011 C5**, under Q3 option 1, appended to the gh-36 amendment: "`--reason` is optional for such a file."

## Rejected options

- **The verdict first and repeated last** (gh-44 option b): two copies of one line, and a reader of the first may stop before the class lines.
- **The verdict first only**: breaks 011-10, whose reason was `| tail`.
- **`--wait 0` as the snapshot** (gh-42 open question 4): it is a wait whose deadline passed, worded so, and it promotes.
- **A root-relative fallback for an unmatched path** (gh-39): one argument would mean two files. The line names the root reading instead.
- **Earlier failures in one line each**: `checksOf` would read a stale failure as current (section 1.1, item 4).
- **Outstanding groups in the registration header and Stop**: the header runs on every hook within a 2 s budget and the 10,000-character cap; it carries the counts and `status` the groups.
- **Calling an unchanged-key failure stale** (gh-45): declined, C4.

## Samples

Before: rendered by `scratch/before.mjs` (full output `scratch/before.md`). After: derived by hand from the same seeds under the recommendations. Paths the seeds do not name are illustrative and marked so.

### gh-44 E1: a named wait on one edited file, 24 others never run under `lookup-only`

Before, 39 lines (exit 0), abridged:

```text
Revision: 1 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 3 passed (2 tests, 1 test file loaded), 0 running, 0 queued
Idle: nothing is running and no run is open; 24 test files without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 1)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 0 pending, 24 unknown
Test files without a result: 24 (nothing current at their inputs, none queued)
  test/f02.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  [18 more lines of the same form, f03 to f20]
  test/f21.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  and 4 more test files
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  2026-10-19T16:14:00.000Z, revision 0: node-test project "unit": 1 test file(s) loaded nothing beyond themselves; declare their inputs in squeal.config.json

Selected: test/f01.test.mjs
Named test files at revision 1: no known failures; 1 test file, each with a current result, after 0.5 s. Worktree: known failures 0; checks 0 running, 0 queued
```

After, 3 lines (exit 0):

```text
Revision: 1 · 64cf3a8f + 1, dirty
Selected: test/f01.test.mjs
Named test files at revision 1: no known failures; 1 test file, each with a current result, after 0.5 s. Worktree: known failures 0; not current: 24 of 25 test files (24 unknown)
```

`squeal status` in the same worktree, after, 7 lines instead of 36:

```text
Revision: 1 · 64cf3a8f + 1, dirty
Known failures: 0; not current: 24 of 25 test files (24 unknown)
Affected checks: 3 passed (2 tests, 1 test file loaded), 0 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one)
Outstanding:
  24 test files never run at their inputs, nothing queued them (the baseline is lookup-only): test/f02.test.mjs, test/f03.test.mjs, test/f04.test.mjs and 21 more; `squeal retry <test file>...` runs each once, `squeal run --all --wait` runs all 24 test files not current here
More: `squeal status --full` adds the worktree and daemon, the 24 test files without a result one by one and 1 note
```

### gh-42: two selected files, no daemon, no dependencies installed

Before, without `--wait` (exit 2; from `research/issue-42.md` E1):

```text
squeal status: takes paths only with --wait <ms>
[the full usage text, 78 more lines]
```

Before, `--wait 1` (exit 3): 35 lines of worktree status (468 files without a result, 20 named), then:

```text
Selected: test/cli/main.test.ts, test/cli/remove.test.ts
Unknown (2): test/cli/main.test.ts: no result: no dependencies are installed in this worktree; test/cli/remove.test.ts: no result: no dependencies are installed in this worktree
Named test files have no verdict: no daemon has validated since 2026-10-19T16:05:00.000Z: the daemon stopped; results are as of revision 837; `squeal start` starts one. Worktree: known failures 0; checks 0 running, 0 queued
```

After, `squeal status test/cli/main.test.ts test/cli/remove.test.ts` (exit 3):

```text
Revision: 837 · 64cf3a8f + 1, dirty not known
Selected: test/cli/main.test.ts, test/cli/remove.test.ts
Unknown (2):
  2 without a result, no dependencies are installed in this worktree: test/cli/main.test.ts, test/cli/remove.test.ts; `npm ci` installs them
Named test files have no verdict at revision 837: no daemon has validated since 2026-10-19T16:05:00.000Z; `squeal start` starts one. Worktree: known failures 0; not current: 468 of 468 test files (468 unknown)
```

`--wait 1` gives the same four lines, its last reading `Named test files have no verdict: no daemon has validated since 2026-10-19T16:05:00.000Z: the daemon stopped; results are as of revision 837; ...` as today.

### gh-45 `zero`: no failure, 60 stale and 20 queued tests in 6 and 2 test files

Before, `squeal status`:

```text
Revision: 26 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 20 passed (20 tests), 0 running, 20 queued (20 tests), 60 stale (60 tests)
Idle: nothing is running and no run is open; 20 queued (20 tests) (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 26)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Closure method: static imports plus declared inputs
Store schema: 1
```

After (paths illustrative):

```text
Revision: 26 · 64cf3a8f + 1, dirty
Known failures: 0; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)
Affected checks: 20 passed (20 tests), 0 running, 20 queued (20 tests), 60 stale (60 tests)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)
Outstanding:
  6 test files last passed at other inputs, nothing queued them (the baseline is lookup-only): src/s1.test.ts, src/s2.test.ts, src/s3.test.ts and 3 more; `squeal retry <test file>...` runs each once, `squeal run --all --wait` runs all 8 test files not current here
  2 test files queued; no run is open and nothing recorded holds them: src/q1.test.ts, src/q2.test.ts; the store records no reason the daemon has not taken them (`squeal status --json` lists each file's state)
More: `squeal status --full` adds the worktree and daemon
```

Before, the registration header and Stop (the Stop's title reads `SQUEAL · status at revision 26`):

```text
SQUEAL · registered at revision 26
Revision 26 · 64cf3a8f + 1, dirty: 20 current, 20 pending, 60 stale, 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one).
Known failures: 0
```

After, both:

```text
SQUEAL · registered at revision 26
Revision 26 · 64cf3a8f + 1, dirty: 20 current, 20 pending, 60 stale, 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one).
Known failures: 0; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)
```

`status --json`, after: `"testFileCounts": {"current": 2, "pending": 2, "stale": 6, "unknown": 0}`, `"testFilesByPhase": {"running": 0, "queued": 2}`, beside today's `"counts": {"current": 20, "pending": 20, "stale": 60, "unknown": 0}` and `"knownFailureCounts": {"current": 0, "pending": 0, "stale": 0}`.

### gh-45 `oldrev`: failures observed at revision 6, current, pending and stale

Before:

```text
Revision: 26 · 64cf3a8f + 1, dirty
Known failures: 1 (1 test)
Earlier failures: 1 pending rerun, 1 stale (not counted until a rerun fails)
  FAIL  src/moved-key.test.ts > moved-key
        AssertionError: expected 1 to be 2
        observed at revision 6, stale
        recorded 60 min ago in this worktree at revision 6, load 0.40 per CPU when it ran; no retry asked at these inputs
  FAIL  src/queued.test.ts > queued
        [the same three lines, pending]
  FAIL  src/same-key.test.ts > same-key
        [the same three lines, current]
Affected checks: 0 passed, 0 running, 1 queued (1 test), 1 stale (1 test)
Idle: nothing is running and no run is open; 1 queued (1 test) (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)

[Worktree, Daemon, Inherited, Closure method, Store schema: 5 lines]
```

After:

```text
Revision: 26 · 64cf3a8f + 1, dirty
Known failures: 1 (1 test); not current: 2 of 3 test files (1 queued, 1 stale), 2 tests (1 queued, 1 stale)
Earlier failures: 1 pending rerun, 1 stale (not counted until a rerun fails)
  FAIL  src/same-key.test.ts > same-key
        AssertionError: expected 1 to be 2
        observed at revision 6, current
        recorded 60 min ago in this worktree at revision 6, load 0.40 per CPU when it ran; no retry asked at these inputs
  FAIL  src/queued.test.ts > queued
        [the same three lines, pending]
  FAIL  src/moved-key.test.ts > moved-key
        [the same three lines, stale]
Affected checks: 0 passed, 0 running, 1 queued (1 test), 1 stale (1 test)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)
Outstanding:
  1 test file last failed at other inputs, nothing queued it: src/moved-key.test.ts; `squeal retry src/moved-key.test.ts` runs it once
  1 test file queued; no run is open and nothing recorded holds it: src/queued.test.ts; the store records no reason the daemon has not taken it (`squeal status --json` lists each file's state)
More: `squeal status --full` adds the worktree and daemon
```

The same-key failure keeps `observed at revision 6, current` (section 2, declined).

### gh-38 A: a stale file under `lookup-only`, selected by a source path

Before (exit 3), after 10 lines of worktree status:

```text
Selected: tests/a.test.ts
Stale (1): tests/a.test.ts: last pass
Named test files have no verdict: 1 test file without a current result at revision 2 (1 stale). Worktree: known failures 0; checks 0 running, 0 queued
```

After, `squeal status --wait 20000 src/lib.js` (exit 3):

```text
Revision: 2 · 64cf3a8f + 1, dirty
Selected: tests/a.test.ts
Stale (1):
  1 last passed at other inputs, nothing queued it (the baseline is lookup-only): tests/a.test.ts; `squeal retry tests/a.test.ts` runs it once
Named test files have no verdict: 1 test file without a current result at revision 2: 1 stale, nothing queued it: `squeal retry tests/a.test.ts`. Worktree: known failures 0; not current: 2 of 3 test files (2 stale), 2 tests (2 stale)
```

### gh-43: a file timed out in a tier of its own, `unknown`, nothing queued

Before (exit 3), after 14 lines of worktree status, whose `Idle:` line names `squeal run --all --wait`, which runs the file at the same cap again (gh-43 finding 4):

```text
Selected: test/slow.test.ts
Unknown (1): test/slow.test.ts: no result: timed out after 600 s
Named test files have no verdict: 1 test file without a current result at revision 0 (1 unknown). Worktree: known failures 0; checks 0 running, 0 queued
```

After, at a load of 30.2 on 24 CPUs (exit 3):

```text
Revision: 0 · 64cf3a8f + 1, dirty
Selected: test/slow.test.ts
Unknown (1):
  1 timed out after 600 s; Squeal does not run it again at these inputs by itself: test/slow.test.ts; `squeal retry test/slow.test.ts` runs it once (load 30.2 on 24 CPUs now: under that load it may time out again)
Named test files have no verdict: 1 test file without a current result at revision 0: 1 timed out after 600 s: `squeal retry test/slow.test.ts`. Worktree: known failures 0; not current: 1 of 1 test file (1 unknown)
```

### gh-40 B: three fast files behind a running tier and one slow file, a 1.5 s wait

Before (exit 3), after 11 lines of worktree status:

```text
Selected: tests/fast/f1.test.ts, tests/fast/f2.test.ts, tests/fast/f3.test.ts, tests/slow/s1.test.ts
Pending (4): tests/fast/f1.test.ts: queued behind the vitest tier running since 16:14:56; tests/fast/f2.test.ts: queued behind the vitest tier running since 16:14:56; tests/fast/f3.test.ts: queued behind the vitest tier running since 16:14:56; tests/slow/s1.test.ts: slow, run after the fast tests or on `squeal run --slow`
Named test files have no verdict: the deadline passed after 1.5 s: 4 test files still pending at revision 0: 3 queued behind the vitest tier running since 16:14:56, 1 slow, run after the fast tests or on `squeal run --slow`. Worktree: known failures 0; checks 0 running, 0 queued; 28 test files without checks: 4 running, 24 queued
```

After:

```text
Revision: 0 · 64cf3a8f + 1, dirty
Selected: tests/fast/f1.test.ts, tests/fast/f2.test.ts, tests/fast/f3.test.ts, tests/slow/s1.test.ts
Pending (4):
  3 queued behind the vitest tier of 4 test files running since 16:14:56: tests/fast/f1.test.ts, tests/fast/f2.test.ts, tests/fast/f3.test.ts; no command runs them sooner (a running tier is not interrupted)
  1 slow, run after the fast tests or on `squeal run --slow`: tests/slow/s1.test.ts
Named test files have no verdict: the deadline passed after 1.5 s: 4 test files still pending at revision 0: 3 queued behind the vitest tier of 4 test files running since 16:14:56, 1 slow: `squeal run --slow`. Worktree: known failures 0; not current: 28 of 28 test files (4 running, 24 queued)
```

### gh-40 A: the same files inside a running 27-file backlog tier, not yet started

Before, the class line (the verdict line likewise):

```text
Pending (3): tests/fast/f1.test.ts: running since 16:14:56 in the vitest lane; tests/fast/f2.test.ts: running since 16:14:56 in the vitest lane; tests/fast/f3.test.ts: running since 16:14:56 in the vitest lane
```

After:

```text
Pending (3):
  3 in the vitest tier of 27 test files running since 16:14:56: tests/fast/f1.test.ts, tests/fast/f2.test.ts, tests/fast/f3.test.ts; no command runs them sooner (a running tier is not interrupted)
```

### gh-41 E1: a quiet edit wait while 553 files without checks sit queued

Before, 12 lines of worktree status (its `Idle:` line: `` 553 test files without checks queued (`squeal run --all --wait` runs every test file without a result and waits) ``), then:

```text
Returned on quiet: nothing the edits since revision 1 re-keyed is pending (91 test files) at revision 1 after 0.0 s; 0 checks and 553 test files without checks pending in all. Worktree: known failures 0; checks 0 running, 0 queued; 553 test files without checks: 0 running, 553 queued
```

After, `squeal status --wait 60000` (paths illustrative):

```text
Revision: 1 · 64cf3a8f + 1, dirty
Known failures: 0; not current: 553 of 644 test files (553 queued)
Affected checks: 455 passed (364 tests, 91 test files loaded), 0 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one)
Outstanding:
  553 test files queued; no run is open and nothing recorded holds them: e2e/a001.e2e.ts, e2e/a002.e2e.ts, e2e/a003.e2e.ts and 550 more; the store records no reason the daemon has not taken them (`squeal status --json` lists each file's state)
More: `squeal status --full` adds the worktree and daemon
Returned on quiet: none of the 91 test files the edits since revision 1 re-keyed is pending, at revision 1 after 0.0 s; this wait does not hold for the rest of the worktree. Worktree: known failures 0; not current: 553 of 644 test files (553 queued)
```

The retry in gh-41's comment, before: `waits for the one-minute load average to fall below the CPU count (load average 7.45 on 24 CPUs now)`. After: `runs at the daemon's next look: the one-minute load average is below the CPU count (7.45 on 24 CPUs now)`, or `running since 16:14:56` once its run is open.

### gh-39: a repo-relative path typed from a subdirectory

Before (exit 3), after 10 lines of worktree status:

```text
No verdict: no test file's closure holds packages/cezar/packages/cezar/src/core/cursor-print-capabilities.test.ts. Worktree: known failures 0; checks 0 running, 0 queued
```

After (the worktree part illustrative):

```text
Revision: 20 · 64cf3a8f + 1, dirty
No verdict: no test file's closure holds packages/cezar/packages/cezar/src/core/cursor-print-capabilities.test.ts (packages/cezar/src/core/cursor-print-capabilities.test.ts, resolved against packages/cezar); from the worktree root that path is the listed test file packages/cezar/src/core/cursor-print-capabilities.test.ts. Worktree: known failures 0; all 912 test files current
```

### gh-46: a slow e2e file running in the slow tier

Before, `squeal status`:

```text
Revision: 0 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 3 passed, 1 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)
Slow tier: 1 test file; running e2e/held.e2e.ts since 16:14 (no earlier run). Squeal runs them after the fast tests; `squeal run --slow --wait 60000` waits for its result.

[Worktree, Daemon, Inherited, Closure method, Store schema: 5 lines]
```

After, with the project's global setup known to the store (section 3):

```text
Revision: 0 · 64cf3a8f + 1, dirty
Known failures: 0; not current: 1 of 3 test files (1 running), 1 test (1 running)
Affected checks: 3 passed, 1 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)
Slow tier: 1 test file; running e2e/held.e2e.ts since 16:14 (no earlier run). Squeal runs them after the fast tests; `squeal run --slow --wait 60000` waits for its result.
Outstanding:
  1 slow test file running since 16:14:57: e2e/held.e2e.ts; its project's global setup (e2e/environment.ts) ran once when this slow pass started, and Squeal does not hold what it started, so another run of that project meanwhile may replace it; after a failure from that, `squeal retry e2e/held.e2e.ts --reason environment` runs this one file again
More: `squeal status --full` adds the worktree and daemon
```

Once it has failed with `ECONNREFUSED`, its block reads as today (`issue-46.md` 2), a counted current failure with `no retry asked at these inputs`; the primer's retry sentence already names the command for a stopped service.

## What is not known

- Whether agents read the shorter output better: the human's direction rests on their own reading, not on a measurement of agents (`issue-44.md`). No eval gates these rows (memory, 2026-10-19); the next Sonnet and Sol evals the human asks for would show it.
- Whether the store keeps a project's global setup files where the CLI can read them (R2's probe).
- gh-41's incident cause, the stalled scheduler or a held queue, is not determined; the `queued; nothing recorded holds it` group says what the store knows and points at the JSON the reporter was asked for.
- Line counts in the summary are from the seeds: gh-44's E1 and the `--wait 1` of gh-42 at their findings' scale. A worktree with inherited results adds one line per source to `--full`, none to the default.
