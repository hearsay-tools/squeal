# 011-165 to 011-167 brief: pnpm per-package keys, R1 to R3 of the 011-162 design

The human accepted `tasks/011-162/design.md` as recommended on 2026-10-23 (Q1 to Q6 (a)) and said "Dispatch now". The spec text is in 011 C3 and C11 already.

Use /worker. Shape: slice, three rows in order, one commit per row (at least): 011-165 (R1), then 011-166 (R2), then 011-167 (R3). R2 needs R1's graph; R3 shares `environment.ts` with R2.

Outcome: in a pnpm project with its default layout, a bump of a package one test file imports re-keys that file only, and the rows stored under today's pnpm key stay readable after the release.

Read: board rows 011-162 and 011-165 to 011-167; the design, sections 1 to 6 and 9 (each row's seam, owned files and red-first tests are there); its probes `tasks/011-162/probes/` (`pnpm-graph.mjs`, `lockread.mjs` are the prototypes); 011 C3 (environment hash and key format bullets) and C11 as amended; board row 011-90 and `test/scheduler/former-read.test.ts` for the former read.

Seam: `readPnpmLockfile` in `src/core/keys/pnpm-lockfile.ts`, beside `withoutLinkedSpecifiers`, from `probes/lockread.mjs`.

Owns: the files section 9 names for R1 to R3, their tests and `tasks/011-165/` to `tasks/011-167/` for notes. Not yours: `src/core/scheduler/keying.ts` (row 011-158); wave 26's files (`src/core/types/policy.ts`, `src/core/scheduler/{bootstrap,ledger,tiers,queue,record}.ts`, `src/core/store/`, `src/core/state/inherited.ts`, `src/core/daemon/`, `src/runners/`); the board, spec text, bundles, version. Ask me before you edit another file under `src/`. No `npm run build`.

Tests write a pnpm install on disk (`writePnpmInstall`); none runs pnpm or reaches the network, since CI has neither. Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`.

Key format: `npx vitest run test/keys/key-format.test.ts` passes at format 20 once your validity cases cover the new lines, as design section 6 expects. If it asks for a raise, stop and send me a request.

Check on real data, once R3 is done: run `probes/measure-pnpm.mts` with the real `PnpmGraph` in place of the prototype on a `git clone` of cezar under `/tmp` at `28be188dc` and its `21e516ef5` pair, under the design brief's isolation rules (`tasks/011-162/brief.md`: scratch `HOME`, `XDG_*`, `TMPDIR`, pnpm store under `/tmp`, `--ignore-scripts`, no daemon, nothing under `evals/bin/`; remove the clones). Report the files with their own segment and the files kept; name any difference from 329 and 328.

Done when each row's red-first tests pass, lint, typecheck, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass, and `squeal run --all --wait` passes (bundle drift excepted). Paste their output in your summary, with the cezar check and any C11 sentence the code made wrong, drafted in `tasks/011-165/notes.md`.
