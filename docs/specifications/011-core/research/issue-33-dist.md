# Issue 33: does a `dist` rewrite drop runs that loaded the same bytes?

Researcher, 2026-10-20, triage row gh-33, brief `issue-33-dist-brief.md`, about 30 minutes. Squeal source at `768987e0` (no diff from tag `squeal--v0.1.224` under `src/runners/vitest/` and `src/core/scheduler/`); probe run with the installed 0.1.224 CLI (`~/.codex/plugins/cache/hearsay/squeal/0.1.224`), Vitest 4.1.10. Cezarion read at `7fe10d992` (2026-10-19T22:48) through `git archive` into `/tmp`, `tsc` 7.0.2. One-minute load 15.6 to 24.7 on 24 CPUs during the probes.

## Verdict

**A scope defect, not a content defect: same bytes do not drop a run through the byte check, but they do through the touch rule, and the touch rule drops every file of the run in flight, files that never loaded the path included.** `tsc` rewrites all 804 `dist` files in place with identical bytes and new mtimes (verified by experiment), which reconciliation calls a *touch* (stat moved, hash equal). Since task 001-159 (013 V5 "Touched files"), any touch heard during a Vitest run withholds every file of that run, with no reachability check; a second touch during the re-run leaves them all `unknown`, none queued (verified by experiment, 0.1.224). The reason the reporter quotes, `... was written during this run and ended as it was (task 001-159)`, is exactly this path, not the 001-146 "changed on disk after this run loaded it" byte check, which compares content and ignores a same-bytes rewrite (read in source code). In cezarion no Vitest test file's closure names `packages/cezar/dist/`; only eight node:test `test:package` files do (read in the store), so every reported file was dropped for bytes it never loaded.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `tsc` rewrite `packages/cezar/dist` with the same bytes when no source changed? | Yes. Two builds: 804 files (268 each `.js`, `.js.map`, `.d.ts`), sha256 identical, all 804 mtimes moved, sizes and inodes unchanged (written in place). | verified by experiment (cezarion `7fe10d992`, tsc 7.0.2) |
| 2 | Which cezarion test files load `dist` through Vite; are they the reported 4? | None found. The only source import of the package is `import type { AppType } from '@wjarka/cezarion/app-type'` in `packages/web/src/api/client.ts`, erased before Vite loads anything. In cezar's store no `server`, `web`, `e2e`, `contract`, `api-client` closure names `dist`; 8 of 13 `test:package` (node:test) closures do, 152 to 293 `dist/*.js` each. The reported files (`conversation-resume`, `ci-wait-refusal`, `delegation-integration`, `worker-location-evidence`, `conversation-service`, `bookmarklet`, `provider-status`) have 0 `dist` paths in their closures. They were the Vitest run in flight, not loaders. | read in source code; read in the store (copy) |
| 3a | What does `sources.ts` compare for "changed on disk after this run loaded it"? | Stat first (`sameStat`: mtime, ctime, size, inode), then content: on a moved stat it re-hashes and reports the file only when `read.hash !== stamp.hash` (`sources.ts:293-295`); same bytes refresh the stamp. | read in source code |
| 3b | On current main, does a same-bytes rewrite of a loaded file drop the run? | Yes, through the touch rule, not 3a. A `touch` of `dist/gen.js` (statically imported by `slow1` only) 3 s into a run of `slow1..3` withheld all three, `failure: ... dist/gen.js was written during this run and ended as it was (task 001-159)`. | verified by experiment (0.1.224) |
| 3c | Re-queued or left UNKNOWN? | Re-queued once (011-06 since 0.1.205; note "the run is withheld and runs once more"); the re-run stored all three. A second touch during the re-run left all three `unknown`, "nothing current at their inputs, none queued". | verified by experiment (0.1.224) |
| 4 | Key defect or correct invalidation needing a hint? | Neither as framed. The key is right (no revision, content compared). The defect is the touch rule's blast radius: it taints files that never loaded the touched path, in any lane's Vitest run. A hint alone would not help: the reason already names the paths, and the only user remedy V5 offers (write under an ignored path no `inputs` names) is what `dist` already is. | inferred from the experiment and V5 |

## Findings

**Where the reason comes from (read in source code, `768987e0`).** `refinement.ts:93` hands every touched path to `runner.invalidate` as `kind: "touch"`; `adapter.ts:288` pushes it to `#touched` at once, and `adapter.ts:510` replaces the run's report with `withoutTouched(kept, testFiles, touched)`, which drops **all** `testFiles` (`moved.ts` 001-159 block). The byte-check path beside it, `withoutFiles(..., mayHaveRun(...))`, at least walks the module graph to the test files that reach a stale file. The scheduler's completion barrier (`scheduler.ts:634`, 001-168) is a second, tier-wide withhold, but it re-stats only the tier's closure paths, so in cezarion (no Vitest closure names `dist`) only the adapter path fires. 013 V5 states the adapter rule on purpose: four reviews found caches that could keep transient bytes across a revert and restore in one batch, "so a touch discards the whole instance instead of one cache at a time", and "a run under the old instance when the touch is heard makes all its files not completed".

