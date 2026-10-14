# 009 wave 3: updates and proof

009-18 and 009-19 run in parallel on 0.1.172, beside the re-review 009-21. 009-20 (dogfooding) waits for both and for the human's go (it installs Squeal into a real Pi). Read `docs/vision.md`, `docs/styleguide.md`, `../spec.md` and every 2026-10-14 line of `../status.md` first. Pi runs only through `test/helpers/pi.ts`'s isolation; never touch `~/.pi`; never run the real `claude` or `codex`. No `npm run build` in your worktree; leave `plugins/*/dist`, versions and `src/core/keys/key-format.ts` alone. Check Pi tests on Node 22 as well (`~/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run <files>`).

## 009-18 updating Squeal in Pi

Outcome: `squeal update` brings Pi to the newest release, and an open Pi session survives an update safely and runs the new version after `/reload` (the human's question, 2026-10-14; board row).

- Spec: D1 (install), D4, D7; 005 D3 (`install.sh`, `squeal update`); `status.md` wave 1 line on `install.sh`.
- Shape: slice.
- Seam: `src/cli/update.ts` (`UPDATE_COMMANDS` has only Claude Code and Codex). First edit: a Pi entry that installs the newest release in Pi the way `install.sh`'s `install_pi` does; reuse `install.sh` itself if that is simpler and honest (it is pinned to its release, so fetch the latest release's script, as the README's command does). Then `install.sh` keeps the previous version's directory (one back) instead of deleting every older one, so an open session's worker can restart and its primer's CLI path still exists; it says to `/reload` open Pi sessions. The launcher's Pi message names `squeal update`.
- Owns: `src/cli/update.ts`, `test/cli/update*.test.ts`, `install.sh` and `test/cli/install-sh*.test.ts`, `test/cli/install-fixture.ts`, the three `squeal-launcher` copies and `test/cli/launcher.test.ts`, `README.md`'s update lines, `plugins/pi/README.md`.
- Leaves alone: `src/harness/**`, `test/e2e/**` (009-19).
- Done when: with stub `pi`, `squeal update` installs a newer Pi package and keeps exactly one previous directory, with Pi alone and with all three harnesses; an update while the previous directory is in use leaves it in place; lint, typecheck, full suite green.

Use /worker.

## 009-19 end to end with the shipped Pi package

Outcome: the Pi package as it ships (copied from HEAD's tracked files, as `test/e2e/plugins.ts` copies the other two) installed with real `pi install` into an isolated agent directory validates a fixture repository: baseline, a `PASS -> FAIL` in the next model request, the deny, a wake in `rpc`, silence with no daemon (spec Testing, end-to-end bullet).

- Spec: Testing; goals 1 to 8; `research/wave-0-checks.md` (an e2e that spawns Pi another way must isolate `HOME`, `TMPDIR` and the agent dir itself).
- Shape: slice.
- Seam: `test/e2e/pi.test.ts` (new) with `copyPlugin` from `test/e2e/install.ts`. First edit: a `runPi` option (or a sibling helper in `test/helpers/pi.ts`) that runs `pi install <copied package>` inside the run's agent dir before Pi starts, so the extension loads from Pi's settings, not `-e`.
- Owns: `test/e2e/pi*.test.ts`, `test/e2e/pi*.ts`, additive changes to `test/helpers/pi.ts` (name them).
- Leaves alone: `src/**`, `install.sh`, `src/cli/**` (009-18).
- Done when: the e2e file passes locally on Node 22 and 24 and in CI on your pushed branch (report the run); the daemon it starts is the shipped one from the copied package; lint, typecheck, full suite green.

Use /worker.

## 009-20 dogfooding

Waits for 009-18, 009-19 and the human's go: it installs Squeal into a real Pi with real model credentials, which no isolated run can. A Cezar worker on Pi and a TUI session working this repository, on models the brief names per session (board, Standing models); whether a model reads a Squeal message as Squeal's and not the user's (open question 2); update with a session open. Report in `../lessons.md`. Brief written at dispatch.
