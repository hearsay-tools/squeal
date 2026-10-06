# Scheduler fixtures

`basic/` holds five test files for `test/scheduler`. Its `_gitignore` becomes `.gitignore` in the scratch repository, so `src/gen/` is gitignored generated code there.

`barrel/` reproduces lessons defects 1 and 3: `src/index.ts` re-exports `src/math.ts` and `src/strings.ts`; `test/math.test.ts` imports `src/math.ts` directly; `test/barrel.test.ts` imports the barrel and takes 5 s.

Scratch copies live in `.tmp/`, inside the repository so they resolve `vitest` from its `node_modules`.
