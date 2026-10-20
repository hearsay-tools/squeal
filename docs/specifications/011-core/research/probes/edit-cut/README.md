# Probe: edit-cut (THROWAWAY)

Throwaway probe for `011-core/research/edit-cut.md` (row 011-25, wave 6 R2). Not product code; nothing imports it. No daemon, no Squeal build, no Vitest run and no session ran. The host's one-minute load was 54 to 76 on 24 CPUs throughout (12:47 to 13:04 local, 2026-10-20), above the brief's hold of 8, so every time here is a replay of recorded durations or a read of a store.

Inputs, all read-only:

- Cezar's store copy `/tmp/r3/cezar-store.sqlite` (2026-10-19T22:21Z, the copy `../catch-up/` and `../central-edits/` read; `R25_STORE` overrides).
- Squeal's store copied at 2026-10-20T10:48Z through a `readOnly` connection (`../catch-up/snapshot.mjs`, `VACUUM INTO`) to `/tmp/r25b/squeal-store.sqlite` (`R25B_STORE` overrides). The same for `mvp-unveiled-july26`'s store (`/tmp/r25b/mvp-store.sqlite`), which holds revisions but no test files and no results.
- Git of cezar and Squeal, read only: `git archive <sha>` into `/tmp/r25/trees` (cezar, reused from `../central-edits/`) and `/tmp/r25b/trees` (Squeal), `git cat-file blob` for a revision's new contents. `git ls-files` of mvp-unveiled-july26.
- `rolldown` 1.1.5 and `es-module-lexer` 2.3.1, installed here with a scratch `HOME`, XDG dirs and npm cache under `/tmp/r25b` (`node_modules/` is not committed).

Scripts, run from this directory in this order:

- `lib.mjs`: the module graph of `../central-edits/graph.mjs` for both repositories (Squeal: relative imports only, `verbatimModuleSyntax` everywhere), the namesake matchers and rule (n)'s pick, quantiles, gzipped results.
- `classify.mjs <cezar|squeal>`: picks the agent revisions (no HEAD move, 1 to 9 keyed paths, `../catch-up/explained.mjs`'s rule) and classifies every re-keyed fast test file: edited, direct (with the changed paths it imports in one hop), transitive, outside, absent (`results/classified-<repo>.json.gz`: each head's present test files once, per revision what differs; `lib.mjs` `readClassified` rebuilds them).
- `trust.mjs [sha]`: Squeal's static graph against Squeal's stored closures (`results/trust-squeal.txt`).
- `namesakes.mjs`: question 1, per matcher (`results/namesakes.{txt,json}`).
- `hubs.mjs`: question 4, how test files use cezar's three widest hubs (`results/hubs.{txt,json}`); `replay.mjs` reads `hubs.json` for the testkit counterfactual.
- `replay.mjs`: questions 2 and 3, every cut replayed per revision and the exposure of recorded failures (`results/replay.{txt,json.gz}`).
