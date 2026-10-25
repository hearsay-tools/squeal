# 015 wave 10: an early pass, and the pass's last long turns

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.321. Two workers on disjoint seams. W1 starts at once. W2 times turns, so it starts after 016's eval run ends, to keep its measurements off the evals' load.

## W1: 015-57

Use /worker. Shape: slice. Starts from main. Outcome: CRAP and "no test runs it" tell PASS and RESOLVED as soon as the current records in hand prove them, and failures still wait for every record.
- Read `spec.md` D5, D6 and D9 (**Pending and unknown**, **A pass proven early**, **First judgement**, **Delivery**), the 2026-10-25 lines in `status.md`, and board row 015-57.
- **Lead.** `src/core/code/crap/file.ts` decides a source's condition (pending until every loader has a current record; unknown on a cause). `judge.ts` makes the states and `kindOf` the transitions. `walk.ts` turns a pending or unknown condition into states. A first edit: let a pending or unknown source pass its partial union to the judge, and judge a function `pass` only when that union already proves it.
- **Owns.** `src/core/code/crap/**` and its tests, except `test/code/crap/chain-load.test.ts`, which W2 owns. Leave `src/core/code/pass/**` alone (W2). Ask me before you change a delivered text, a store query or a record.
- **Done when.** The row's done-when, red first. Notes go in `tasks/015-57/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## W2: 015-55 and 015-56

Use /worker. Shape: slice. Starts from main once 016's eval run has ended. Outcome: an edit pass, a pull included, keeps every turn under 100 ms on an incident-size store, and the cause of CI's one 443 ms recount turn is named.
- Read `spec.md` D2 and D4 (**The pass**, **A quiet pass in parts**), board rows 015-55 and 015-56, `tasks/015-48/notes.md`, and `reviews/0.1.321.md`.
- **Lead.** 015-56 first: record which phase each long turn falls in, in `chain-load.test.ts`'s recount, then run it until a long turn shows. For 015-55, the edit pass's last transaction in `runPass` (`src/core/code/pass/pass.ts`) and its first turn (the plan, `oldBodies`, the files rows). The staged parts and `CodeStateRepo.adopt` from 015-48 are the pattern; an edit pass also writes moves, transitions and edits, so its switch must hold them too.
- **Owns.** `src/core/code/pass/**`, `test/code/pass/**` and `test/code/crap/chain-load.test.ts`. Leave the rest of `src/core/code/crap/**` alone (W1). Ask me before a new store method, query, table or index; never raise `user_version` or a result key.
- **Done when.** Both rows' done-when, red first. Notes go in `tasks/015-55/notes.md`, with the turn times and the load of each measurement. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.
