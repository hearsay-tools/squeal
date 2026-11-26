# Research brief: hook latency creep (rows 025-14 and 025-15)

The human, 2026-11-26: find and fix what made Squeal's hooks slower. `test/harness/latency.test.ts` holds every
bundled Claude Code hook to 80 ms p95 (20 cold runs, load <= 4, `CI` unset) and fails at main on quiet machines.
The budget stays; no tolerance is added. Measurements so far (task 877f10a7, developer host, Node 24.21, p50/p95 ms):

| Release | session-start | pre-tool-use | stop | user-prompt-submit |
|---|---|---|---|---|
| 0.1.364 | 69/71, 70/72 | 55/56, 54/57 | 66/69, 81/83 | 62/64, 65/68 |
| 0.1.450 | 74/81, 74/79 | 64/65, 65/66 | 76/77, 78/81 | 71/73, 72/76 |
| 0.1.600 | 76/79, 74/79 | 63/68, 64/67 | 81/83, 78/84 | 75/78, 73/79 |
| main `792ee0ccb` | 75/79, 91/91 | 66/68, 68/81 | 80/81, 86/90 | 75/82, 76/80 |

- About +8 to 10 ms on every hook by 0.1.450, then flat; about +4 to 8 ms more on `stop` after 0.1.600. A bisect
  over 0.1.364..0.1.450 was inconclusive (the step is near the noise).
- `plugins/claude-code/dist/<hook>.mjs` grew 45 to 50%: `pre-tool-use` 460 KB (0.1.364) to 678 KB; `stop` 493 to
  738 KB. `node --check` parse went from 7-9 ms to 12-14 ms.
- `runBundle` (`test/harness/bundle-helpers.ts`) runs `node <bundle>`; real hooks start through
  `plugins/claude-code/hooks/run`, which sets `NODE_COMPILE_CACHE` and strips `NODE_USE_ENV_PROXY` (025-07). With
  the compile cache in `runBundle`, p50 fell 7 to 10 ms; `stop` p95 still read 88 to 89.
- Coordinator's first look (metafile of `bundleOptions` at `792ee0ccb`): every hook bundle holds no `node_modules`
  code; it is all Squeal's own `src/core`. `pre-tool-use` (694 KB): `delivery` 168 KB, `store` 100, `status` 67,
  `daemon` 48, `code` 46, `keys` 44, `state` 44, `lint` 40, `presence` 21, `scheduler` 20. The build
  (`src/harness/build.ts` `bundleOptions`) uses one ESM bundle per entry, no `splitting`.

Every finding is tagged `verified by experiment`, `read in source code`, `read in official docs` or `inferred`.
Probes live under `research/probes/hook-latency/`. Timings on this host carry the load average beside them; this
host is loaded by other coordinators, so quiet-host comparisons run on boat.dev (`~/projects/notes/topics/boat-dev.md`;
compare versions inside one sandbox). CPU profiles and byte counts are fine locally. Do not change product code.

## 025-14: what the hook bundles load (researcher: claude opus high)

Write `research/hook-bundles.md`. Answer:

1. Per Claude Code hook entry (`src/harness/claude-code/entries/*.ts`), which modules the bundle holds that the
   hook's run never calls, and the import chain that pulls each large group in (for example why `pre-tool-use`
   holds `code`, `lint`, `scheduler`, `keys`). Use the esbuild metafile (`inputs[].imports`) and a coverage or
   CPU profile of a real hook run (`node --cpu-prof`, `NODE_V8_COVERAGE`) against a seeded store like
   `latency.test.ts`'s.
2. What the start costs, split: read and compile, top-level evaluation (module bodies, constants, regexes,
   `createRequire`, tables built at load), and the hook's own work. Name the top-level code that costs most.
3. Why the bundles grew: per release step (0.1.364, 0.1.409, 0.1.450, 0.1.568, 0.1.600, main) the groups and
   commits that added the most bytes to `pre-tool-use` and `stop`, read from metafiles of builds at those tags.
4. Candidate cuts, each with a measured saving on hook p50/p95 (prototype in a scratch copy, never committed):
   esbuild `splitting` with shared chunks, `await import()` for rare paths, narrower imports that skip barrels or
   heavy modules, a slimmer hook entry. Say what each costs in code and in risk to the `dist` drift check,
   the key-format validity bundle (`test/keys/`) and the other harnesses that share `src/harness/build.ts`.
5. Recommend the cut set that brings every hook under 80 ms p95 on the developer host, with a reserve.

## 025-15: what the hooks do at run time and how they start (researcher: codex gpt-6-astra high)

Write `research/hook-runtime.md`. Answer:

1. Per hook, the work after load at main and at 0.1.364 and 0.1.600: store opens and SQL statements, files
   read and stat'ed, `git` or other child processes, socket round trips to the daemon, waits. Use `strace -f -c`
   and `-tt`, the CPU profile, and the code. Name what was added and in which commit.
2. Why `stop` gained 4 to 8 ms after 0.1.600 (`stop.mjs` 702 KB at 0.1.568, 738 KB at main; runtime work or
   load?). Same question for `session-start`'s 91 ms p95 run at main.
3. The start path in each harness: Claude Code `hooks/run`, Codex adapter, Pi, OpenCode, Antigravity. Does each
   set `NODE_COMPILE_CACHE` and keep `NODE_USE_ENV_PROXY` out of the hook's Node start? What does the
   `--import` restore preload of 025-07 cost when the proxy variable is set?
4. The four other latency tests `test/harness/{codex,pi,opencode,antigravity}/latency.test.ts`: what each starts,
   whether it matches its harness's real start path, and their p50/p95 at main on a quiet host (boat.dev).
5. The measurement itself: `latency.test.ts` versus the users' path (with and without the compile cache, through
   `hooks/run` or `runBundle`), and the noise between runs. Numbers for the human's choice whether the test
   measures the users' path.

Done when both files exist with tagged findings and the numbers each recommendation rests on. Use /researcher.
