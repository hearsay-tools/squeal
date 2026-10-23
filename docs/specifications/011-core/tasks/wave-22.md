# Wave 22 of spec 011

The human's four answers to the 2026-10-23 digest and quality scan ("gh-75/77: Research now / gh-76: Explicit reply / gh-64: Design row / Quality: Dispatch"), dispatched by coordinator 04a258b0 on 2026-10-23 from main with 0.1.273, while wave 21 (011-120, 011-127) runs. Rows on disjoint files run in parallel: W1 owns `src/cli/retry.ts`; W2 the quoting rule and the status texts; W4 the status readers, two store lists, `hold-rows.ts` and `start.ts`; R1 and D1 edit no product file. Rows 011-128 and 011-131 with slice 4 edit `scheduler.ts` and wait for wave 23, after 011-120. The candidate is 0.1.275 unless another lands first. Workers write no spec text: draft each spec sentence in the row's notes, and the coordinator writes it.

## R1: 011-133, what starts the old-version daemons (gh-75, gh-77)

Use /researcher. Shape: research. Brief: `research/issue-75-77-brief.md`. Findings: `research/issue-75-77.md`.

## D1: 011-135, a design for focused checks inside one test file (gh-64)

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-135/design.md`, which the human can accept before any code row.

Read board row 011-135; `docs/triage/2026-10-23-digest.md` group C; `research/issue-64.md`; `research/running-tier-yields.md`; spec 011 C4, C5, C6, C14, C15; spec 013 V4.

The design answers each question in the row's done-when, with drafted amendments and the code rows it implies. Measure the gain on a `/tmp` clone of cezarion at PR 1269's commit (its parity files, the whole file against `vitest -t`), with `HOME`, `XDG_*` and `TMPDIR` under `/tmp`, at load below 16; if the clone cannot run, a synthetic file of the same shape, and say so. Never connect to a live daemon or run a script under `evals/bin/`.

Owns `tasks/011-135/` only. Done when every question has an answer tagged `measured`, `read in source code` or `inferred`. Commit.

## W1: 011-134, `retry` on a test file the daemon has not listed yet says so (gh-76)

Use /worker. Shape: slice.

Outcome: `squeal retry` on an existing file that matches a configured test pattern, before the daemon lists the revision that added it, says the revision is not listed yet and names `squeal status --wait 60000 <file>`.

Read board row 011-134; digest group B; `research/issue-76.md`; spec 011 C5; `src/core/status/checks.ts:144`.

Seam: `notKeyed` (`src/cli/retry.ts:273`). First answer the row's question: can the CLI match a path against the configured patterns without the daemon (011-63's named selection, `src/cli/status-wait-paths.ts`, is a lead). A lead for the exit status: 3, as Squeal uses for "no verdict yet", if `retry` does not use it already. Print the path through `shellWord` from `src/core/delivery/index.js`; W2 moves that function, and the coordinator fixes the import at integration.

Owns: `src/cli/retry.ts`, `test/cli/retry.test.ts`, new tests, `tasks/011-134/`. Not yours: `src/core/status/`, `src/core/retry/`, `src/core/delivery/` (ask before you need an export there), the board, spec text, bundles, version. No `npm run build`.

Done when the row's three tests pass, the C5 sentence is drafted in `tasks/011-134/notes.md`, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Paste their output in your summary.

## W2: 011-130 with quality slices 1 and 6, one quoting rule and two shared helpers

Use /worker. Shape: slice.

Outcome: one shell-word rule for every printed command, one load-per-CPU text and one first-of-each-check helper.

Read board rows 011-130 and 011-132; `quality/2026-10-23.md` slices 1 and 6. Seam: `shellQuote` (`src/core/ps/render-units.ts:21`) becomes `shellWord` in `src/core/text.ts`. Make one commit for each of 011-130, slice 1 and slice 6.

Owns the files those rows and slices name, and the tests that pin their texts. Not yours: `src/cli/retry.ts` and `test/cli/retry.test.ts` (W1: tell the coordinator if a text you change is pinned there); `standing.ts`, `holds.ts`, `open-runs.ts`, `src/core/store/`, `hold-rows.ts`, `start.ts` (W4); `src/core/scheduler/`; the board, spec text, bundles, version. No `npm run build`.

Done when 011-130's done-when holds, slices 1 and 6 change no behaviour with tests unchanged but for imports and the texts 011-130 names, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Paste their output in your summary.

## W4: quality slices 2, 3, 5 and 7, four duplicates removed

Use /worker. Shape: slice.

Outcome: `standingsOf` reads the worktree record once; one reader and writer for the JSON lists in `meta`; `isProcess` gone; the repeated `liveHandoff` check gone.

Read board row 011-132; `quality/2026-10-23.md` slices 2, 3, 5 and 7, each with its files and lines. Seam: `liveStartedAt` in `src/core/status/open-runs.ts` (slice 2). Make one commit for each slice.

Owns the files those slices name, the new module of slice 3, and their tests' imports. Not yours: every file of W2 (`replaced-failures.ts`, `failures.ts`, `why.ts`, `format-why-replaced.ts`, `next-step-text.ts`, `src/core/retry/`, `src/core/delivery/`); `src/cli/retry.ts`; `src/core/scheduler/` except `hold-rows.ts`; the board, spec text, bundles, version. No `npm run build`.

Done when each slice changes no behaviour, with tests unchanged but for imports, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Squeal does not key `test/daemon/` on `src/` (row 011-127): run the daemon and CLI tests that cover `start` directly. Paste their output in your summary.
