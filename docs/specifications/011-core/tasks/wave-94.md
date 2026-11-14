# Wave 94: rows 011-343, 011-344 and 011-345

Coordinator cdd216e5, 2026-11-14. The human's answers of 2026-11-14 to the card after rows 011-44 and 011-45 landed: "Approve the row" (retry-receipt-wording, now 011-343), "Approve the row" (wait-sync-abort, now 011-344), "Approve, after 011-339" (kept-header, now 011-345; 011-339 landed as 0.1.497). Three rows on disjoint seams, in parallel.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION` (stop and ask if key-format asks for a raise).

## W1: row 011-343, `squeal retry`'s receipt says the retry joins the queue, and names the wait

Use /worker. Shape: repair, test first. Effort medium.

Read: board row 011-343; `research/issue-214.md` (F2, question 4); spec 011 C5 and spec 005 D1 where they quote the receipt.

Seam: `loadRetryWhenText` (`src/core/retry/text.ts`) and the receipts in `src/cli/retry.ts` (the no-result receipt's `squeal status --wait 60000 <file>` line, which a failed-result receipt lacks). First edit: rows in `test/cli/retry.test.ts` pinning today's lines, then flip them.

Owns: `src/core/retry/text.ts`, `src/cli/retry.ts`, their tests and any test that quotes the text. Leave alone: when a retry starts (`queueDue`, priorities, #127); `src/core/code/gate` (#214's gate part is spec 020's); W2's and W3's files.

Done when: a load retry's receipt says it joins the queue after the bound, with no start time; a failed-result receipt names `squeal status --wait 60000 <file>`; every other line and exit code unchanged; each changed line, old and new, in `tasks/011-343/notes.md`; lint, typecheck, key-format pass.

## W2: row 011-344, the named and edit waits end without the 2 s socket tail

Use /worker. Shape: repair, test first. Effort medium.

Read: board row 011-344; `tasks/011-49/notes.md`; `reviews/0.1.487.md` (S1, N1); `requestDaemon` (`src/core/daemon/client.ts`), `askDaemon` and `daemonSocket` (`src/cli/daemon-access.ts`), `syncDaemon` and `DaemonSync.stop()` (`src/cli/status-sync.ts`).

Lead: an optional abort signal on `requestDaemon` (destroys the socket, rejects) passed through `askDaemon` and `daemonSocket`; `syncDaemon` aborts it in `stop()`. First edit: a spawned-process test per wait (`status <path> --wait`, `status --wait`) against a socket that accepts and never answers, timing the exit from the outcome; red today at about 2 s.

Owns: `client.ts` (the signal only), `daemon-access.ts`, `status-sync.ts`, their tests. Leave alone: W1's and W3's files, `src/core/presence/`, `src/cli/code*.ts`.

Done when: both tests end within about 300 ms of the outcome; outcomes, lines and exit codes unchanged, the snapshot's (row 011-49) included; lint, typecheck, key-format pass. Notes in `tasks/011-344/notes.md`.

## W3: row 011-345, the fallback `status --wait` keeps its header parts while the states marker stays

Use /worker. Shape: slice, test first. Effort high.

Read: board row 011-345; `tasks/011-45/notes.md` (with its repair round: about 85 ms of a quiet poll is `readHeader`); `reviews/0.1.489.md`, `reviews/0.1.489-r2.md`; `research/progress-records.md` (row 011-339 changed `header.ts`'s record reads); `src/core/state/header.ts`; `src/cli/wait/every-state.ts`.

Lead: split `readHeader` into a part computed from (states, keys, policy), kept with the states while the trusted marker stays, and a part read fresh each poll (revision, runner part, checkpoints, the progress records). The trust rule (`src/core/store/write-markers.ts`) stays as it is. First edit: an equality test, the kept header equal to `readHeader`'s after each kind of write and on quiet polls.

Owns: `header.ts` (the split), `every-state.ts`, `status-wait-held.ts` as its callers need, their tests. Leave alone: `write-markers.ts`; the progress-record owners of row 011-339; W1's and W2's files.

Done when: the equality test; CPU per quiet poll on a cezar store copy before and after, at the stated load, well under 98 ms; outcomes and payloads equal a full read's; lint, typecheck, key-format pass. Notes in `tasks/011-345/notes.md`.
