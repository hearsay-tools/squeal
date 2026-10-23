# Wave 23 of spec 011

Two rows on disjoint files, dispatched by coordinator 04a258b0 on 2026-10-23 from `int/w22` at 016013a6b (0.1.275 in its gate, on top of `cand/0.1.274`, which passed review). Row 011-140 is the human's approval of 2026-10-23 ("Row 011-140: Approve"); 011-128 is planned and waited for 011-120. W1 owns the harness's kept copies and the handoff; W2 owns `scheduler.ts`. Row 011-131 with slice 4 follows 011-128 in wave 24. Workers write no spec text: draft each spec sentence in the row's notes, and the coordinator writes it.

## W1: 011-140, a Codex kept copy runs only the code its name says

Use /worker. Shape: slice.

Outcome: a hook or `squeal start` never spawns a daemon from a kept copy whose code is another version, a successor older than its claim ends the handoff with one note, and the test run that wrote the wrong copies writes nothing outside its scratch directories.

Read board row 011-140; `research/issue-75-77.md` Q1 and Q4; `research/probes/issue-75/three-versions.mjs`; spec 005 D3; spec 011 C9.

Seam: `keepVersion` (`src/harness/shared/version-copies.ts`) names the copy after `squealVersion()` and fills it from `PLUGIN_ROOT` without comparing them. A lead: read the root's manifest version first, and copy only when it is the copy's version. First find the writer: run the suite with `PLUGIN_ROOT` and `PLUGIN_DATA` set to scratch directories and name the test that makes a copy there. A Vitest setup that clears both variables is a lead for the isolation.

Owns the files the row names, their tests and `tasks/011-140/`. Not yours: `src/core/scheduler/` (W2), the board, spec text, bundles, version. No `npm run build`. Never touch the real `~/.codex` or `~/.claude`: every probe and test uses scratch `HOME`, `CODEX_HOME`, `PLUGIN_ROOT` and `PLUGIN_DATA`.

Done when the row's done-when holds, the 005 D3 and 011 C9 sentences are drafted in `tasks/011-140/notes.md`, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run the daemon and harness tests your change reaches directly (row 011-127). Paste the output in your summary.

## W2: 011-128, a busy record's withhold history follows a merge hold that began during its wait

Use /worker. Shape: repair.

Outcome: a record that a busy store delayed counts no withhold for a file that a merge hold, begun during the wait, keeps out of storage.

Read board row 011-128; `reviews/0.1.273-r2.md` N2; `tasks/011-126/notes.md`; spec 011 C9 (a merge-held withhold counts toward no limit).

Seam: `#prepare` and `#write` in `src/core/scheduler/scheduler.ts` (the withhold count near `:1091`, `#heldNow` near `:1126`). A lead: keep the withhold change prepared, and apply it in `#write` only for files the current hold does not exclude.

Owns `scheduler.ts`, `test/scheduler/busy-*.test.ts` and new scheduler tests, `tasks/011-128/`. Not yours: `src/harness/`, `src/cli/`, `src/core/store/`, `src/core/delivery/` (W1), the board, spec text, bundles, version. No `npm run build`.

Done when the row's test passes, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run `test/scheduler/busy-*.test.ts` and `test/daemon/busy-tier.test.ts` directly. Paste the output in your summary.
