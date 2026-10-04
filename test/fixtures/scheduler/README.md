# Scheduler fixture

`basic/` holds five test files for `test/scheduler`. Its `_gitignore` becomes `.gitignore` in the scratch repository, so `src/gen/` is gitignored generated code there. Scratch copies live in `.tmp/`, inside the repository so they resolve `vitest` from its `node_modules`.
