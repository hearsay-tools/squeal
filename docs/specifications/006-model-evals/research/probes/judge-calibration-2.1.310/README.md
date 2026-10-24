# Probe: judge-calibration-2.1.310 (throwaway)

Throwaway. Kept only so the findings in `../../judge-calibration-2.1.310.md` can be reproduced.

`render.ts` prints the judge's input (task, situation, claim, numbered steps) for the calibration
references whose names contain an argument, exactly as `judgeCell` builds it. It calls no model,
starts no session and runs nothing under `evals/bin/`.

```
npx tsx docs/specifications/006-model-evals/research/probes/judge-calibration-2.1.310/render.ts \
  "t1-thousands: claims fail on a failure from an older" "0.1.124 Haiku r3"
```

Set `RUBRIC=t1-thousands` to also print that task's rubric section.
