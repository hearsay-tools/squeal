# Wave 70: rows 011-295 (daemon presence: make the accidental differences consistent) and 011-296 (the Pi end-to-end baseline race)

Coordinator 48454288, 2026-11-05. Version 0.1.405 is planned for both rows. W1 and W2 own disjoint files and run in parallel. W1 runs after 011-294 lands (0.1.404), because both rows touch `harness/shared/ensure.ts`, `cli/start.ts` and `delivery/liveness.ts`. This row changes what users see. The human: "fix the accidental ones - if those are not critical for how things work - let's keep it simple and consistent" (2026-11-04).

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-295 (news and the other readers agree with status)

Use /worker. Shape: slice, test first, one commit per reader.

Outcome: news tells every presence state and note that the header tells, except a late change feed, each change once per consumer; `ps`, hook spawn, `start` and the open-run claim print what status says for the same presence; no spawn, claim, `start` refusal or `ps hung` decision changes.

Read: the board row 011-295; `research/daemon-presence.md` ("Accidental differences" and decision 3 as amended 2026-11-05: "last one died" also comes with "stopped by request"); `GLOSSARY.md`; spec 011 C5 (the header paragraph) and C8 (the Stop news rule of 2026-10-25); `tasks/011-293/notes.md` and `tasks/011-294/notes.md`; the "Inputs" sections of `reviews/0.1.403-r3.md`, `reviews/0.1.404.md` and `reviews/0.1.404-r2.md`.

Seam and lead: `newsChange` in `src/core/presence/views.ts` and `livenessChange` in `src/core/delivery/liveness.ts`. First edit: a news test that a death and a late heartbeat are told once per consumer, worded as the header words them; then make news read them. What a consumer was told (`ToldLiveness`) must hold the state and notes. A stored told value of the previous release reads as today. The previous release's hooks must read a new told value without error; prove both with a test.

Then, one commit each: `ps` (`ps/flags.ts`, `ps/discover.ts` and its text), hook spawn (`harness/shared/ensure.ts`), `start` (`cli/start.ts`), the open-run claim (`status/open-runs.ts`). For each, list in the notes every case where its text differs from status. Fix the accidental ones. Keep every decision. If making a reader consistent would change a spawn, claim, `start` refusal or `ps hung` decision, keep today's decision, skip that case and send the coordinator a request with the case.

Keep the JSON payload byte for byte (design decision 4). Keep the I/O rule: `test/presence/reads.test.ts` stays the owner. Change an expected list only where this row's new text needs a new read, and name each change in the notes.

Owns: `src/core/presence/**`, `test/presence/**`, `delivery/liveness.ts`, `delivery/format.ts` and `delivery/header.ts` (wording only), the four reader files above and their text helpers, and their tests.

Done when: the row's done-when holds. A test per changed reader shows that its text agrees with status for the same presence. No existing spawn, claim, `start` or `ps hung` test changes. A late change feed still starts no delivery. The told-value test passes across versions. Lint and typecheck pass. Notes are in `tasks/011-295/notes.md`, with the C5 and C8 sentences to amend (the coordinator edits the spec).

## W2: row 011-296 (the Pi end-to-end baseline waits for a losing daemon to exit)

Use /worker. Shape: repair, test only.

Outcome: the Pi fixture's `daemon()` reports the daemon after a losing second daemon has exited, so `test/e2e/pi.test.ts:88` and `:130` count one process.

Read: the board row 011-296; `tasks/011-294/notes.md`, section CI1.

Seam and lead: `daemon()` in `test/e2e/pi-fixture.ts:159-164`. Poll `daemonPids(this.plugin)` until one process remains, bounded well inside a losing daemon's 30 s lock wait (`src/core/daemon/lock.ts:76`); then ask status as today. Two processes left at the bound still fail the test.

Owns: `test/e2e/pi-fixture.ts`. Leave alone: every product file; `test/e2e/support.ts`, which the OpenCode fixture shares (send a request first); W1's files.

Done when: the fixture is the only changed file. `test/e2e/pi.test.ts` passes locally with `npm_config_cache` pointed at a private `/tmp` directory, so the real `~/.npm` stays untouched. Lint and typecheck pass. Notes are in `tasks/011-296/notes.md`.