**Why a `dist` path is a touch at all (read in the store, inferred mechanism).** A gitignored path any closure names is watched as an extra file and hashed (`keying.ts:462-472`, 011 C2). The `test:package` node:test closures name 256 `dist/*.js` (observed reads of spawned `node dist/...`), so every cezarion worktree's stat cache holds about 800 `packages/cezar/dist/` rows: 254 to 268 `.js`, 253 to 267 `.js.map`, 281 to 302 `.d.ts` across 7 worktrees. Why `.js.map` and `.d.ts` are hashed when no closure names them is not determined. A touch of any of them reaches the Vitest adapter, which owns no file that reads them.

**The probe (verified by experiment, 0.1.224).** `/tmp/issue33touch.WF3b`: the `issue-33` fixture (three 8-second tests, `slow1` imports gitignored `dist/gen.js`), `HOME` and `XDG_*` inside the probe dir. Store check: `dist/gen.js` in `file_hashes`, and only in `slow1`'s closure.

| Probe | Action | Result |
|---|---|---|
| T1 | edit `src/lib.ts`, `touch dist/gen.js` at 3 s (same bytes, same inode) | run withheld 3 of 3, `slow2`/`slow3` included; re-run once, stored |
| T2 | as T1, touch again at 13 s during the re-run | both runs withheld 3 of 3; all three `unknown`, none queued |

The cezarion incident fits T2's shape: `npm run typecheck` (build of `dist`), then `npm run build` (another), each touching ~800 paths while a Vitest tier ran; the reporter's 4 test files per typecheck are consistent with one Vitest run in flight (inferred; cezarion's `tierSize` is 12, and how many files that run held was not read).

## Recommendation for Squeal

Narrow 001-159 to what the instance could have read, as 001-146 already is: withhold a run for a touch only when the touched path is a module some environment of the instance cached or stamped (or a declared/virtual input of one, or a CSS dependency), and, for those, only the test files whose graph reaches it (the `mayHaveRun` walk); a touch of a path the instance never loaded neither withholds nor needs to replace the instance. The decision the spec must make is whether V5's four caches (virtual module input, CSS `@import`, optimizer bundle, now off since 001-176) all register their reads in the module graph or a stamp; if one does not, that cache, not the whole run, needs its own rule. A regression should run T1 against a file in no closure of the run (nothing withheld) and keep T1 against `slow1` itself (withheld). Until then the reporter's workaround (`tsc --noEmit`) stays right.

## Open questions

- Why `.d.ts` and `.js.map` under `dist` are in cezarion's stat cache when no closure names them: not determined in the time box (a directory watch of an extra file's parent is a guess).
- Whether a same-bytes touch can carry real risk for a module the run did load: `tsc` writes in place, so a reader mid-write could see truncated bytes; V5 assumes yes. Not measured.
- Whether the node:test adapter has a touch rule of its own: not read.

## Limitations

One synthetic repo, one Vitest project, one host under load 15 to 25; cezarion's Squeal was not run. The cezar store was read from a copy taken at 00:36 and holds state from several worktrees and Squeal versions, including `test:package` closures possibly from an older config.

## Sources

- hearsay-tools/squeal#33 and its comments of 2026-10-18 (`gh issue view 33 -R hearsay-tools/squeal --comments`).
- `src/runners/vitest/moved.ts` (`withoutTouched`, `mayHaveRun`), `src/runners/vitest/adapter.ts:81-86,288-294,440-512`, `src/runners/vitest/sources.ts:208-310`, `src/core/hash/stat-cache.ts:21-30`, `src/core/scheduler/stability.ts:59-71,146-158`, `src/core/scheduler/refinement.ts:93`, `src/core/scheduler/scheduler.ts:620-650`, `src/core/scheduler/ledger.ts:419-442`, `src/core/scheduler/keying.ts:462-472`; commits `af78a7f6` (001-159), `aa260ef0` (011-06, in `squeal--v0.1.215`).
- `docs/specifications/011-core/spec.md` C2 (line 78), C4 (line 146), C12; `docs/specifications/013-vitest-runner/spec.md` V5.
- Cezarion `7fe10d992`: `packages/cezar/package.json` (`"build": "tsc"`, `exports` to `./dist/...`), `packages/cezar/tsconfig.json`, `packages/web/package.json` (`pretypecheck`), `packages/web/src/api/client.ts:164`; `/home/agent/projects/cezar/.git/squeal/store.sqlite` (copied to `/tmp`, opened read-only).
- Probes: `research/probes/issue-33-dist/` (`build-twice.sh`, `touch-probe.sh`, `touch-twice.sh`, `runlog.cjs`, `cezar-store-dist.cjs`, `cezar-store-reported.cjs`, `README.md`); fixture `research/probes/issue-33/fixture/`.
