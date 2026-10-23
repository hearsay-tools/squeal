# Issue 80: a new module that an edit starts importing

Research for [#80](https://github.com/hearsay-tools/squeal/issues/80), brief `research/issue-80-brief.md`. Researcher, 2026-10-23. Squeal 0.1.276 (installed Codex plugin, `/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.276/dist/cli/squeal.mjs`). The issue's incident version is unknown (0.1.275 or earlier). Host: 24 CPUs; one-minute load 9.58 to 23.49 at the starts of the runs counted here, with two runs skipped above 24 and the queue held up to 54.

**Verdict: not reproduced.** In 6 runs (three layouts on each of two stacks), 5 cases each, every case where the module existed at the run's revision passed on a warm daemon, as the cold `vitest run` did. That includes cezarion's own stack (Vitest 4.1.10, Vite 8.1.4, jsdom 29.1.1, projects layout, `.tsx`). The resolver-cache cause the issue suggests is not shown: Vite's native resolver cache is off whenever `server.watch` is `null`, a started instance reports `null` for the root and the `web` project on both stacks, and no cezarion config sets `server.watch` (Q3).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Create a module, then edit an existing source to import it, under a warm daemon: does the next verdict match a cold run? | Yes. PASS on warm and cold, in every layout, on Vitest 5.0.3 and 4.1.10. | verified by experiment |
| 2 | Missing import first, the module created after: does the warm daemon clear the failure? | Yes. FAIL while the module is missing, PASS at the next settled revision, in every layout and stack. | verified by experiment |
| 3 | Does a resolver or module-graph cache keep the earlier "missing" answer? | Not shown. No probe kept it. Vite's native resolver cache is on only when `server.watch !== null`; a started Vitest 4.1.10 and 5.0.3 instance reports `null` for the root and the `web` project, and cezarion's configs set no `server.watch`. A module-runner cache in the worker was not examined apart from these runs. | verified by experiment (watch value); read in source code (cache rule); inferred (cezarion) |
| 4 | Is #80 the same defect as #56 (011-60)? | Not proven. #56 is a child-process input that never re-keys; here the key moves, and the import is in the transform graph. No evidence links them. | inferred |
| 5 | Does the regression denial (acceptance criterion 2) follow from a false red? | Not tested. The probe uses no hooks. | not determined, because the probe ran no Claude Code hook |

## Findings

**Q1 and Q2.** `probes/issue-80/probe.mjs` runs five cases in one warm daemon (A: create, settle, edit the importer; B: both in one burst; C: missing import, then create; D: importer 200 ms before the module; E: as C, with a run request racing the create). `VERDICTS` lines, 0 pass, 1 known failures:

| Stack | Layout | A | B | C missing → created | D | E missing → raced → settled | cold |
|---|---|---|---|---|---|---|---|
| Vitest 5.0.3, Vite 8.3.2 | single | 0 | 0 | 1 → 0 | 0 | 1 → 0 → 0 | 0 |
| Vitest 5.0.3, Vite 8.3.2 | projects | 0 | 0 | 1 → 0 | 0 | 1 → 0 → 0 | 0 |
| Vitest 5.0.3, Vite 8.3.2, jsdom 30.1.3 | web | 0 | 0 | 1 → 0 | 0 | 1 → 0 → 0 | 0 |
| Vitest 4.1.10, Vite 8.1.4, jsdom 29.1.1 | web | 0 | 0 | 1 → 0 | 0 | 1 → 0 → 0 | 0 |
| Vitest 4.1.10, Vite 8.1.4 | projects | 0 | 0 | 1 → 0 | 0 | 1 → 0 → 0 | 0 |
| Vitest 4.1.10, Vite 8.1.4 | single | 0 | 0 | 1 → 0 | 0 | 1 → 0 → 0 | 0 |

(Verified by experiment: `probes/issue-80/output-*.txt`.) The `web` layout gives the issue's message exactly: `Failed to resolve import "./navigation" from "packages/web/src/c/scroller.tsx". Does the file exist?`, from Vite's `vite:import-analysis` (`source-evidence.txt`). The Node layouts give `Cannot find module './navigation' … (ERR_MODULE_NOT_FOUND)` instead. So the incident's failing files ran in a web environment, as cezarion's `packages/web` (`environment: 'jsdom'`) does.

One earlier version of the probe asked for a run without waiting for the create to settle. In `web` on 5.0.3, case C's run then reported "no verdict: revision 5 was recorded after the checkpoint's revision 4" and kept the revision-4 failure listed as "pending" while the rerun ran. That is a checkpoint racing a write, not a stale resolution. That output was overwritten when the probe was fixed (verified by experiment, output not kept). A status read in that window shows the earlier red, which a hook or agent could take as current only if it ignored "pending".

**Q3.** Vite 8's resolve plugin passes `disableCache: command === "serve" && server.watch === null` to rolldown's native resolver, and clears that cache through `watchChange` (`vite/dist/node/chunks/node.js:28977`, `:29017`, Vite 8.3.2; the same expression at `:32069` in Vite 8.1.4). Squeal starts Vitest with `watch: false` (`src/runners/vitest/adapter.ts:188`) and calls `watchChange` only for `package.json` (`src/runners/vitest/stale.ts:109`). So the resolver cache would keep a "missing" answer after an add exactly when a server has `server.watch` not `null`. Vitest 5.0.3 forces `null` in `configResolved` for the root when watch is off and for every project ("project servers never watch; the top-level server owns the watcher"). Vitest 4.1.10 sets the root's in `configResolved` too (`cli-api.BK8pd4xc.js:14175`), but a project's `null` comes from its `config` hook (`:10338`), which a user config could in principle override (read in source code). `probes/issue-80/watch-check.mjs` starts each stack's `web` fixture with `watch: false` as Squeal does and prints `{"vitest":"4.1.10","root":null,"projects":[{"name":"web","watch":null}]}` and the same for 5.0.3 (verified by experiment, `watch-check-output.txt`). cezarion's `packages/web/vite.config.ts` (at 565fd3eaf) sets `server: { proxy }` and no `watch`, and no `vitest.config.ts` there sets `server` (read in source code). Inferred: on cezarion's configuration the native resolver runs with its cache off, so this mechanism does not explain the incident. The worker's module runner and Vitest's own caches were not examined beyond what the runs exercise.

**Q4.** #56 (board row gh-56, 011-60 deferred) is about an absent child-process input that never enters a key. Here the importer's edit re-keys its test files, and `invalidate` stales the importer's transform (013 V2's add rules, `spec.md` line 21). Read in the spec and the status log; no experiment links the two.

## Recommendation for Squeal

Do not write a fix from this evidence: no run reproduced it, and the suggested cause is off on cezarion's configuration. Next steps, cheapest first:

1. Have the reporter record the Squeal version and `squeal status --full` at the next occurrence: the incident's version is unknown, and whether the red was "current" or "pending" at the revision named is not recorded.
2. If it recurs, rerun this probe inside a copy of cezarion's `packages/web` config (React and Tailwind plugins, `setupFiles`, the `@` alias, many importers) to find which difference matters.

The issue's regression test (acceptance criterion 1) is case A or C of this probe; it passes on 0.1.276 in every layout tried, so as written it would pass before any fix.

## Limitations

- The fixture is small: one importer per case, five test files, no `setupFiles`, no React or Tailwind plugin, no `@` alias, no Vite config of its own. The incident had about 150 checks in 7 test files and an importer that several files import.
- The probe took about 20 minutes of work and longer by the clock, since load held the live runs back.
- The installed 0.1.276 plugin, not 0.1.275, ran the probe. The incident's version is not recorded.
- No hooks ran, so the Write denial was not reproduced.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/80 (fetched 2026-10-23 with `gh api`).
- Probe, outputs and source extracts: `research/probes/issue-80/` (`probe.mjs`, `watch-check.mjs`, `README.md`, `output-*.txt`, `watch-check-output.txt`, `source-evidence.txt`).
- cezarion checkout `/home/agent/projects/cezar` at 565fd3eaf: `packages/web/vite.config.ts`, `packages/web/vitest.config.ts`, `vitest.config.ts`.
- Vite 8.3.2 `node_modules/vite/dist/node/chunks/node.js` (this worktree); Vite 8.1.4 under `/home/agent/projects/cezar/node_modules/.pnpm/vite@8.1.4_…/node_modules/vite/dist/node/chunks/node.js`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/index.DpLw24bj.js:9466`, `:9730`; Vitest 4.1.10 `/home/agent/projects/cezar/node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:10338`, `:14175`.
- Squeal: `src/runners/vitest/adapter.ts`, `src/runners/vitest/stale.ts`; 013 `spec.md` V2 to V7; 011 `spec.md` C2 to C4; board row gh-56.
