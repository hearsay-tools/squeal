# 010 wave 3: issue intake

## 010-30 issue intake in CI, with a replay

Use /worker. Shape: slice.

Outcome: a new issue on hearsay-tools/squeal is checked by Jev in CI: labelled, closed when it duplicates an open issue (once enabled), and otherwise given `needs-triage`, the cockpit's triage trigger; plus a replay that scores Jev against the board's decisions.

Read: `docs/specifications/010-ci-cost/spec.md` D12. Source, pinned: hearsay-tools/cezarion at 10cec2e9, `.github/workflows/issue-intake.yml` (the `jev-intake` and `apply-intake` jobs), `.github/scripts/{issue-intake-candidates,apply-issue-intake,jev-issue-intake,jev-intake-replay}.cjs` with their tests, `.ai/analysis/2026-10-16-jev-intake-replay.md` (read with `gh api repos/hearsay-tools/cezarion/contents/<path>?ref=10cec2e9`).

Starting seam: `.github/scripts/issue-intake-candidates.cjs`, ported, then the closed-in-30-days candidates with an `open` flag the applicator reads. Leads, yours to settle:
- Squeal's Vitest only collects `test/**/*.test.ts`: port the tests there, importing the `.cjs` modules, so the suite and CI run them.
- The applicator stays the only writer; the Jev job keeps `issues: read` and no secrets but `TYPESAFE_API_KEY`.
- The `needs-triage` fallback runs when the Jev or apply job fails, never after a close.
- Replay truth: board lines `gh-N to NNN-MM` map through D12's area list; duplicates gh-30→#6 and gh-29→#5, every other issue none. Its scoring runs offline on recorded Jev answers in a test.

Owns: `.github/workflows/issue-intake.yml`, `.github/scripts/*intake*`, their tests under `test/`, `docs/specifications/010-ci-cost/research/issue-intake-replay.md`. Leave alone: `ci.yml`, `src/`, bundles (no version raise), the board, `docs/process.md`, skills, labels and variables on GitHub.

Done when: `npm run lint`, `npm run typecheck` pass; `squeal run --all --wait` output pasted; the replay report committed with the live run if `TYPESAFE_API_KEY` is in your environment (test its presence, never print it), else marked pending with the exact command. Do not push.

Final message: deviations from cezarion and why, the replay's results or its pending command, and the labels and variable the coordinator must create at landing.

## 010-31 review of 010-30

Use /reviewer. Shape: review. Pinned to the candidate SHA. Checks: the applicator as the only writer; what an injected issue body can reach; the closed-candidate rule; the `always()` fallback; that the replay's truth comes from the board, not a model. Writes `reviews/wave-3.md`.
