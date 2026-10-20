# 011-28 notes: decisions the brief did not settle

Row 011-28 (`tasks/011-24/briefs.md`, design `tasks/011-24/design.md` sections 1.4, 1.5 and R3; 005 D2 as amended 2026-10-20). Worker run `b97b7352`, 2026-10-20.

## Corrections of the brief

- **`--wait 0 <path>` never promoted** (coordinator's decision (a), 2026-10-20). The done-when said it "still promotes". On main, `waitForNamed` promotes only at a read that is ready and not final; with `--wait 0` the first read is final and its sync is still pending, so it returns `timeout` before the promote branch. A promotion sent then would carry `withinMs` 0, which `Scheduler.promote` turns into `until = now`, so it would lapse at once. `waitForNamed` is unchanged: `--wait 0 <path>` stays the wait, not the snapshot, worded `the deadline passed after 0.0 s`, its payload under `wait`, and sends no promotion. Pinned in `test/cli/status-wait-paths.test.ts`. The coordinator amends the brief and design 1.5 on main.

## The snapshot (`src/cli/status-paths.ts`)

- **Liveness as status reads it.** The snapshot judges the daemon by `daemonLiveness` on its one read, as `squeal status` does, not by the wait's `watchDaemon`, which goes on through a heartbeat lapse by asking the socket. A read cannot go on, so a stale heartbeat gives no verdict and the line says what status says: `no daemon has validated since <time>; \`squeal start\` starts one`. No lapse wording ("so the wait went on") reaches a snapshot.
- **A sync that cannot answer is read at 750 ms.** With no daemon listening, or one that predates `sync`, the snapshot reads at `STATUS_WAIT_SETTLE_MS`, as the wait's settle fallback does, so a daemon a hook just spawned has recorded its heartbeat. gh-42's no-daemon case therefore takes 750 ms. A sync that stored its pass is read at once.
- **Ready as the wait's last read.** A verdict needs a live daemon and a stored pass at or below the read revision with the revision listed (or a sync that cannot answer). Otherwise: a pending sync says `results are as of revision N; the daemon has not stored its pass over the latest edits`; a pass past the read revision says the wait's `the daemon's pass is at revision M and results are as of revision N`; a selected file still pending answers at once with the class lines and no deadline. Every one exits 3.
- **The revision is named once.** A snapshot's no-verdict head is `Named test files have no verdict at revision N:` when its reason names no revision (no daemon, every file slow), and `Named test files have no verdict:` when it does (`noVerdictText`'s clauses, the unsynced reasons), so no line says the revision twice. The verdict line is the wait's without `, after X s`.
- **JSON.** `status --json <path>...` puts the payload under `named` with `outcome: "snapshot"`, as design 1.5 says; `waitedMs` is the sync's time. The internal outcome (`settled`, `no-daemon`, `timeout`, ...) stays on the `NamedWait` for the text, marked `snapshot: true`.

## `--full` and `--notes`

- `--full` is parsed on every `status` form. On the two path forms it prints the worktree's status before the selection, today's output. On `squeal status` and the pathless wait it is accepted and changes nothing, since both print the full status already; 011-29 gives it its meaning there. `HELP` names it on the path forms only, so 011-29 adds it to `squeal status [--full] [--notes] [--json]`.
- `--notes` implies `--full` for named output (C6 as amended: `--notes` is `--full` with every note in full), and the full status then lists every note.

## Evals parser (`evals/lib/squeal-text.mjs`)

Design section 4 said `NAMED` and `selectedOf` stay unchanged; it was written before the snapshot's verdict line, which names no time. Round-tripping the real formatters (plain and in a Claude Code hook's JSON) found three gaps, each fixed:

- `NAMED` now matches a verdict line followed by `, after `, `. `, `; ` or the end, so a snapshot's verdict credits its selected files as the wait's does.
- `known` falls back to the verdict line's `Worktree: known failures N` when the text has no `Known failures:` line, so a short named text (or its line alone) says the worktree's known failures.
- `NO_DAEMON` matches `Named test files have no verdict[ at revision N]: no daemon`, since the short text has no `Daemon:` line.

`test/evals/evidence-squeal.test.ts` now holds `--full` named texts to the old property (they start with the status and read as it), and the short forms (wait, timed-out wait, snapshot) to: revision, known failures, daemon and verdict equal to the status's, and not-current agreeing. The `slowPending` fixture leaves its slow file out of `testFileCounts`, which `readHeader` never does (`countNotCurrent` counts every listed file); the short-form test counts it in (`slowCounted`).

## Type changes (all in `src/cli`)

- `NamedWait`'s snapshot variant: optional `snapshot?: boolean` (additive).
- `NamedWaitPayload.outcome`: `NamedWaitOutcome | "snapshot"` (widened).
- `namedText(wait, now, command, options?: NamedTextOptions)`: new optional `{ full?, allNotes? }`.
- `namedWaitCommand(paths, how: NamedPrint, io, options)`: was `(paths, json: boolean, io, options)`; its only callers are `statusWaitCommand` and `test/cli/status-wait-deadline.test.ts`.
- `statusWaitCommand(..., paths, named?: NamedTextOptions)`: new optional last parameter.
- New: `printNamed`, `NamedPrint` (`status-wait-paths.ts`); `readNamedSnapshot`, `namedSnapshotCommand`, `NamedSnapshotOptions` (`status-paths.ts`).

## For whoever continues

- `src/cli/status-wait-lines.ts` is 388 lines and `src/cli/status-wait-paths.ts` 468, both over the styleguide's 300 before this row (353 and 433). The named-wait lines (`namedLine`, `namedText`, `selectedLine`, `namedClassLines`, `pauseText`, `unsyncedText`, about 170 lines) would move cleanly to their own module, with `noDaemonText`, `lapseText` and `worktreeText` exported for both; not done here, since it moves imports in seven test files other rows may touch. 011-29, which edits `waitText` in the same file, or a quality pass is the place.
- `evals/lib/transcript.mjs`'s `SQUEAL_EVIDENCE` keeps no `Selected:` or `Named test files` line when it trims an output over 8,000 characters. The short named text is far below that; with `--full` on a large worktree it may not be. Unchanged here, as before this row.
