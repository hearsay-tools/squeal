# Scheduler fixtures

`basic/` holds five test files for `test/scheduler`. Its `_gitignore` becomes `.gitignore` in the scratch repository, so `src/gen/` is gitignored generated code there.

`barrel/` reproduces lessons defects 1 and 3: `src/index.ts` re-exports `src/math.ts` and `src/strings.ts`; `test/math.test.ts` imports `src/math.ts` directly; `test/barrel.test.ts` imports the barrel and takes 5 s.

`barrel-only/` is this repository's shape for defect 3: both test files import only the barrel `src/index.ts`, so an edit to `src/math.ts` has no direct importer and the shortest-duration rule alone must put `test/zz-fast.test.ts` before `test/aa-slow.test.ts` (1.5 s), which sorts first by path.

Scratch copies live in `.tmp/`, inside the repository so they resolve `vitest` from its `node_modules`.
