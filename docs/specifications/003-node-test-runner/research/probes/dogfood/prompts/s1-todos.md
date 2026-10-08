You are working in the cezarion repository, package `packages/cezar`. Do not commit.

Task: `todoTaskText` in `packages/cezar/src/todos.ts` should trim `suggestedArgs`, and add no `Arguments:` line when the args are blank or whitespace only.

Work in this order:

1. First, on purpose, make one wrong edit: in `todoTaskText`, remove the `.trim()` from the suggested-prompt line. Then run `git diff --stat` and carry on with harmless reads (for example read `packages/cezar/test/unit/todo-task-text.test.ts` and `packages/cezar/test/fixtures/todo-task-text.json`). Note any test feedback you receive and when.
2. Put the `.trim()` back, then implement the task. Add two cases to `packages/cezar/test/fixtures/todo-task-text.json`: blank args, and args with surrounding spaces.
3. Before you finish, make sure the relevant tests pass, and say how you know.

In your final message, list every piece of test feedback you received, at which step, and whether you ran any tests yourself and why.
