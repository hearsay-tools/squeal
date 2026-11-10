# 020-08c: the cezar trial of `squeal code --base --parts` (draft diff only)

Use /worker. Shape: survey, then a draft. Approved by the human on 2026-11-10: one cezar PR moves the pin straight to Squeal 0.1.428, and adds this trial beside 018's follow-up. Coordinator 3739e45a opens and owns the PR. This row writes only the diff they include.

Outcome: a unified diff against cezar's `origin/main` `.github/workflows/ci.yml`, plus any workflow test it requires. It goes in `docs/specifications/020-quality-gate/tasks/020-08c/cezar-ci.diff`, with a short `README.md` beside it. The diff adds the trial:
- On `workflow_dispatch` runs only, so it never gates a PR or the merge queue: the Vitest shards run under `squeal ci record` with Squeal's provider. That means without their own `--coverage.enabled`, because 020-08a's hook yields to a project's own coverage. Each shard uploads its parts.
- One non-gating job after the shards downloads the parts and runs `squeal code --base origin/main --parts <dirs> --json`.
  - It writes to `$GITHUB_STEP_SUMMARY`: the verdict, how many selected test files came from parts, from the stores and from a run, and the per-shard recording overhead that 0.1.428 adds to each part (018-29).
  - It uploads the JSON report.
  - Its own failure never fails the workflow.

Read:
- `~/projects/cezar/.github/workflows/ci.yml` at `origin/main`. Do not edit any file under `~/projects/cezar`; work in a scratch clone under `/tmp`. Read its `vitest` shard job (around line 711), the Squeal fetch and record steps, and the export and publish jobs;
- `docs/sdlc/ci.md` in cezar ("Squeal shared results") and cezar's workflow tests (`grep -rl ci.yml` in its `test` or `scripts` folders);
- spec 020 D13 and `research/ci-evidence.md` (rows 020-08a, 020-08b, 020-08c);
- spec 018 `research/shared-proof.md`.

Cezar's rules that 3739e45a hit:
- a `ci.yml` change needs a bare `gh workflow run ci.yml --ref <branch>` cited in the PR's Verification section;
- a job after skipped upstream jobs needs a status function in its `if`, because merge-group runs skip upstream jobs.

Keep 018's pin and fetch steps as 3739e45a changes them: assume `SQUEAL_TAG: squeal--v0.1.428` with its commit, which comes later.

Done when:
- the diff applies to cezar `origin/main`;
- cezar's own workflow tests, if any, pass in the scratch clone;
- `actionlint` passes on the patched file, if installed;
- the README names every job and step added, the events they run on, why none can gate, and how to read the summary.

Nothing is pushed anywhere. Own only `docs/specifications/020-quality-gate/tasks/020-08c/`.
