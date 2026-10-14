# 009 wave 1: the events, install and status

009-12 and 009-13 run in parallel on 0.1.170; 009-14 reviews wave 0 at the same time (precedent: 007-16), and its findings fold into these rows or a fix wave. Read `docs/vision.md`, `docs/styleguide.md`, `../spec.md` and every 2026-10-14 line of `../status.md` first. Pi runs only through `test/helpers/pi.ts` (isolated `HOME`, `TMPDIR`, `PI_CODING_AGENT_DIR`; `research/wave-0-checks.md`). Never run `pi` any other way as the agent user, never touch `~/.pi`. Do not run `npm run build` in your worktree; leave `plugins/*/dist`, `package.json` versions and `src/core/keys/key-format.ts` alone. The coordinator rebuilds and re-pins at integration.

## 009-12 the Pi events

Outcome: the extension delivers, blocks and speaks at the end of a run as D3 says, proven against the real Pi 1.0.4 with the fake provider (goals 1 to 6).

- Spec: D3 (all of it), D4, D9; research `pi-extension-events.md` 2 to 6.
- Shape: slice.
- Seam: `src/harness/pi/extension.ts` and `worker.ts` (the `boundary` request exists, unwired). First edit: type `api.ts` against `@earendil-works/pi-coding-agent`'s exported types (now a devDependency; type imports only, the bundle must not import it), then `turn_end` with tool calls returning one `custom_message`.
- Then: `before_agent_start` (the primer from `src/harness/shared/primer.ts` with the D7 command as a `sections.squeal`; `startTurn` news as `message`), `input`, `tool_call` (`edit`/`write` deny by `peek`; `bash` and 005 D8's test-command deny), `agent_before_settle` with Squeal's continuation flag, `agent_settled` ending an aborted turn. Every handler has a deadline (D4) and never throws.
- Owns: `src/harness/pi/**`, `test/harness/pi/**`, `test/integration/pi*.test.ts`. A change under `src/harness/shared/` only if the Pi call cannot be made otherwise; name it in your report, Claude Code and Codex suites unchanged.
- Leaves alone: `src/cli/**`, `install.sh`, skills and `plugins/pi/README.md` (009-13).
- Done when: with real Pi in `-p`, `json` and `rpc` through `runPi` and the shipped bundle built into a temp outdir (never into `plugins/`): a `PASS -> FAIL` reaches the next request after the tool call; three parallel calls deliver once; a final `turn_end` delivers nothing and the settle continuation carries it once, then silence; `edit` blocked once then re-issued; the primer in every request and after `compact`; a dead daemon and a missing store are silent and `pi -p` exits promptly; lint, typecheck, full suite green.

Use /worker.

## 009-13 install, status and the texts

Outcome: a user with only Pi runs `install.sh` and gets Squeal in Pi and the `squeal` launcher; `squeal status` in a Pi shell where the extension never ran says so (goal 8, D1, D7).

- Spec: D1 (install), D7, open question 3; 005 D3 for `install.sh`'s rules; 002 D6 for the status line.
- Shape: slice.
- Seam: `install.sh`: for `pi` on the PATH, take `plugins/pi/` from this release tag's source archive (`https://github.com/hearsay-tools/squeal/archive/refs/tags/squeal--v<version>.tar.gz`; the repository is public and `dist/` is committed), unpack it to `${XDG_DATA_HOME:-~/.local/share}/squeal/pi/<version>/`, `pi install` it, record it for `--uninstall`; with only Pi, the launcher comes from that directory. Then `src/cli/pi/status.ts` beside `src/cli/codex/status.ts` for `PI_SESSION_ID`.
- Owns: `install.sh`, `test/install-sh*.test.ts` and `test/install-fixture.ts`, `src/cli/pi/**`, the Pi line in `src/cli/status-command.ts`, `test/cli/pi*.test.ts`, `plugins/pi/README.md`, the Pi note in `plugins/claude-code/skills/squeal/` sources, `README.md`'s install section.
- Leaves alone: `src/harness/**` (009-12).
- Install tests never run the real `pi`: a stub `pi` on a temp PATH records its arguments, as the existing tests stub `claude` and `codex`.
- Done when: install, update and `--uninstall` with Pi alone and with all three harnesses; the archive URL answered (a HEAD request) or the fallback named in `research/wave-0-checks.md` under open question 3; the status line test; lint, typecheck, full suite green.

Use /worker.

## 009-14 review of wave 0

Shape: review. `/reviewer` over wave 0's landing, `a19b6638..8d401144` (009-10, 009-11, the key re-pin). Focus: D4, that no Squeal call can hold Pi past its deadline or keep Node alive (the worker's `unref`, timers, a worker that never starts); idempotent registration and `reload`; `session_shutdown` reasons; the fixture's isolation (`test/helpers/pi.ts` against `research/wave-0-checks.md`); `plugins/pi/` as a Pi package (manifest, peers, bundle imports). Write `docs/specifications/009-pi-adapter/reviews/wave-0.md`.

Use /reviewer.
