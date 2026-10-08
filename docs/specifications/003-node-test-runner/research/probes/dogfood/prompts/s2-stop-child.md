You are working in the cezarion repository, package `packages/cezar`. Do not commit.

Task: `stopChild` in `packages/cezar/test/e2e/stop-child.ts` rejects as soon as it sends SIGKILL, so a caller can see the child still running. Make it wait for the child's `exit` after the SIGKILL (bounded: at most 1 s more) before rejecting, with the same error message. Add a test to `packages/cezar/test/e2e/stop-child.test.ts` asserting that when the promise rejects, the child has already exited with `signalCode` `SIGKILL`.

Before you finish, make sure the relevant tests pass, and say how you know.

In your final message, list every piece of test feedback you received and when, and whether you ran any tests yourself and why.
