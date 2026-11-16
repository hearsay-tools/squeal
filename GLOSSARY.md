# Squeal

Squeal runs a repository's affected tests in the background after each edit and tells coding agents what changed. This glossary names the domain's concepts; specs under `docs/specifications/` hold the rules.

## Daemon

**Daemon presence**:
What is known about a worktree's daemon at one moment: whether it validates, starts, stops, rests, was stopped by request, or is gone, and since when. Every reader takes it from one place.
_Avoid_: liveness, daemon facts, daemon state (when you mean all of this)

**Presence view**:
The reading of daemon presence for one audience (status, a delivered header, news, a wait). Views differ only by rules written beside each other, such as "status says down while the daemon rests".
_Avoid_: reader layer, liveness stack

**Presence state**:
The one main state daemon presence is in, from a closed set, highest priority first: validating, stopping, starting, stopped by request, resting, heartbeat late, gone. Notes may come with it: last one died, handoff ended short, change feed late.
_Avoid_: alive, down (these are the older two-valued reading, kept only in the status payload)

**Resting**:
The daemon stopped because it was unused, and no hook has started its successor yet. It is not a warning.
_Avoid_: idle stop, quiet stop

**Stopped by request**:
`squeal stop` stopped the daemon, until the next edit or, with `--until-start`, until `squeal start`.
_Avoid_: held stop

**Gone**:
No daemon validates and nothing explains why: no stop, rest, start or late heartbeat applies.
_Avoid_: dead (a death is the note "last one died"), down

**Presence event**:
Something a daemon, a hook or the CLI reports about a daemon (registered, beat, exiting, rested, spawned, stopped by request). Presence is built only from these events.
_Avoid_: mark (when you mean the event, not its stored form)

## Progress

**Progress record**:
What the daemon keeps per worktree about how far it has got: the refined revision, an install it waits for, an open checkpoint, a HEAD that moved with no file change, and the end of its start scan. Each has one owner, which alone knows how it is stored and what a missing value means.
_Avoid_: progress facts, meta row (when you mean what the record says)

**Refined revision**:
The newest revision whose runner part the daemon has applied, or counted as applied after it failed. A revision after it is pending. With none recorded, no revision is pending.
_Avoid_: taken-in revision, listed revision (the listing is a record of its own)

## Results

**Run evidence**:
What is known about one finished run that decides whether its results may be saved: which test files completed, whether each file's inputs held still from before the run to its end, and what the run read or loaded beyond them.
_Avoid_: stability check, completion barrier (each is one part of it)

**Store decision**:
The answer for one test file of a finished run, from a closed set: save its results at the key it ran under, save them at a grown key, run it again, or discard them. Each comes with its reason.
_Avoid_: keepable, verdict

**Observed read**:
A file a test read during a run that is not among its known inputs. Once recorded, it is one of the test file's inputs.
_Avoid_: growth (the code's word for the observed reads one run adds)

**Touched input**:
An input written during a run whose bytes ended as they were. The run may have read other bytes, so its result is not saved.
_Avoid_: unchanged (it is not the same as never written)

**Keep**:
`squeal code` saves the results of a test file it ran at the key a daemon would give that file, so the next run and a daemon read them.
_Avoid_: cache

## Requests

**Request**:
An explicit ask a command or a named wait sends a daemon to run or reorder test files now: `squeal run --all`, `squeal run <group>`, `squeal run <group> <path>...`, `squeal retry`, a named wait's promotion or focused checks, an import's observed reads. Edits are not requests.
_Avoid_: job, command (when you mean what the daemon takes)

**Request intake**:
The one place a daemon's scheduler takes every request. It applies the rules all requests share, in one fixed order: the start or install-wait answer, the runner work the request waits for, the store write tried again while the store is busy, the record of the files the request asked for, waking the lanes, and starting work. A request states only what it queues and what it answers.
_Avoid_: request handler, entry path

**Covered files**:
The test files a request covers, as the scheduler decided them when it took the request: each queued, already current, or not queued with the reason. They are what the request's progress counts and what a wait on the request waits for.
_Avoid_: the request's files (when guessed from a lane or a group afterwards)

## Starting tiers

**Start facts**:
What decides whether tiers may start, as known at one moment: whether the daemon stops or its runtime went, whether a hold holds, whether it waits for an install or the install went, whether runner work is pending, the tiers in flight, and each lane's queued files and request. The facts that live on disk or in Git (the runtime folder, the index's unmerged paths, the install) are read again after every wait, before a tier starts.
_Avoid_: conditions, state (when you mean these facts)

**Admission**:
The answer, for every lane at one moment, whether a tier may start in it now, whether it may take one file or several, and if not, why, from a closed set of reasons. One place answers it from the start facts, and every path that starts a tier or reports work acts on it. An answer read before a wait is not acted on after it.
_Avoid_: may-start check, gate. Request intake answers whether a request is taken; admission answers whether a tier starts.

