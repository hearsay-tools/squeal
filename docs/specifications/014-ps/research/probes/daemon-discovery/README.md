# Probes for 014-01 daemon discovery

Throwaway. Written for `../../daemon-discovery.md` on 2026-10-21, Linux 6.8, Node 24.21.0 (SQLite 3.53.4), Squeal 0.1.235 at `9060a96c9`. Nothing here is product code or a test.

Every probe reads the live host without connecting to a daemon socket, without opening a store for writing and without signalling a process it did not start. Stores are opened with `new DatabaseSync(path, { readOnly: true })`, never with Squeal's `openStore`.

- `p1-rename-socket.mjs <dir>`: a server that binds at a staging name and renames it into place, as `server.ts` `bindAt` does. Shows that `/proc/net/unix` keeps the staging name and that `ss -xlpe` prints the file's VFS inode (`ino:`).
- `p2-live-discovery.mjs`: socket files, `ss -xlpe`, a `/proc` scan for daemon command lines.
- `p3-live-locks.mjs <dir>...`: `/proc/locks` holders of the lock files and pool permits in the directories given.
- `p4-readonly-store.mjs <scratch dir>`: what a read-only connection does to a WAL store with a writer holding the write lock, and to a newer `user_version`. Scratch only.
- `p5-live-store-work.mjs <git-common-dir>...`: what each store says about its live daemons' work, read-only.
- `p6-own-daemon.sh` (+ `p6-row.mjs`): one scratch daemon of the installed 0.1.234 bundle, a 0.1.235 lock waiter, SIGSTOP, SIGKILL, then a 0.1.235 daemon stopped by SIGTERM. Under `/tmp/sq-014-01-p6` with its own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `TMPDIR`; removes it at the end.
- `p7-costs.sh`: wall time of each read, five runs, with the load.
- `p8-pipeline.mjs`: the recommended pipeline end to end.
