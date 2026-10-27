# 002-41: dispatch contention assertions

Use /worker. Shape: repair. Read spec D8 and reviews/0.1.368-r2.md S1. Product candidate 9401c1d08 passed its narrow B1/B2 review. This row changes tests only.

Own test/harness/codex/adapter/dispatch.test.ts and tasks/002-41/notes.md. A new adjacent test-only helper is allowed if needed. Leave product, generated files, versions, board and sibling research unchanged.

Start at machine().hook(), which unconditionally parses stdout as Ran. Distinguish successful runtime JSON, exact selection-busy context and permitted silent non-context output. Use a controlled real lock holder to prove busy first contact creates no pin. Release it, retry, and require dispatch with a valid pin. Concurrent successful dispatches of one session must share one pin. Existing pins must survive concurrent publication. Separate sessions must eventually pin after bounded retries. Do not retry arbitrary errors or weaken monotonicity. Preserve coverage for all existing hook cases.

Reproduce the stale assertion before the fix. Verify the controlled busy and recovery cases, Squeal affected results, lint and typecheck. No full suite or committed builds. Commit the repair and exact evidence. Report any unsettled decision or API change.
