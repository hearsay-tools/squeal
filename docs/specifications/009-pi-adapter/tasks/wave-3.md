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

Outcome: `lessons.md` resolves spec 009's open questions with evidence from real models using Squeal in Pi: does a `PASS -> FAIL` reach the agent and change what it does, does it leave the tests to Squeal, does it read a Squeal message as Squeal's and not the user's (open question 2), and does an update with a session open behave as 009-18 says.

- Read: `../spec.md` goals 1 to 8, `../status.md` (every 2026-10-14 line, the human's dogfooding decision last), `../research/pi-sessions-and-packaging.md` 1 and 2, `test/e2e/pi.test.ts` and `test/helpers/pi.ts` for how Pi is isolated and driven, 002's and 007's `lessons.md` for the report's shape.
- Shape: proof. You are the judge; the sessions you start are the users.
- Where: only as `squeal-e2e` (`sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H env -i ...`, cwd `/`; Pi 1.0.4 is in its `~/.npm-global`). Its own `PI_CODING_AGENT_DIR` under `/home/squeal-e2e/dogfood-009/`. Never the agent user's `~/.pi`, never the real `claude` or `codex`. The key goes by name only; a Pi `models.json` provider names the variable, never its value (`docs/custom-provider.md`, `docs/models.md`).
- Provider and models: `cliproxy` at `https://cliproxy.home.jarka.pl/v1`. `claude-haiku-5-5` for sessions where only the daemon is observed; `claude-sonnet-5-5` for an ordinary task where the agent's reading of Squeal's messages matters; `claude-opus-5-5` for the trust question (does it trust the report or run the suite itself; does it treat the custom message as a user instruction). Never Fable.
- Install as a user would: `install.sh` of 0.1.172 (`git show c4c59482:install.sh`) with `SQUEAL_SOURCE` pointing at a local `git archive` of that commit, then, with a TUI session open (tmux), `install.sh --pi` of 0.1.173 from an archive of `3fd4916d`: what the open session does, then after `/reload`.
- Project: a real open-source TypeScript library with a Vitest suite of 50 to 300 test files, cloned at a pinned commit into the user's home, with `squeal setup` run in it. Name it and why.
- Sessions: at least one Cezar-shaped `rpc` session (a copy of the installed Cezar `PiRunner` driving Pi, as `research/probes/pi-sessions-and-packaging/cezar.mjs` did), including an idle wake; one TUI session; per model as above. Record the load average beside every timing; start sessions only below the host's CPU count.
- Defects: write each into `lessons.md` with its evidence and a proposed row. Fix nothing in `src/`.
- Owns: `docs/specifications/009-pi-adapter/lessons.md`, `docs/specifications/009-pi-adapter/dogfood/**` (scripts and condensed logs; no key, no session file with secrets).
- Done when: `lessons.md` answers open question 2, goals 1, 3, 5, 7 and 8 observed with real models, the update behaviour, and each defect; nothing of the run is left running; the `squeal-e2e` home holds only `dogfood-009/`, the clone and the npm prefix.

Use /worker.

## 009-22 review of waves 2 and 3

Shape: review. `/reviewer` over `cf1e952c..3fd4916d` (0.1.172 and 0.1.173: 009-15, 009-16, 009-18, 009-19; the B1 commit `02249f23` is already settled by `reviews/wave-1.5.md`). Focus: D5's idle wake never holds Pi, is cancelled by input, a new run and shutdown, and arms only in `tui` and `rpc`; the shared waiter's new `signal` and `command` leave Claude Code's behaviour unchanged; `squeal update` and `install.sh --pi` against 005 D3's rules (only what the record owns is removed, the kept previous directory, the `ps` in-use check, the transition before a `--pi` release); whether the e2e's 15 s held request makes the deny scenario flaky under load; `runPi`'s isolation. Build only in a temporary detached worktree at `3fd4916d`, removed after. Write `docs/specifications/009-pi-adapter/reviews/wave-3.md`.

Use /reviewer.

## 009-23 review 009-22's notes

Use /worker. Shape: repair. Outcome: the three notes of `reviews/wave-3.md` (S1, S2, N1) are closed, each by a regression.

Read: `reviews/wave-3.md` sections S1, S2, N1 and "Inputs for the next wave"; spec D1 (updates) and D8 (e2e).

- **S1.** Starting seam: the fake provider under `test/fixtures/pi/`; add an optional per-request release file, so `test/e2e/pi.test.ts` holds request 1's model response until it has seen the regression, and holds the re-run until that request starts. Bounded waits, cleanup on abort. The 15 s window goes; the error-result and re-issue assertions stay.
- **S2.** `install.sh:227`'s message also says an open Pi session whose old package has no running daemon must `/reload` before a second update. Add the reviewer's two-update real-session regression (runPi isolation, local fixture archives). No new retention mechanism.
- **N1.** Launcher format 3 in all three launcher copies, with a regression that starts from the 0.1.172 launcher (format 2) and shows `squeal update` recopies it.

Owns: `test/fixtures/pi/**`, `test/e2e/pi*.ts`, `install.sh`, the three launchers, their tests. Leave alone: `src/harness/**`, `plugins/*/dist`, docs outside this spec's `notes`. Do not run `npm run build`; if a guarded key source moves, say so and leave the pin to the coordinator.

Done when: each note has a test that fails before your change; Pi tests green on Node 22 and 24; lint, typecheck, `npx vitest run` green apart from known reds.
