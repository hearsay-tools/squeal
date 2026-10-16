# Issue 15: diagnostic evidence reproduction

Use /researcher. Shape: research. Review https://github.com/hearsay-tools/squeal/issues/15 (bug, friction: reported by an agent using Squeal).

Outcome: determine whether `why --json` can omit the invoking worktree’s current failing result while returning other worktrees’ results, and record a repeatable reproduction path. Read spec D7/D8 and status.md; compare board rows 001-173, 001-188 and 001-190 and search for any other duplicate.

Start at `src/core/status/` and the `why` CLI handler; follow result selection before constructing a small isolated shared-store probe. Use real public query/CLI interfaces where practical, uniquely marked local and foreign errors, and enough newer foreign results to test the suspected boundary. Distinguish a verified mechanism from the original report’s unconfirmed cause. Record log-pointer behavior separately.

Own only `docs/specifications/001-core-loop/research/issue-15.md` and `research/probes/issue-15/` beneath that spec. Leave product code, tests, board and other docs alone. No implementation or fix. Commit the report and reproducible throwaway probe; include exact commands, outputs, SHA/version, limitations, vision alignment and duplicate/new-information assessment. Done when each question has evidence or an explicit not-reproduced limitation. Do not run the full product gate for research-only files.
