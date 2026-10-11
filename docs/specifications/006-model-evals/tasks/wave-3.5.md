# 006 wave 3.5: repair of the judge review

`../reviews/wave-3.md` failed with B1 and S1:
- B1: a fresh eval root could not start calibration. The bug came from the coordinator's 006-25.
- S1: retained "whole" output had character caps.

The coordinator fixed both in 006-26 (`8153e236`).

## 006-27 narrow re-review of 006-26

Use /reviewer. This is the second round on the judge slice. Range: `8153e236^..8153e236`. Spec: `../spec.md` D9, the calibration step of every run and the retained transcript.

Answer these questions only:
- **B1:** does `ensureCalibrated`, through the real `claudeRunner` with a genuinely absent root, reach the identity check? For an unknown identity, does it reach the calibrator? Rerun the review's bounded reproduction.
- **S1:** Squeal's evidence lines and a runner's summary lines must stay whole in a retained output of any length. Only incidental lines may be dropped or capped, and every cut must be marked to the judge. Repeat the review's two boundary probes: an 8099-character Squeal output and a 475-character summary line.
- Did the change alter any reference session's retained transcript? That would void the committed passing calibration. Did it alter any committed result?

Rules:
- No judge calls and no subject sessions.
- Never run or import `evals/bin/run-baseline.mjs`.
- Never run `npm run build` in the review-writing worktree.

Findings go to `../reviews/wave-3.5.md`.
