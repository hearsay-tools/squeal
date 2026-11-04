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
