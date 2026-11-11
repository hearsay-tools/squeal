# Spec 018 wave 11: local tests on CI's Node

The human, 2026-11-11: "Node fix: 1: use project's pinned Node, 2: clear warning only". Spec D18 and D19. Evidence: all 11 cezar daemons on this host run Node 24.22.1 (the cockpit's PATH) while cezar's CI and its published results use 26.13.0, so 0 of 195,943 fetched results count (`status.md`, 2026-11-11).

## 018-30 the daemon runs on the project's pinned Node (D18)

Use /worker. Shape: slice.

Outcome: in a worktree whose `.node-version` (or `.nvmrc`) names an installed exact version, the daemon process runs on that Node, with its directory first in the daemon's `PATH`, whatever Node the hook or CLI runs on.

Read: `spec.md` D1, D18; `src/core/daemon/ensure.ts` (`ensureDaemonProcess` spawns `process.execPath`); every other place that starts the daemon (search `"daemon"` spawns and relaunches, `src/cli/*`).

Starting seam: a new `src/core/node-pin.ts` that reads the pin and finds the installed binary (nvm `$NVM_DIR` or `~/.nvm/versions/node/v<ver>/bin/node`, fnm, volta, asdf, mise, n, then `PATH`), each candidate checked by running it with `--version` once (cache per daemon start); `ensure.ts` spawns that binary and passes the adjusted `PATH`. `node: "session"` in `squeal.config.json` turns it off. Nothing installs or downloads.

Owns: `src/core/node-pin.ts` (new), `src/core/daemon/ensure.ts`, the other daemon-start call sites you find (name them), the config schema entry for `node`, their tests. Peer spec 021 (coordinator 52f4f62a) is changing `src/core/daemon/daemon.ts`, `lifecycle.ts`, `src/cli/{start,runner-host,...}.ts` and a new `src/core/runner-host/`: if a start path you need is in those files, stop and tell me before editing.

Done when: tests with a fake installed tree (temporary HOME with an nvm layout holding a script that prints a version) show the daemon started with the pinned binary and `PATH`, the fallback on no pin, a range, a missing version and `node: "session"`; lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite; no real HOME.

## 018-31 status names a Node mismatch for shared results (D19)

Use /worker. Shape: slice.

Outcome: when `shared.ref` is set and imports differ from the daemon's environment only (or also) in Node, status says once which Node the results need, which the daemon runs, and why the pin was not used (no pin, a range, not installed, `node: "session"`).

Read: `spec.md` D5, D15, D19; `src/core/status/import-lines.ts`, `src/core/status/imports.ts`, `src/core/keys/environment-descriptor.ts` (`describeDifferences`).

Owns: `src/core/status/*` import lines and their tests. Takes the "why not used" reason from a small function 018-30 exports in `src/core/node-pin.ts`; until it lands, write against that function's agreed shape `pinnedNode(root): { binary: string } | { reason: "none" | "range" | "missing" | "session"; wanted?: string }` and coordinate through me.

Done when: status tests show the one line for a Node-only difference and the reason variants, silent when Node matches; lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.
