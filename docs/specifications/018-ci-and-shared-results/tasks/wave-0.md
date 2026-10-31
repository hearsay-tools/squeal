# Spec 018 wave 0: research

Three researchers in parallel. Each is read-only on the product and writes one file. Their topics are disjoint, so they run together.

## 018-01 ci-run

Use /researcher. Answer topic `ci-run` in `docs/specifications/018-ci-and-shared-results/research/README.md`: whether Squeal can run tests in a CI job and the smallest useful form, if any. Shape: research. Read the README's rules first, then `docs/vision.md` principle 5, `src/cli/` for `squeal run`, and `docs/specifications/010-ci-cost/research/ci-test-time.md`. First step: read what `squeal run --all --wait` prints and exits with on a failure in a fresh fixture clone under `$TMPDIR`. Owns only `research/ci-run.md` and `research/probes/ci-run/`. Leave `result-import.md` and `remote-store.md` to their siblings; when your question needs key portability, cite that topic, do not measure it. Done when `research/ci-run.md` is committed, answers questions 1 to 5, tags every finding, and no daemon or clone of yours is left running.

## 018-02 result-import

Use /researcher. Answer topic `result-import` in `docs/specifications/018-ci-and-shared-results/research/README.md`: whether results from CI or a teammate are valid here and on what terms. Shape: research. Read the README's rules first, then `docs/decisions/0002-content-keyed-shared-store.md` and `src/core/keys/environment.ts` and `check-key.ts`. First step: list every input of the environment hash and mark the ones that depend on the machine, then test them with two fresh fixture clones at different paths under `$TMPDIR`. Owns only `research/result-import.md` and `research/probes/result-import/`. Leave `ci-run.md` and `remote-store.md` to their siblings. Never open a live store for writing; copy it first. Done when `research/result-import.md` is committed, answers questions 1 to 6, tags every finding, and no daemon or clone of yours is left running.

## 018-03 remote-store

Use /researcher. Answer topic `remote-store` in `docs/specifications/018-ci-and-shared-results/research/README.md`: where shared results could live, how they move, and whether that belongs in Squeal. Shape: research. Read the README's rules first, then `docs/decisions/0002-content-keyed-shared-store.md` and `src/core/store/`. First step: split the store's tables into shared and local data, then measure today's baseline lookup on a copied database under `$TMPDIR`. Owns only `research/remote-store.md` and `research/probes/remote-store/`. Leave `ci-run.md` and `result-import.md` to their siblings; for key portability, cite `result-import`, do not measure it. Done when `research/remote-store.md` is committed, answers questions 1 to 6, tags every finding, and no daemon or clone of yours is left running.
