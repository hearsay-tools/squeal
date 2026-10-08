# Scheduler fixtures

`basic/` holds five test files for `test/scheduler`. Its `_gitignore` becomes `.gitignore` in the scratch repository, so `src/gen/` is gitignored generated code there.

`barrel/` reproduces lessons defects 1 and 3: `src/index.ts` re-exports `src/math.ts` and `src/strings.ts`; `test/math.test.ts` imports `src/math.ts` directly; `test/barrel.test.ts` imports the barrel and takes 5 s.

`barrel-only/` is this repository's shape for defect 3: both test files import only the barrel `src/index.ts`, so an edit to `src/math.ts` has no direct importer and the shortest-duration rule alone must put `test/zz-fast.test.ts` before `test/aa-slow.test.ts`, which sorts first by path. `aa-slow` spends its 1.5 s in `beforeAll` and its test case is instant, while `zz-fast`'s test case takes 200 ms: summed test-case durations would put `aa-slow` first, the module duration from `onTestModuleEnd` puts it last.

Scratch copies live in `.tmp/`, inside the repository so they resolve `vitest` from its `node_modules`.

`observed/` is task 001-132's: `test/runtime.test.ts` reads `data/input.txt`, spawns `scripts/child.mjs` with `env: {}`, which spawns `scripts/grandchild.mjs` reading `data/grand.txt`, starts a Worker from `scripts/worker.mjs` reading `data/worker.txt`, stats the gitignored `ignored/build.txt` and lists `data/listed`. None of them is in its import graph. Two projects, `forks` and `threads`, run every file under each pool.
