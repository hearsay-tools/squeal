# Wave 39

From main after 0.1.314 (`5d71a17cb`), 2026-10-25. Two rows from the human's triage round 10 on disjoint seams, so they run in parallel: what the first header after the listing says (W1), and a selection's verdict (W2). 011-205 goes first among the header rows because 011-207, 011-211's text and 011-215 wait for it. 011-212 and 011-214 follow in the next wave; host load holds this one at two workers.

## W1: 011-205, the first header after the listing says what is current and inherited

Use /worker. Shape: slice. Row 011-205 in `docs/board.md`.

Outcome: a session that registered before the listing learns, once, how many test files are current and inherited and why the rest have no checks, and the news line never says "no check pending, stale or unknown" beside test files without checks.

Read the row; spec 011 C5's header paragraph and task 001-407; `src/core/delivery/slow-told.ts` (how a consumer's last-shown slow-tier state is kept, the model for "once per consumer"); C7 (a meta row, no column).

Seam: `newsLine` in `src/core/delivery/header.ts:103`. First edit, offered as a lead: change (b), the "no check" wording, then (a), the counts line once after the listing, kept per consumer beside `slow-told.ts`.

Owns `src/core/delivery/` and its tests, the evals parser (`evals/lib/squeal-text.mjs`) if the new text needs it. Not yours: `src/cli/status-wait*.ts`, `named-selection.ts`, `verdict.ts` (W2), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds, the evals parser gate round-trips the new text through `formatDelta`, plain and hook JSON; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-206, a selection says its verdict and why it has none

Use /worker. Shape: slice. Row 011-206 in `docs/board.md` (gh-88, gh-84, gh-83).

Outcome: `status --wait <path>` gives one result word (pass, fail, none) beside `selection.code`, with one reason from a closed list when it is none, from one function for text, JSON and exit code.

Read the row; `docs/triage/2026-10-25-digest-waits.md` sections "One contract, several rows" and A; `research/issue-88.md`, `issue-84.md`, `issue-83.md`; spec 011 C6, C15; spec 005 D2.

Seam: `src/cli/verdict.ts` and `src/cli/named-selection.ts`. First edit, offered as a lead: one function that returns the word and the reason from a selection, then make `status-wait-lines.ts` and the JSON read it.

Owns `src/cli/status-wait-paths.ts`, `status-wait-lines.ts`, `named-selection.ts`, `verdict.ts`, `retry-unlisted.ts` if shared, the gating lines in `plugins/*/skills/squeal/references/commands.md`, their tests. Not yours: `src/core/delivery/` (W1), the board, spec text, `status.md`, bundles, version. No gate loosened, no `schemaVersion` raise. Send one request with the reason names before you write them. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
