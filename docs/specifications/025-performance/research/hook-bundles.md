# 025-14: what the hook bundles load

Researcher, 2026-11-26, 09:15Z to 10:20Z. Brief: `hook-latency-brief.md`, section "025-14". Squeal at `be643e518` (the hook bundles are byte-identical to `792ee0ccb`'s committed `plugins/claude-code/dist`). Node v24.21.0, as in the brief's table. Probes, method and raw output: `probes/hook-latency/bundles/` (throwaway). No product code, `dist` or board file was changed; every scratch build went to `$TMPDIR`.

**Environment.** Byte counts, metafiles, coverage and CPU profiles ran on the development host (16 vCPUs, one-minute load 1.7 to 3.3, given per run). Quiet-host timings ran on boat.dev sandboxes (run 1: AMD Ryzen 9 9950X, 4 vCPUs, load 1.1 to 1.3, `boat/run1/`). Neighbours on that shared machine moved whole rounds (base `stop` p50 77 ms in one round, 116 in another), so the variants were timed again on a fresh sandbox (AMD Ryzen 7 9700X, 4 vCPUs, load 1.0 to 1.7) in four rounds of 20 runs, each round interleaving every variant, and the changes below are the median over rounds of each round's paired change (`boat/rounds/`, `summarize-rounds.mjs`). Both sandboxes ran Node v24.21.0, every variant interleaved run by run, and were deleted after the run. The timed cases are `latency.test.ts`'s: its seeded store (50 test files of 10 checks), a pass/fail transition before every delivering run, `runBundle`'s `node --disable-warning=ExperimentalWarning <bundle>` with no compile cache unless a row says so (`hook-runs.probe.ts`).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What each bundle holds that its run never calls, and why | **47 to 51% of every delivering hook's bytes never run** (203 to 213 of 335 to 351 files; `session-end` 62%, `waiter` 93%). Nearly all is `src/core`: `status`, `code`, `keys`, `lint`, `scheduler`, `commit`, `retry`, most of `store` and `delivery`. Two hubs pull it in: `harness/shared/context` (status snapshot, code store, lint store, store prune) and the handlers' text modules `harness/shared/deny` and `harness/shared/stop` (delivery format → late → scheduler; liveness → state header → commit, keys/environment → pnpm readers). The 12 largest lazy cuts would take 21 to 23% of each bundle. | verified by experiment (coverage); read in source code (metafile) |
| 2 | What the start costs | Quiet host, no compile cache, p50: **Node start 20 to 22 ms, `node:` builtins 11.5 to 15, read and compile 9 to 13.5 (2 to 3 with the cache), top-level evaluation 0 to 2.6, the hook's own work 12 (`pre-tool-use`) to 32 (`stop`)**. The builtins cost as much as compiling the bundle; about half of that is the ESM import facade. No top-level code costs more than 0.3 ms; the largest are `keys/observed.ts`'s `createHash` at load and the `node:zlib` constant in `code/coverage/parts.ts`. | verified by experiment |
| 3 | Why the bundles grew | **+47% (`pre-tool-use` 461 → 678 KB) and +50% (`stop` 493 → 738 KB), all `src/`, no package.** 0.1.364→0.1.409: check groups (019), coverage shared parts (015-85, which brought `node:zlib` into every hook), presence; →0.1.450: writes through the daemon (021 wave 2, which brought `node:net` into `pre-tool-use`), export and import (018-06/07); →0.1.568: late-delivery texts (005-97 and on); later steps 16 to 20 KB. Loading the larger bundles costs **+3 to 4 ms by 0.1.450 and +4 to 6 ms by main without the compile cache, nothing with it**: about a third of the brief's +8 to 10 ms. | verified by experiment (bytes, timings); read in source code (commits) |
| 4 | Candidate cuts, measured | Quiet host p50 / p95, no cache: **`builtins` (`process.getBuiltinModule`, a build plugin) −1.6 to −2.8 / −0.4 to −6.1 ms**, and it keeps that with the cache; **`cut` (lazy rare paths, upper bound) −1.3 to −2.3 / up to −6.3**, about 0 to −2 with the cache; **`minify` −0.3 to −1.7**; **all three −3.8 to −6.1 / −5.4 to −7.5** (development host: −4.4 to −10.1 / −6.0 to −12.3). **`split` is slower (+1 to +12); `lazy` builtins add nothing over `builtins`.** | verified by experiment |
| 5 | The cut set for under 80 ms p95 with a reserve | **No bundle cut alone gets there for `stop`**: the best set takes `stop` on the development host from 84.6/92.2 to 76.9/86.2 ms without the cache. With the compile cache in the measured path (the users' path since 025-07) and the cuts, `stop` measured 67.9/75.9 at load 2.5 to 3.3. Recommend `builtins` now, the code-store and status-snapshot lazy cuts next, no `split`, no `minify`; the rest of the reserve must come from the compile cache in the test (025-15, the human's choice) or from `stop`'s own work (025-15). | verified by experiment (timings); inferred (the set) |

## 1. What each bundle holds that its run never calls

**Method.** `NODE_V8_COVERAGE` over two runs of every `latency.test.ts` case (one delivering, one not, per case), mapped to source files by the bundle's own `// src/...` module comments (`coverage.mjs`). A file counts as *called* when any function in it ran, functions run at load included; the rest ran only top-level code (declarations, constants). Import chains come from the esbuild metafile of `bundleOptions` at this commit (`chain.mjs`, `dominated.mjs`). *Verified by experiment* (coverage) and *read in source code* (metafile).

| Hook | Bundle | Files | Never called | Largest never-called groups (KB never called / KB in the bundle) |
|---|---|---|---|---|
| `pre-tool-use` | 678 KB | 335 | 333 KB, 49%, 203 files | `status` 46/67, `code` 40/45, `keys` 39/44, `lint` 38/40, `delivery` 44/166, `store` 36/99, `scheduler` 16/21 |
| `stop` | 738 KB | 351 | 350 KB, 47%, 213 files | `status` 48/69, `code` 42/45, `keys` 39/44, `lint` 32/42, `store` 36/101, `delivery` 43/173 |
| `session-start` | 667 KB | 341 | 337 KB, 50%, 213 files | as `pre-tool-use` |
| `user-prompt-submit` | 704 KB | 343 | 356 KB, 51%, 212 files | as `stop` |
| `post-tool-batch` | 710 KB | 345 | 347 KB, 49%, 207 files | as `pre-tool-use` |
| `session-end` | 604 KB | 319 | 375 KB, 62%, 238 files | `status` 49/58, `code` 42/45, `keys` 39/44, `state` 30/34, `presence` 19/20 |
| `waiter` | 671 KB | 329 | 621 KB, 93%, 305 files | everything but `harness/shared` and `daemon/paths` |

The bundles share one shape: the hook's handler reaches two hubs, and the hubs import whole subsystems for paths the timed runs never take.

- **`harness/shared/context`** (every hook that opens a context): `status/snapshot` (`createStatusBuilder`), which pulls `status/outstanding` (19 KB), `status/imports` (14 KB), `store/status-reads` (6 KB), `node-pin` (5 KB, and with it `node:child_process`) and `retry/recorded`; `delivery/code-source` → `code/store/open` → `code/store/store` (34 KB, the code store, and through `code/store/coverage` → `code/coverage/parts` the `node:zlib` import); `lint/surface/source` → `lint/store/open` (13 KB); `delivery/delivery` → `store/store` → `store/prune` (9 KB).
- **`harness/shared/deny`** (`pre-tool-use`) and **`harness/shared/stop`** (`stop`): `delivery/format` → `delivery/header` → `delivery/late` → `status/standing-yields` → `scheduler/yield-row` (why `pre-tool-use` holds `scheduler`); `delivery/liveness` → `state/header` → `state/groups` → `commit/store` → `commit/report` (why it holds `commit`) and → `scheduler/slow`; `delivery/liveness` → `keys/environment` → `keys/pnpm-install` (15 KB), `keys/pnpm-lockfile` (6 KB), `keys/packages` (6 KB) (why it holds `keys`); `runners/descriptions` → `runners/pytest/describe` → `pytest/environment/discover`.
- **`hooks/pre-tool-use`** → `daemon/policy` → `policy-runtime` → `keys/runtime-files` → `keys/closure` → `keys/observed`, which hashes two constants with `createHash("sha1")` at load.

`dominated-main.txt` lists, per hook, the modules whose import made lazy would take the most bytes out: the 12 largest disjoint cuts remove **21 to 23%** of each bundle (144 to 161 KB). The rest of the never-called half is spread over 200 files that called modules import for one function or a type guard.

Limit: the timed store has no lint results, no code coverage records, no pnpm project and no daemon to start, so the lint, code and key-reading paths stay cold here. On a real project they run on some hooks; a lazy cut there moves their load cost into the run rather than removing it.

## 2. What the start costs

**Method.** `phases.mjs` writes four stripped copies of each bundle: an empty module; the bundle's `node:` imports alone; the whole bundle with its body behind an `if` that never holds (read and compile, nothing evaluated); the bundle without its last `await runMain(...)` (all top-level code, no hook work). The differences between the copies and the full bundle, run interleaved on one seeded store, split a run into phases. `profile.mjs` reads `--cpu-prof` profiles (50 µs) of the full runs. *Verified by experiment.*

Quiet host (boat.dev 9950X, 4 vCPUs, load 1.1 to 1.3, `boat/run1/phases-nocache.txt`), no compile cache, 30 runs per copy interleaved; p50 ms, each phase the p50 difference between two neighbouring copies:

| Case | Node start and exit | `node:` builtins | Read and compile | Top-level evaluation | Hook's own work | Full run p50/p95 |
|---|---|---|---|---|---|---|
| `session-start` | 22.2 | 12.6 | 11.3 | 2.6 | 23.5 | 72.2/97.1 |
| `post-tool-batch` | 22.3 | 11.5 | 10.9 | 1.5 | 24.0 | 70.2/87.8 |
| `pre-tool-use` | 20.5 | 12.4 | 12.8 | 0.5 | 12.3 | 58.5/70.1 |
| `stop` | 21.5 | 13.0 | 10.7 | 0.3 | 31.9 | 77.4/93.7 |
| `stop` (silent) | 20.0 | 12.2 | 13.5 | −1.3 | 26.1 | 70.5/97.4 |
| `user-prompt-submit` | 19.5 | 15.2 | 9.3 | 1.4 | 22.0 | 67.5/86.8 |
| `user-prompt-submit` (silent) | 20.1 | 12.4 | 11.9 | −0.2 | 17.6 | 61.8/79.3 |

With the compile cache (each copy its own warm cache), read and compile fall to **1.9 to 2.6 ms** (quiet host, the three cases before neighbour noise hit that run: `session-start`, `post-tool-batch`, `pre-tool-use`) and **1.5 to 3.4 ms** on the development host (load 2.1 to 2.5, all six cases, `host/phases-cache.txt`). Every other phase is unchanged by the cache. The development host gave the same split without the cache: start 21 to 23, builtins 12 to 14, compile 11 to 14, top level 1 to 3, work 13 to 32 ms (load 2.2 to 2.6).

- **Node's own start and exit** is about 20 to 22 ms and not Squeal's.
- **The builtins cost 11.5 to 15 ms on every hook**, as much as compiling the whole bundle. `builtins.mjs` splits it: each module alone costs 0 to 4 ms; at the margin beside the others `crypto` 5.0, `child_process` 3.4, `util` 3.1, `zlib` 2.3 ms; `sqlite` 0 (host, load 1.7). About 6 ms of the total is the ESM facade: importing a builtin from ESM builds a module namespace of all its exports, which reads every lazy getter (`crypto.webcrypto`, `fs.promises`, `util.types` ...). The same 15 modules through `process.getBuiltinModule` cost 6.4 ms instead of 11.8 on the quiet host (`boat/run1/builtins.txt`; 7.8 against 14.0 on the development host). On the quiet host the margins are smaller and within its noise of about ±2 ms per row (`crypto` 2.0, `child_process` 0.8, the others 0 to 1); leaving out `child_process`, `crypto`, `net` and `zlib` together saves 5.5 ms. In the profile it shows as `compileForInternalLoader` (5 ms per run).
- **Read and compile cost 9 to 13.5 ms without the compile cache and about 2 to 3 ms with it.** `compileSourceTextModule` is 13 to 16 ms per profiled run. Compile cost follows the size of the code, not the share that runs: V8 pre-parses every lazy function.
- **Top-level evaluation is small: −1.3 to 2.6 ms (zero within noise for `stop` and `pre-tool-use`).** The profile spreads its 2.1 to 2.4 ms over many modules; none takes more than 0.2 ms. The largest named pieces are `keys/observed.ts`'s two `createHash("sha1")` calls (0.25 to 0.3 ms with `Hash` setup), `harness/shared/primer.ts` (0.2), `daemon/policy-checks.ts` (0.1), the `createRequire` banner (0.1 to 0.2), and the `node:zlib` constant `SYNC = { finishFlush: constants.Z_SYNC_FLUSH }` in `code/coverage/parts.ts`, which needs `node:zlib` loaded. No large table or regex is built at load.
- **The hook's own work** is the rest: 12 ms (`pre-tool-use`) to 32 ms (`stop`). In the profile its largest part is SQLite statements (`store/connection.ts`, 3 to 7 ms), then `state/file-class.ts` (1.4 to 2.2 ms), `delivery/delivery.ts`, `store/codec.ts`. 025-15 owns this phase.

## 3. Why the bundles grew

**Method.** The committed bundles at each tag, split by their module comments (`growth.mjs`), and the size of the committed bundle before and after each first-parent commit that touched it (`commits.sh`). Raw: `growth.txt`, `commits.txt`. *Verified by experiment* (byte counts) and *read in source code* (commits).

| Step | `pre-tool-use` | `stop` | Groups that grew most (`pre-tool-use`) | Commits that grew it most |
|---|---|---|---|---|
| 0.1.364 | 461 KB, 232 files | 493 KB, 236 files | | |
| → 0.1.409 | +78 KB, +31 files | +97 KB, +40 files | `presence` +20 KB (new), `daemon` +16, `code` +8, `delivery` +8, `state` +7, `commit` +6 (new). `stop`: also `harness/shared` +17 (`stop-text`, `stop-decide`, `stop-required`) | `159c1063f` 0.1.397 (019-14 to 019-23, check-group texts) +15.2 KB; `7f97654d9` 0.1.386 (011-288) +11.0; **`81779d2b0` 0.1.365 (015-85 coverage shared parts) +9.9, which added `node:zlib` to every hook**; `236275066` 0.1.395 (019-07, 019-09) +8.8 |
| → 0.1.450 | +60 KB, +30 files | +62 KB, +29 files | `delivery` +19 (`sending-connection`, `daemon-writer`), `store` +10, `status` +9 (`status/imports`), `node-pin` +5, `keys` +5 | **`0dbe84b3d` 0.1.442 (021 wave 2: writes through the daemon) +18.1 KB, which added `node:net` to `pre-tool-use`**; `a231f0cbc` 0.1.417 (018-06/07 export and import) +15.7; `f58d63e4e` 0.1.439 (018-30/31) +7.1; `4d62464e6` 0.1.434 (021 wave 1) +4.9 |
| → 0.1.568 | +44 KB, +30 files | +50 KB, +34 files | `delivery` +24 (`late*`, `register`, `header-daemon`, `view-mark`, `own-count`), `store` +7, `scheduler` +5 | `836046208` 0.1.538 (005-97) +12.8 KB; `164b30138` 0.1.548 (005-106/108) +6.0; `c59652b6b` 0.1.545 (011-391, 005-105) +4.3 |
| → 0.1.600 | +16 KB, +5 files | +16 KB, +5 files | `store` +7 (`prune-*`), `delivery` +2, `commit` +2 | `d0f4470f3` 0.1.569 (021-33 prune) +4.4 KB; `ed95c4656` 0.1.600 +3.3; `c922bb4f0` 0.1.570 +2.7 |
| → main | +20 KB, +7 files | +20 KB, +7 files | `store` +7 (`status-reads` new), `state` +6, `slow` +2 | `863ce6a70` 0.1.633 (025 wave 3, `status-reads`) +8.3 KB; `280bb222d` 0.1.624 +2.1; `98a997db4` 0.1.610 +2.0 |

No step added a package from `node_modules`: every byte is `src/`. Each feature added its code to the shared modules the hubs import (`delivery`, `store`, `status`, `state`), so every hook carries it whether it runs it or not.

What the growth cost at start (`parse-size.mjs`, parse-only copies of the committed bundles at each tag, interleaved): quiet host, 30 runs, `boat/run1/parse-size.txt`; p50 over an empty module, builtins included:

| | 0.1.364 | 0.1.409 | 0.1.450 | 0.1.568 | 0.1.600 | main |
|---|---|---|---|---|---|---|
| `pre-tool-use`, no cache | 19.0 | 21.1 | 22.0 | 23.9 | 25.2 | 23.2 |
| `stop`, no cache | 16.7 | 20.8 | 20.5 | 22.8 | 23.0 | 22.3 |
| `pre-tool-use`, compile cache | 16.6 | 18.0 | 15.0 | 16.5 | 14.9 | 16.5 |
| `stop`, compile cache | 13.3 | 11.9 | 13.8 | 12.3 | 14.7 | 14.0 |

Without the cache, loading grew **3 to 4 ms by 0.1.450 and 4 to 6 ms by main**. With the cache it did not grow (±1.5 ms, the noise). This includes the builtins added on the way: `node:zlib` in every hook since 0.1.365 (`81779d2b0`, 1.7 to 1.9 ms alone), and `node:net` in `pre-tool-use` since 0.1.442 (`0dbe84b3d`, 1.4 to 2.6 ms alone); `stop`, `session-start` and the others had `node:net` before 0.1.364. So of the brief's +8 to 10 ms by 0.1.450 (measured through `runBundle`, no cache), loading the larger bundle explains 3 to 4 ms. The rest is the hook's own work, 025-15's question. *Verified by experiment.*

## 4. Candidate cuts, measured

**Method.** `build-variant.ts` builds the hook bundles with `bundleOptions` and one change each, into scratch directories. Every variant printed the same stdout and no stderr as the base build in every case (`parity.mjs`: 22 of 22 runs each, `SQUEAL_HOOK_DEBUG=1`). Then all variants ran interleaved on one seeded store, 30 runs per case and variant, without and with the compile cache. *Verified by experiment.*

- `minify`: `minifyWhitespace` and `minifySyntax` (no identifier renaming). 678 → 517 KB.
- `split`: `splitting: true` over the hook entries with shared chunks. Each hook then loads 4 to 7 files whose sum is larger than the single bundle (`pre-tool-use` 709 KB in 4 files, `stop` 752 KB in 7).
- `builtins`: an esbuild plugin that turns each `node:` import into a virtual module reading `process.getBuiltinModule` (no ESM facade), each export a pure call so unused exports drop.
- `lazy`: `builtins`, and `node:child_process` and `node:zlib` loaded on the first call of one of their functions.
- `cut`: the upper bound of `await import()` for rare paths: seven never-called modules (`code/store/store`, `status/outstanding`, `status/imports`, `keys/pnpm-install`, `lint/store/open`, `store/prune`, `delivery/code-coverage`) replaced by throwing stubs, 678 → 548 KB. A real lazy import pays its load when the rare path runs. `keys/pnpm-lockfile` could not be cut: `keys/environment` reads its `PNPM_LOCKFILE` at load, so a real cut must move that constant.

Quiet host (9700X, four rounds of 20 runs, `boat/rounds/rounds-*.txt`). Base: pooled p50/p95 ms. Variants: median paired change of p50 / of round p95, ms; negative is faster.

| Case | Base, no cache | `minify` | `builtins` | `cut` | all three | Base, compile cache | `minify` | `builtins` | `cut` | all three |
|---|---|---|---|---|---|---|---|---|---|---|
| `session-start` | 51.5/121.2 | −1.4/−24 | −2.1/−38 | −2.1/−38 | **−6.1/−41** | 43.5/71.2 | −1.1/−1.9 | −3.3/−3.0 | −2.1/−4.7 | **−5.1/−8.1** |
| `post-tool-batch` | 51.6/61.1 | −1.7/−0.2 | −2.6/+0.9 | −2.3/−5.2 | **−4.2/−7.5** | 39.5/67.5 | −0.9/−2.1 | −2.0/+5.0 | −1.1/−1.4 | **−3.1/−3.3** |
| `pre-tool-use` | 42.3/57.7 | −0.3/−0.7 | −1.9/−5.0 | −2.2/−6.3 | **−3.8/−5.6** | 34.8/63.5 | +0.4/−5.8 | −1.4/−2.2 | −0.1/−5.1 | **−2.7/−4.7** |
| `stop` | 51.7/74.1 | −1.2/−3.9 | −1.8/−6.1 | −2.0/−5.6 | **−4.5/−7.1** | 46.2/75.2 | −0.7/−3.0 | −1.9/−5.7 | −0.4/−5.4 | **−2.9/−7.3** |
| `stop` (silent) | 48.5/56.1 | −1.4/−1.9 | −1.9/−0.4 | −1.3/−2.7 | **−4.8/−5.4** | 44.6/56.1 | −2.2/−1.8 | −1.7/−2.3 | −0.6/−2.8 | **−3.6/−4.0** |
| `user-prompt-submit` | 43.3/50.8 | −1.3/−0.8 | −1.6/−4.0 | −2.0/+0.9 | **−4.6/−7.0** | 40.6/48.6 | −1.9/−1.4 | −4.4/−7.0 | −1.8/+0.3 | **−5.3/−6.3** |
| `user-prompt-submit` (silent) | 40.8/50.7 | −1.0/−0.8 | −2.8/−2.4 | −2.3/−2.2 | **−4.4/−6.8** | 36.5/46.0 | −1.1/+0.1 | −2.2/−1.8 | −0.7/+1.6 | **−4.2/−2.1** |

`session-start`'s no-cache p95 changes come from base rounds with neighbour spikes (base round p95 69 to 120 ms); read its p50 only. "All three" is `builtins+cut+minify`.

On the development host (one round of 20, load 2.5 to 3.3, `host/var-*.txt`), where a run takes 1.4 to 1.6 times as long, the same changes are about twice as large: `builtins` −4.3 to −5.6 ms p50 (one case +1.0), `cut` −2.2 to −4.4, `minify` −0.8 to −3.4, `lazy+cut+minify` **−4.4 to −10.1 ms p50 and −6.0 to −12.3 ms p95** without the cache, −4.3 to −8.5 ms p50 with it. There `stop` went from 84.6/92.2 to 76.9/86.2 ms without the cache and from 72.2/79.3 to 67.9/75.9 ms with it.

- **`split` is slower**: +0.8 to +6.1 ms p50 on the development host, +3.0 to +12.2 on the 9950X (one case −4.4 in a noisy round). Each hook loads more files and more bytes than its one bundle.
- **`lazy` adds nothing over `builtins`** (run 1 and the development host): the hooks reach `child_process` and `zlib` at load or on their path anyway (`daemon/outlived.ts` calls `promisify(execFile)` at load).
- **`builtins` keeps its gain with the compile cache; `cut` and `minify` lose most of theirs**, since the cache already removes compile cost. With the cache, `cut` is worth 0.1 to 2.1 ms p50.

What each cut costs (*read in source code* at `be643e518`, unless tagged):

| Cut | Code | `dist` drift check (`ci.yml` 117, 160) | Key-format validity bundle (`test/keys/validity/bundle.ts`) | Other harnesses (`bundleOptions` is shared) |
|---|---|---|---|---|
| `builtins` | One esbuild plugin in `src/harness/build.ts`, about 30 lines; no `src/core` change. Needs `process.getBuiltinModule` (Node 22.3; the floor is 22.19). | Every plugin's bundles change once. The output does not depend on the Node that builds it: built on Node 22.19 and 24.21 the bundles are byte-identical (*verified by experiment*), since every export is a pure call and unused ones drop. | None: it takes only `platform`, `format` and the target from `bundleOptions` and builds its own bundle. | Codex, Pi, OpenCode bridge and Antigravity hook bundles and the CLI change the same way, all run by Node. OpenCode's Bun `plugin.mjs` uses its own `pluginBundleOptions`, so it is untouched. |
| `minify` | Two options. | Bundles change once; diffs of `dist` in review become unreadable and the `// src/...` module comments go, which this research's byte tools read. | None. | All bundles, including the CLI. Stack traces in bug reports lose readable code. |
| `cut` (real: `await import()` or narrower imports) | Source changes in the hubs: `status/snapshot` (outstanding, imports), `delivery/code-source` (code store), `lint/surface/source` (lint store), `keys/environment` (pnpm install; its `PNPM_LOCKFILE` constant must move first), `store/store` (prune). Call sites become async, or the hubs stop importing the subsystems. A dynamic import needs `splitting: true` for the ESM output, or a separate entry per lazy module. | Bundles change; with `splitting` new chunk files appear in `dist`. | `keys/*` and `store/*` changes are in the global component's closure: the alarm fires and the changed lines need cases that run them (no raise, as long as outputs stay equal). | All harnesses' bundles shrink alike. |
| `split` | One option. | Many hashed chunk files in every `dist`. | None. | All. Rejected: slower. |
| `lazy` | `builtins` plus call-through wrappers that must keep `promisify.custom` and `new`. | As `builtins`. | None. | Rejected: no gain over `builtins`. |

## 5. Recommendation

**The verdict:** the bundles' size is a minor part of the creep. Of a `stop` run on the quiet host, start-up that depends on the bundle (builtins, compile, top-level) is 24 ms without the compile cache and 15 ms with it, against 32 ms of the hook's own work and 21 ms of Node itself. The tradeoff that decides it: every cut below saves milliseconds on every hook of every user, at a one-time cost in the build; the source-level cuts cost more code and touch the validity alarm for 1 to 2 ms each.

In this order:

1. **Ship `builtins`**: an esbuild plugin in `bundleOptions` that reads every `node:` import through `process.getBuiltinModule`, each export a pure call. It saves 1.4 to 4.4 ms p50 on the quiet host and about 4 to 6 ms on the development host (one case +1), with and without the compile cache, on every hook and on the CLI. It changes no `src/core` file, leaves the validity bundle alone, and builds byte-identical output on Node 22.19 and 24.21. Keep a check that the shipped bundles hold no `from "node:` import, so a new builtin cannot bring the ESM facade back.
2. **Then the two largest lazy cuts**, each a separate row: stop `harness/shared/context` from importing the whole status snapshot builder (`status/outstanding`, `status/imports`, `node-pin`, 33 to 38 KB) and the code store (`code/store/store` and `code/coverage/parts`, which also brings `node:zlib`, 34 to 40 KB) when the hook does not deliver those parts. Together with the other five stubbed modules they measured 1.3 to 2.3 ms p50 without the cache and up to 2.1 with it; the two are about half of those bytes. `keys/*` and `store/*` cuts set off the validity alarm, so leave `keys/pnpm-install` and `store/prune` for last.
3. **Do not ship `split`** (slower) **or the lazy builtin wrappers** (no gain). **Leave `minify` out**: 0.3 to 1.7 ms for unreadable `dist` diffs and the loss of the module comments.
4. **The 80 ms budget for `stop`** needs more than the bundle: on the development host the best bundle set leaves `stop` at about 77/86 ms without the compile cache. With the compile cache in the measured path, as users run it since 025-07, and cuts 1 and 2, `stop` measured 68/76 at load 2.5 to 3.3. The reserve beyond that must come from `stop`'s own 26 to 32 ms of work, which 025-15 answers. *Inferred from the measurements above.*

## Open questions

- The never-called share is measured on `latency.test.ts`'s store only. On a project with lint results, code coverage records or a pnpm install, some of the cut modules run on some hooks; how often, and what the lazy load then costs, is not determined, because no such store was profiled.
- The `cut` numbers are an upper bound: a real `await import()` pays the module's load when the rare path runs, and its async call sites may cost a little on every run. Not determined, because no real lazy import was built.
- A V8 startup snapshot (`node --snapshot-blob`) of the hook code would remove compile and top-level evaluation together. It needs a CommonJS entry and per-Node-version blobs; not measured.

## Sources

- `src/harness/build.ts` (`bundleOptions`), `src/harness/claude-code/build.ts`, `src/harness/opencode/build.ts`, `test/keys/validity/bundle.ts`, `test/harness/latency.test.ts`, `test/harness/bundle-helpers.ts`, `.github/workflows/ci.yml` lines 117 and 160, at `be643e518`.
- Committed bundles `plugins/claude-code/dist/{pre-tool-use,stop,session-start,user-prompt-submit}.mjs` at `squeal--v0.1.364`, `squeal--v0.1.409`, `squeal--v0.1.450`, `squeal--v0.1.568`, `squeal--v0.1.600` and `792ee0ccb`.
- Probes and raw output: `probes/hook-latency/bundles/` (`README.md` lists each), quiet-host results in `probes/hook-latency/bundles/boat/`.
