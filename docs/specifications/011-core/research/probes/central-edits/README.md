# Probe: central-edits (THROWAWAY)

Throwaway probe for `011-core/research/central-edits.md` (row 011-25). Not product code; nothing imports it. No daemon, no Squeal build, no Vitest run and no session ran: the host's one-minute load stayed between 24 and 67 on 24 CPUs, above the brief's hold of 8 for live measurements, so every time here is a replay of recorded durations or a read of the store.

Inputs, all read-only:

- Cezar's store copy `/tmp/r3/cezar-store.sqlite`, made by `../catch-up/snapshot.mjs` (`VACUUM INTO` through a `readOnly` connection) at 2026-10-19T22:21Z; opened with `readOnly: true`. Another copy: `R25_STORE=<path>`.
- `../catch-up/results/{explained,revisions}.json`, which pick the revisions (no HEAD move, fewer than 10 keyed sources, 200 or more fast files re-keyed).
- Cezar's git (`/home/agent/projects/cezar`): `git archive <sha>` into `/tmp/r25/trees/<sha>` (scratch, `R25_SCRATCH`), `git cat-file blob` for a revision's new contents, `git show <sha>:squeal.config.json`. Nothing is written to cezar.
- `rolldown` 1.1.5 (its oxc transform, the one Vite 8.1.4 in cezar uses) and `es-module-lexer` 2.3.1, installed here with a scratch `HOME` and npm cache (`npm i`; `node_modules/` is not committed).

Scripts, run from this directory with no arguments:

- `graph.mjs`: the module graph of cezar at a commit, one hop as Vite's transform leaves it (type-only imports dropped; `onlyRemoveTypeImports` in `packages/web`, whose tsconfig sets `verbatimModuleSyntax`), resolved by cezar's rules (relative, `.js` to `.ts`, `@/`, the two workspace packages' `exports`). A library for the others.
- `trust.mjs`: each fast test file's static reach at a8042ec3 against the closure Squeal stored for it (`results/trust.json.gz`).
- `direct.mjs`: per revision, each re-keyed file as edited, direct (one hop), transitive at depth d, outside the import graph, or absent at the head; per changed path its direct importers; the revision's own test files (`results/direct.{json.gz,txt}`). `R25_ALL=1` takes all 293 agent revisions (`results/direct-all.{json.gz,txt}`).
- `cuts.mjs`: over the 293, what stays an edit and what becomes catch-up under each cut, and where the own test files land (`results/cuts.{json,txt}`).
- `replay.mjs`: the 62 revisions replayed one by one under today's rule and cuts (a), (a) capped, (c), from the store's per-file durations, with the tier model of `../catch-up/calibrate.mjs` (`results/replay.{json,txt}`).
- `measured.mjs`: what the same revisions' own test files waited on cezar, and what the edit tiers in flight held (`results/measured.{json,txt}`).
- `outside.mjs`: the files outside the import graph that revisions of 49 or fewer re-keyed files reach, with their median durations (`results/outside.txt`).
- `capown.mjs`: the own test files a cap of 12 direct importers would leave off the edit route (`results/capown.txt`).
- Large results are gzipped JSON (`graph.mjs` `readResult`, `writeResult`).
