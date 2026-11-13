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
