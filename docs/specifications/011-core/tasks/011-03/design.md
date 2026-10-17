# 011-03: named demand, a draft C-section for the human's review

Board row 011-03 (gh-14, gh-17; issues #14, #17). Digest group A, decided by the human 2026-10-17: promotion allowed, design first. It revises 005-11's "a named-file wait does not move the file forward in the queue, not for now" (the human, 2026-10-13). Sources: `../../../001-core-loop/research/issue-14-named-wait.md`, `issue-17.md` and their probes. Drafted by the coordinator, 2026-10-17. Nothing here is in `spec.md` until the human accepts it. On acceptance the section goes in as C15, C4 step 4 gains the cross-reference sentence at the end, 005 D2's "reads only" clause points to C15, `status.md` gets a dated line, and the code rows at the end go on the board.

Assumes 005-67 (running): a listed test-file path selects only itself.

## C15. Named demand

A named wait (`squeal status --wait <ms> <path>...`, 005 D2) tells the daemon which files the agent is waiting for, and the daemon runs them sooner. It changes only the order in which queued files are taken. It does not change which files run, their keys, or whether a result is current, so the verdict is the same as without promotion (principle 2).

**What is promoted.** A path that selects a listed test file by itself promotes that file. A source path's selection is not promoted: it reaches every consumer of the path (79 to 83 files on cezarion, `issue-17.md` 2), which is the queue's ordinary work. A file that is current, running, or not queued is not affected. A promoted file that becomes queued while the wait is open (an edit during the wait) is promoted too.

**Rank.** A promoted file counts as work an edit caused (C4 step 4, first group) and goes before every other class in that group, failing files included. Among promoted files, the earlier request goes first, then C4's order. It still obeys every rule that keeps tiers honest. It joins a tier only when the lane is free. A tier that is not the backlog's shares only with files of comparable duration (001-184), so a promoted file leads its own tier. It counts toward the four first-group tiers after which the backlog gets its turn, so a stream of named waits cannot starve the backlog. A running tier, whether an edit's or the backlog's, is never cancelled or split for promotion: that question belongs to 001-381.

**Lifetime.** Promotion lasts until the wait's deadline or until the selected keys settle, whichever comes first. The request carries the deadline, so a killed CLI leaves promotion in place for at most its own `<ms>`, and no cancel message or lease is needed. Promotion lives in the daemon's memory, and a successor daemon does not inherit it.

**Constraints that still bind.**
- *A claim* (C7): a file whose key another live worktree is running keeps waiting for that run, which will store the result this wait needs. Promotion does not start a duplicate run.
- *A slow file* (004 D2): it leads its own tier's order when the tier runs. Promotion does not make the slow tier eligible while a consumer is in a turn; `squeal run --slow` does.
- *An unlisted revision* (C4, the runner part): no tier starts until the revision is listed, promoted or not.

**What the wait says while a constraint holds a file.** For every selected file that is still pending, the named line gives one reason with its bound when one is known:
- running since HH:MM:SS in its lane;
- queued, promoted, behind the `<lane>` tier running since HH:MM:SS;
- waiting for `<worktree>`'s run of its key, at most until that claim's bound;
- slow, run when the agent pauses or on `squeal run --slow`;
- revision N not listed yet, because the runner part waits for the run in flight, at most N s (gh-17 finding 2, the `runner.timeoutMs` + 66 s bound of C4).

Status counts the checks of a file whose run is open as running, even after a re-key queued it under its new key (gh-17 finding 3: `queued 10, running 0` with the run open).

**Older daemons.** The CLI sends the promotion as a new request (`promote` with the selected test files and the deadline). A daemon that does not know the request answers unknown, and the wait reads only, as before. Nothing breaks, and the order is simply the old one.

**Measured by** a scheduler test from `issue-14`'s probe: with A running, then B and Z queued, a named wait on Z makes Z start before B, and B still runs. Also: a source-path wait reorders nothing, a claimed key waits for its claimant, and the fairness turn still comes after four first-group tiers.

## Rejected options

- **A `--promote` flag.** The wait is already explicit demand, and a flag adds a word the primer would have to teach (005-68).
- **Promotion until the keys settle, beyond the deadline.** An abandoned wait would then reorder the queue for an unbounded time.
- **Cancelling a running backlog tier for a promoted file.** Running work stays intact, as issue 14 asked; 001-381 decides splitting.

## Questions for the human

1. **Rank above failing files.** Proposed: yes, because the agent named this file. The alternative is to rank promoted files after failing files and before direct importers.
2. **Source paths.** Proposed: no promotion. The alternative is to promote up to `runner.tierSize` of the selected consumers, shortest first.

## Code rows on acceptance (011-NN numbers allocated from the board on main then)

- **011-NN promotion.** The `promote` request, its daemon handler and the rank in `src/core/scheduler/queue.ts`. The issue-14 probe becomes a scheduler test, with the claim, slow-file and fairness cases. Version raise, review.
- **011-NN what holds a named file.** The per-file reasons on the named line and the open-run running count (gh-17 findings 2 and 3), in `src/cli/status-wait-lines.ts` and the status counts. Independent of the promotion row apart from the "promoted" word.

## Diagnostics (added 2026-10-17 by the split/triage coordinator: gh-23 and gh-24 folded in by the human)

The human folded two triage rows into this design on 2026-10-17, so one accepted C15 also settles what a wait and status say about each file. Add to the section above, as its last paragraph, and to the second code row ("what holds a named file"):

- **Per-file states in the named wait (gh-23, issue #23).** A named wait that times out lists the selected paths still pending, by class; its text names the selected failures and the known pass or fail outcomes without a `why` call; every `wait.testFiles` entry in the JSON carries `current`, `pending`, `stale` or `unknown` and a verdict when one is known. Counts alone are not enough once more than a few files are selected (the report had eleven).
- **Retained reasons and discovery told from idle (gh-24, issue #24).** A file shown `unknown` keeps the reason it became so where one is known (a withheld run, a failed setup, a key that never ran, a claim another worktree holds), and status says `no reason was kept` only when that is the truth of the store, never as the default for files the daemon has not yet listed; status distinguishes initial discovery (the daemon is still listing or keying files) from idle work that is queued but not scheduled, and names the command that advances each. The reported case: a read-only review session saw 410 files `unknown` with `no result: no reason was kept` beside inherited passes and 93 slow files waiting on another worktree, and could not tell whether anything would happen.

Neither adds a question for the human beyond the two above; both are text and JSON of the named line and status, in the same code row as gh-17's findings 2 and 3. Evidence: `../../research/issue-23.md`, `issue-24.md` (both unreproduced under load; the acceptance tests are their reported cases).
