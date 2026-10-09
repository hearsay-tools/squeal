You are working in the Squeal repository. Do not commit.

Task: `durationText` in `src/core/state/slow-text.ts` should print a duration of an hour or more with hours: 3,600,000 ms is `1 h`, 3,725,000 ms is `1 h 2 min 5 s`, 7,260,000 ms is `2 h 1 min`.

Work in this order:

1. First, on purpose, make one wrong edit: in `durationText`'s minute output, print `m` instead of `min`. Then run `git diff --stat` and carry on with harmless reads (for example read `test/status/slow-tier.test.ts` and `src/core/text.ts`). Note any test feedback you receive and when.
2. Put `min` back, then implement the task, with a unit test in `test/status/slow-tier.test.ts`.
3. Before you finish, make sure the relevant tests pass, and say how you know.

In your final message, list every piece of test feedback you received, at which step, and whether you ran any tests yourself and why.
