# 020-26c: the cezar proof of records beside the project's V8 coverage (draft diff only)

Use /worker. Shape: survey, then a draft. Approved by the human on 2026-11-12 (#189, "Cezar proof: Yes, after release"). Squeal 0.1.443 ships row 020-26ab. Coordinator 3739e45a opens and owns the cezar PR, which also moves the pin to `squeal--v0.1.443` (`ebd52be86`); this row writes only the diff they include, as 020-08c did (`tasks/020-08c/`).

Outcome: a unified diff against cezar's `origin/main` `.github/workflows/ci.yml` (plus any workflow test or small script it needs) in `docs/specifications/020-quality-gate/tasks/020-26c/cezar-ci.diff`, with a `README.md` beside it. The diff adds a proof that runs only on `workflow_dispatch` with a new boolean input (default false), never on a PR or in the merge queue:
- One Vitest shard (the 1/4 shard of the existing matrix is enough), three ways, as parallel jobs on the same commit: (a) under `squeal ci record` with `--coverage.enabled` (V8, Squeal wraps it); (b) and (c) plain `vitest --coverage.enabled`, twice, the second as the run-to-run control. Each uploads its `coverage-final.json` (json reporter) and its wall and CPU time; (a) also uploads its parts.
- One non-gating compare job after them (status function in its `if`, `continue-on-error`, exit 0 always). It writes to `$GITHUB_STEP_SUMMARY`:
  - covered-statement differences (a) against (b), and (b) against (c), as counts of statements and files;
  - records in (a)'s part against its test files, and its header's `collector` (expect `v8`) and `inspector` fields;
  - each job's wall and CPU time, and Squeal's own time from the part.
  - It uploads the comparison as JSON.

Read: cezar `.github/workflows/ci.yml` at `origin/main` (the Vitest shard job, the Squeal fetch and record steps, the 020-08c `squeal_gate_trial` input and job); `docs/sdlc/ci.md` in cezar; cezar's workflow tests; spec 020 D13.4 and D19; `research/ci-coverage-both.md` (Q5, the real-shard run and the missing control); `tasks/020-08c/README.md`.

Do not edit any file under `~/projects/cezar`: clone it to a scratch directory under `/tmp`. Run no Vitest shard locally (host load); the proof runs on GitHub.

Cezar's rules: a `ci.yml` change needs a bare `gh workflow run ci.yml --ref <branch>` cited in the PR's Verification; a job after skipped upstream jobs needs a status function in its `if`.

Done when: the diff applies to cezar `origin/main` with a `squeal--v0.1.443` pin edit or without it; cezar's workflow tests pass in the scratch clone; `actionlint` passes if installed; the README names every job, step and input added, the events they run on, why none can gate, the dispatch command, and how to read the summary. Nothing is pushed anywhere. Own only `docs/specifications/020-quality-gate/tasks/020-26c/`.
