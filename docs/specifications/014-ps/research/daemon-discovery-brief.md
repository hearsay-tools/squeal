# Research brief 014-01: finding every daemon and what it can say

Use /researcher. Shape: research. Outcome: how `squeal ps` lists every live Squeal daemon of the user on the host, with its identity and current work, preferably without a new registry. Follow the rules in `README.md`.

Read first: 011 C1, C7 (the `worktrees` row records socket, start, heartbeat and version, but no pid), C9 (lock, socket, step-down, exit rules), C10 Capacity (the pool in `$XDG_RUNTIME_DIR/squeal`); `src/core/store/schema.ts`; `src/core/daemon/{protocol,server,client,handlers,ensure,paths,lock}.ts`; `src/cli/{daemon-access,stop,remove,status-command}.ts`.

Questions:

1. **Sources.** Compare (a) the `squeal-<hash>.sock` files, and the fallback socket directory outside `XDG_RUNTIME_DIR`; (b) a `/proc` scan for daemon command lines; (c) the stores, and where a list of repositories would come from; (d) the pool's lock files and marks; (e) a small new per-user registry. For each: what it misses (a daemon of an older release, one started by hand, one in step-down, a socket a SIGKILL left), and its cost at 20 daemons.
2. **Identity.** From each source: pid, root, repository, version, start time, the plugin cache it runs from, whether the root and `<common-dir>/worktrees/<name>` still exist. Can a socket be tied to a pid without connecting (`/proc/net/unix` inodes)?
3. **Work.** What the store says without a daemon: pending, a running tier, its lane and files, a checkpoint, consumers and their harness processes, heartbeat age, the idle and unused exit clocks. What needs a socket request? Which requests exist, which have side effects, and which one is read-only and safe against a daemon of another release?
4. **Versions.** Can a newer `squeal ps` read an older or newer store read-only without a write lock (C7 `user_version`)?
5. **macOS.** What replaces `/proc` for (a) and (b)?

Own `daemon-discovery.md` and `probes/daemon-discovery/`.
