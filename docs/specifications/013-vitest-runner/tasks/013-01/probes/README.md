# 013-01 probes (throwaway)

Evidence for `../design.md`; delete freely. Not product code, not a test. Every probe ran under `/tmp` with `HOME` and `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` pointed into the probe directory, on 2026-10-20 between 09:38 and 09:49 at a one-minute load of 8.9 to 22.4 on 24 CPUs. No Squeal daemon ran; no probe ran in this worktree.

## Module graph reach (questions 1, 2)

- `make-fixture.sh <dir>`: the fixture repository. Its `node_modules` was a **copy** (`cp -a`, `.vite` removed) of another worktree's install: Vitest 5.0.3, Vite 8.3.2, Node 24.21.0. The probe ran in two steps (the first nine test files, then four more added); the script writes the final state, checked identical to the probed tree with `diff -r`.
- `graph-probe.mjs <root> <path>...`: one `createVitest('test', { root, watch: false, fsModuleCache: false })`, `standalone()`, one `runTestSpecifications` of every test file, then for each path and each environment of each project: the modules Vite's file index holds for it (`getModulesByFile`), the modules whose ID names it once a `\0` and query are set aside (Squeal's `sourceOf`), and the test files their importer walk reaches. `PROBE_CONFIG=<file>` picks another config.
- `summarize.cjs <out>`: prints it. `[T]` is a cached transform.

```text
step 1, 9 test files passed; step 2, 13 passed
src/mod.ts          root/ssr  file index: plain, virtual   <root>/src/mod.ts[T] <- test/plain.test.ts, \0virtual:which
src/only-input.txt  root/ssr  file index: only             <root>/src/only-input.txt <- \0virtual:only
src/style.css       root/ssr  file index: css              <root>/src/style.css?inline[T] <- test/css.test.ts
src/base.css        root/ssr  file index: css              /@fs/<root>/src/base.css (no id) <- <root>/src/style.css?inline
src/plain.css       root/ssr  file index: css-plain        <root>/src/plain.css[T] <- test/css-plain.test.ts
src/base2.css       root/ssr  file index: css-plain        /@fs/<root>/src/base2.css (no id) <- <root>/src/plain.css
src/zero.ts         root/ssr  file index: none; every module naming it: zero
                              \0<root>/src/zero.ts[T], not in the file index <- test/zero.test.ts
src/dyn.ts          root/ssr  none (computed import())     <root>/src/dyn.ts[T] <- (no importer)
src/lib.ts          root/ssr  file index: lib
dist/loaded.js      root/ssr  file index: dist             <root>/dist/loaded.js[T] <- test/dist.test.ts
dist/unrelated.js   no module in any graph
src/setup.ts        root/ssr  none                         <root>/src/setup.ts[T] <- (no importer)
src/global-setup.ts root/__vitest__  none                  <root>/src/global-setup.ts[T] <- (no importer)
vitest.config.ts    no module in any graph
src/glob/a.ts       root/ssr  file index: glob (lazy import.meta.glob)
src/mocked.ts       root/ssr  file index: mock             (no transform: vi.mock served __mocks__)
src/__mocks__/mocked.ts root/ssr none                      [T] <- (no importer)
src/actual.ts       root/ssr  none (vi.importActual)       [T] <- (no importer)
src/raw.txt         root/ssr  file index: raw              <root>/src/raw.txt?raw[T] <- test/raw.test.ts
```

Optimizer, `vitest.optimizer-on.config.ts` against `-off` (`deps.optimizer.ssr` with `include: ["local-pkg"]`, `local-pkg` aliased to `src/aliased.js`), each one passing test:

```text
optimizer on:  src/aliased.js -> no module in any graph
               (bundled to node_modules/.vite/vitest/<hash>/deps_ssr/local-pkg.js)
optimizer off: src/aliased.js root/ssr file index: opt/aliased  <root>/src/aliased.js[T] <- opt/aliased.test.ts
```

## Same-bytes in-place writes (question 3)

- `inplace-read.mjs <dir> <rounds> <KiB>`: a child process rewrites one file in place with its own bytes (`openSync(file, "w")`, one `writeSync`, `closeSync`) while this process reads it in a loop.

```text
{"rounds":2000,"sizeBytes":262165,"reads":2980,"otherBytes":2227,"empty":1289,
 "otherLengths":[262144,106496,0,8192,24576,16384],"sameInode":true,"endsSame":true}
```

- `tsc-read.mjs <project> <tsc>`: 400 generated modules (`declaration`, `sourceMap`: 1,200 outputs), built once, then rebuilt with no source change while this process reads every output in a loop. `tsc` 7.0.2 from the cezarion checkout's `node_modules/.bin`, run read-only against a project under `/tmp`.

```text
{"files":1200,"reads":40800,"otherBytes":14,"empty":14,"byKind":{".js":7,".js.map":4,".d.ts":3},"endSameBytes":1200,"mtimeMoved":1200,"sameInode":1200}
{"files":1200,"reads":39600,"otherBytes":19,"empty":19,"byKind":{".js":9,".js.map":3,".d.ts":7},"endSameBytes":1200,"mtimeMoved":1200,"sameInode":1200}
{"files":1200,"reads":44400,"otherBytes":25,"empty":25,"byKind":{".js":8,".d.ts":6,".js.map":11},"endSameBytes":1200,"mtimeMoved":1200,"sameInode":1200}
```

## The cezar store (question 4)

`store-dist-rows.cjs <copy>` and `store-dist-revisions.cjs <copy>` read a **copy** of `/home/agent/projects/cezar/.git/squeal/store.sqlite` and its `-wal`, taken 2026-10-20 09:38, opened read-only. Never open the live store.

```text
file_hashes under packages/cezar/dist/, per worktree (.d.ts, .js.map, .js, other):
  6 worktrees, each 281-282 / 253-254 / 254-255 / 0
closure paths under dist/: only test:package ("static imports plus declared inputs"),
  1,380 .js and 47 resolution candidates (dist/x.js.ts, .js.mts, ...); no .d.ts, no .js.map
revisions naming dist/*.d.ts: 2026-10-14T21 to 2026-10-15T08 (cezar and agent worktrees; those
  agent worktrees' last daemons ran 0.1.168) and 2026-10-19T15 to 17 (worktree 2d626467, whose
  daemon now runs 0.1.224; which version wrote those revisions and which config it read: not read)
```
