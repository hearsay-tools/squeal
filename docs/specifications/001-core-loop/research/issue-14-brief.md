# Issue 14: explicitly awaited queued tests

Use /researcher. Shape: research. No implementation.

Outcome: establish whether https://github.com/hearsay-tools/squeal/issues/14 reproduces, and record the exact reproduction path and evidence in `research/issue-14-named-wait.md`.

Read issue 14 with gh, docs/process.md, docs/vision.md, docs/styleguide.md, docs/board.md and 001 spec.md/status.md (D5 scheduling and D7 status). Compare existing rows, particularly 001-381 and any named-wait rows; identify overlap and new information. Start at the named status wait CLI path and scheduler ordering. Use a cheap deterministic throwaway fixture or probe to show a short selected queued file behind background work; preserve the exact command, version/commit, observed order and output. Separate already-running tier delay from unrelated queued-tier delay. Do not claim the original cezarion session reproduced if only a controlled scenario did. Tag claims per researcher skill.

Own only `docs/specifications/001-core-loop/research/issue-14-named-wait.md` and probes under `research/probes/issue-14/`. Leave board, spec, status and product/tests untouched. Commit the findings and any useful throwaway probe. Done when alignment, duplicate-row comparison, reproduction (or explicit inability with reason) and human decision questions are recorded. Do not fix or choose automatic versus opt-in promotion.
