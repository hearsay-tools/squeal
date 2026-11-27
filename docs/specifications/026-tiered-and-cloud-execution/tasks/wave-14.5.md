# Spec 026 Wave 14.5: repair row `026-37` after review 0.1.658 (B1–B5, N1)

Shape: **repair**. Use /worker. Read `reviews/0.1.658.md` first: each blocker names its proof, its fix and its regression test. Your base is `cand/0.1.658` plus the review file; keep row 026-37's design (`tasks/wave-14.md`).

## Fixes

- **B1** Add an optional `signal` to `RemoteMachine.release` (`provider.ts`) and pass it to the Agent37 DELETE (`providers/agent37/machine.ts` and its API client) and to the command provider's hook process (kill on abort). The prune passes its signal; abort keeps the record. Test with a real loopback socket and a real child hook.
- **B2** One presence check shared by prune and `releaseOnce`: `gone` only when `lstat` (or `stat`) fails with `ENOENT`/`ENOTDIR`; any other error is `unknown` and keeps the record (logged). Unprivileged `EACCES` regression for both sites.
- **B3** Before each release, read the current record and check its path again; release only if the record still has the same machine `id` and the path is still gone. Forget only that exact record (compare `id` inside the registry write lock: e.g. `forgetMachine(key, env, { id })`). Tests: path recreated before its turn; record replaced during an in-flight release.
- **B4** A nonblocking registry write for the background prune: try the lock once; when busy, retry later on a timer (abortable), never `Atomics.wait` on the daemon thread. CLI paths keep the existing lock. Test: a 10 ms timer stays on time while another process holds the lock; abort during the wait.
- **B5** Isolate `HOME`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` in every test helper that can start a real CLI daemon (`test/e2e/harness.ts`, `test/e2e/plugins.ts`, `test/harness/bundle-helpers.ts`, `test/daemon/helpers.ts`, and any other the review or a grep finds). Add a CLI-level sentinel test: a fixture daemon cannot run a release hook or change a registry outside its sandbox.
- **N1** (coordinator decision): new records store `scope` = host name plus the mount-namespace id (`/proc/self/ns/mnt` link target where readable, else host name alone). The automatic prune (daemon start and `releaseOnce`) acts only on records whose `scope` equals this process's; records without `scope` (written before this row) are acted on, because every such record today comes from the host that reads it; a daemon that touches a record without `scope` and keeps it writes its own `scope` into it. `squeal remote prune` (manual) keeps acting on every record, and prints the scope of a foreign record it releases.

## Owns

The files of row 026-37, `provider.ts`, `machines-store.ts`, `providers/agent37/*` (release path only), `providers/command*` (release path only), and the test helpers in B5 with their tests. Do not run `pnpm run build`; do not edit `docs/board.md`. Give direct vitest runs a timeout.

## Done when

Every regression case in the review's "Inputs for the repair wave" passes; existing remote, prune, machine-share, CLI and e2e helper tests pass; lint, typecheck and `squeal status --wait 60000 <changed paths>` show no failure your change causes.
