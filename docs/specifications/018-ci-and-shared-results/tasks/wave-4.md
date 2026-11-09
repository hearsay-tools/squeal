# Spec 018 wave 4: research for the second slice

The human, 2026-11-09: "A: spec the useful form". Three researchers in parallel; topics in `research/README.md`, section "Second slice topics". Each is read-only on the product and on GitHub, and writes one findings file.

## 018-13 ci-step

Use /researcher. Answer topic `ci-step` in `docs/specifications/018-ci-and-shared-results/research/README.md`. Read the README's rules, `research/import-trial.md`, `research/main-results.md` 4, and cezar's `.github/workflows/ci.yml` (read from `gh api` or a fresh clone, never `~/projects/cezar`'s working tree). First step: list every Vitest config field that differs between `CI=true` and unset in Vitest 4.1.10 and 5.0.3, from their installed `dist`. Owns only `research/ci-step.md` and `research/probes/ci-step/`. Done when committed, every question answered and tagged, no daemon or clone left.

## 018-14 transport

Use /researcher. Answer topic `transport` in the same README. Read the README's rules, `research/remote-store.md` and `research/import-trial.md`. First step: in a scratch bare repository under `$TMPDIR`, write and fetch a notes ref holding a 2 MB blob and time it. Owns only `research/transport.md` and `research/probes/transport/`. Done when committed, every question answered and tagged, no daemon or clone left.

## 018-15 key-rules

Use /researcher. Answer topic `key-rules` in the same README. Read the README's rules, `research/import-trial.md` (count 2), `src/runners/node-test/adapter-environment.ts`, `src/core/keys/observed.ts`. First step: copy `~/projects/cezar/.git/squeal/store.sqlite` with `-wal` and `-shm` to `$TMPDIR` (read only, never open the live store for writing) and list, per test file, the observed paths the union adds over the file's own last run. Owns only `research/key-rules.md` and `research/probes/key-rules/`. Done when committed, every question answered and tagged, no daemon or clone left.
