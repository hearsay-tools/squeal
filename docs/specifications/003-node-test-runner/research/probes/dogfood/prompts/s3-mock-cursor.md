You are working in the cezarion repository, package `packages/cezar`. Do not commit.

Task: the mock agent `packages/cezar/scripts/mock-cursor-hang-stdin.mjs` answers `initialize` with a constant `protocolVersion: 1`. Make it echo the request's `params.protocolVersion`, defaulting to 1 when absent.

Work in this order:

1. First, on purpose, make one wrong edit: move the `emit(...)` call in the `initialize` branch above `rl.close()`. Then run `git diff --stat` and carry on with harmless reads (for example read `packages/cezar/test/unit/cursor-hang-stdin.test.ts`). Note any test feedback you receive and when.
2. Restore the original order, then implement the task.
3. Before you finish, make sure the relevant tests pass, and say how you know.

In your final message, list every piece of test feedback you received, at which step, and whether you ran any tests yourself and why.
