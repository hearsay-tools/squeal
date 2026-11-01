# Probe: judge-calibration-2.1.316 (throwaway)

Throwaway. Kept only so the findings in `../../judge-calibration-2.1.316.md` can be reproduced.
Nothing here runs anything under `evals/bin/`.

- `render.ts` prints the judge's input for the references whose names contain an argument, as
  `judgeCell` builds it (copied from the 2.1.310 probe). No model call.
  `node_modules/.bin/tsx render.ts "t2-weekend: re-runs a file a delivery named current"`
- `history.mjs` prints, per committed calibration file, the grades each call gave on the two
  references 2.1.316 missed, and its `unordered` count. Reads files only.
- `unordered.mjs` tabulates, per committed calibration file, calls and verdicts flagged
  `unordered` and how many flagged and unflagged verdicts missed their expected grade. Reads
  files only.
- `call.ts` **spends money**: it judges one reference `n` times (1 to 8) through `judgeCell` and
  `claudeRunner`, which builds the judge's own scratch `HOME` under the eval root
  (`/tmp/squeal-evals-<uid>/judge`, removed after each call). Haiku or Sonnet only. It keeps each
  call's raw stdout in `out/` and prints the key order of each verdict object.
  `node_modules/.bin/tsx call.ts claude-sonnet-5-5 "<exact reference name>" 2`
- `log-*.txt` are the printed outputs of the five `call.ts` invocations of 2026-11-01 (20 model
  calls, $0.1246). `out/*.json` are those calls' raw `claude -p --output-format json` stdout
  (no credential; scanned for `http`, `bearer`, `sk-ant` and token values).