**Tier**:
The test files of one lane that one run starts together. Its kind says what may stop it: an edit's, the backlog's, the backlog's turn, a named wait's batch, a focused one, a slow one.
_Avoid_: batch (a batch is a named wait's files, which one tier may hold)

**Tier plan**:
The answer to "which tier starts next in the fast lanes, and if none, why": the candidate tiers in order, each with its files, its width, its estimated duration and its reason, or the reason nothing starts and when to look again. It writes nothing. The pump starts its first candidate that the pool grants; a refusal takes the next candidate.
_Avoid_: selection pass, select (when you mean the plan, not the act of starting)

**Queue view**:
The queue a tier plan is made from, given to it as a value: the daemon's queue as it is, or a queue that does not exist yet, such as the queue after a yield. The plan's questions about saved results, claims and the pool are answered beside it, by the daemon or by a table.
_Avoid_: snapshot (it is read as the plan goes, not copied first)

**Yield**:
A running tier stops so queued work starts sooner, and its unfinished files go back to the queue. A yield happens only when the waiting file would start sooner, by the tier plan over the queue after the yield.
_Avoid_: give way (the plain-language name in decision cards), cut (the files a yield puts back), cancel (also a stop, by `squeal stop` or a superseding revision)

## Deciding what runs next

**Scheduler step**:
The one synchronous decision of what the scheduler does next, from the scheduler events since the last step, one clock reading and the start facts. Its rules are written in one fixed order, and it returns scheduler decisions and the next wake.
_Avoid_: pump (the loop that carries the step out), tick, pass (a reconciliation pass is something else)

**Scheduler event**:
Something that happened that the scheduler step must see, from a closed list: a revision arrived, runner work was applied, a request was taken, a file or a tier ended, a wake came. An event reaches the step whole; which rules it touches is decided inside the step. A step outside the pump's loop sees the revision, the applied runner work and the request as they are; the pump's own step sees each of them only as "asked", because the step that saw it whole has already run.
_Avoid_: notify, signal

**Scheduler decision**:
What a scheduler step returns for the loop to carry out, from a closed list: start a tier, check the tiers in flight for yields (one decision: it stops the tiers that yield and writes the yield record), read the install stamp, close a lane's runner, and the like. Each kind is carried out either inside the step's lock turn or after it. A rule's own answer, such as a slow lane's, a yield rule's, a hold's or a slow release's, is not a scheduler decision: the step reads it and returns decisions from it.
_Avoid_: action, effect, command

**Wake**:
The time a part of the scheduler next needs to look, with its reason, stated as a value: a delay, kept on elapsed time. The scheduler keeps one timer, at the earliest wake.
_Avoid_: timer (the one mechanism behind every wake), recheck, poll

**Calendar time**:
The clock reading that answers "what time is it": milliseconds since the epoch, the host's wall clock. Every time that is stored, or compared with another daemon's or process's, is calendar time: claims, holds, notes, revisions, status "since". A person or the system can set it back or forward.
_Avoid_: wall time, now (the method that reads it), timestamp

**Elapsed time**:
The clock reading that answers "how long has it been": milliseconds from an origin of the daemon's own, which never goes back and which a change of calendar time does not move. Every wake is stated as a delay and kept on it, so a calendar change moves no wake. A wait that compares a calendar time counts on it too: when the calendar is set back or forward, the daemon moves the calendar times it keeps for its waits by the same amount, and counts a stored time from when it first saw it (row 011-377). Among the scheduler's waits, one still moves with a calendar change: a command hold's end, which `squeal hold` stores and status reads on the calendar. Outside the scheduler, the lint pass's copy of the quiet after an edit (`src/core/lint/pass/idle.ts`) still compares the stored revision time; board row 011-382 holds it.
_Avoid_: steady time, ticks, monotonic time, duration (a span, measured on either)

**Rest**:
The scheduler has nothing to do until a scheduler event or its next wake: no step runs, none of its own work is in flight, and the lock is free. A test run that is still running does not end a rest; only its end does.
_Avoid_: idle (the scheduler's queue is empty and nothing runs), quiet (the backlog's wait after an edit), settled

## Waits

**Wait**:
A command's hold until the test files or lint checks it is for have results, or until something ends it first: its deadline, no daemon, or a hold on the worktree. A wait ends with one outcome and its reason.
_Avoid_: poll, loop (these are how a wait reads, not what it is)

**Status wait**:
A wait that `squeal status` runs: on the test files an edit re-keyed (`--wait`), or on the files that named paths select (`<path>`, with or without `--wait`).
_Avoid_: edit wait (when the named form is meant too)

**Run wait**:
A wait that a `squeal run` command runs once the daemon took its request: on a checkpoint, on a group's test files, or on a group's lint checks.
_Avoid_: checkpoint wait (that is one kind of run wait)

**Wait outcome**:
Why a wait ended, from a closed set for each kind of wait, with its reason: for a run wait, ended, deadline, on hold, stopped, moved or abandoned. Which outcome wins when several hold is a rule of the wait, written beside the other waits' rules.
_Avoid_: verdict (the pass or fail of the files), result (a check's)

## Runners

**Lane**:
The runner instances that run one tier of test files at a time between them. Each test file waits in one lane, and tiers of different lanes run at once: Vitest's fast instance is one lane, its slow instance another, and every node:test project together a third.
_Avoid_: queue, instance (one lane may hold several instances in turn)

**Runner traits**:
What a runner kind states, once, about how its test files may be scheduled: the lane a file waits in, how many files one run starts at once, which part of a tier a file runs in, whether a file may start beside catch-up work, how many files one catch-up slot holds, whether it can run single tests of a file, and how many test files its listing left out. Every layer between the scheduler and the runner carries them whole. They are never part of a test file's key.
_Avoid_: scheduling hints, scheduling answers, optional members

**Report merge**:
How the reports of a run's parts become one run report, by one rule per report field. A part is the share of a tier that one runner, or one machine, ran.
_Avoid_: combined report (when you mean the rules), merge (when you mean only the function)
