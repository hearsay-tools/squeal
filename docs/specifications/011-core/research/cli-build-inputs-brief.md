# Research brief 011-127: what keys a test that builds the CLI at run time

Use /researcher. Shape: research.

Outcome: a choice the coordinator can bring to the human. For each of this repository's test files that build the CLI or a plugin bundle while they run, the findings say what their key holds now, which `src/` edits leave them current though their bundle changed, and what each fix costs on this host.

## Why

On 2026-10-23, worker e8b08f00 edited `src/core/scheduler/scheduler.ts`. Squeal then kept `test/daemon/busy-tier.test.ts` current, so a worker's `squeal run --all --wait` could report a stale pass. The daemon tests build the CLI through esbuild (`daemonSuite`, `buildCli`, `quietCli` in `test/daemon/helpers.ts` and the CLI helpers). `squeal.config.json` declares `src/**/*.ts` for the harness tests (row 001-399), but not for these. CI and the locked gate run every file, so landings are safe. Workers' verdicts are not.

## Questions

1. **Which files.** List every Vitest file that builds a bundle at run time, with the helper it uses and the entry it bundles. Board row 011-127 names about 60 by directory.
2. **What their key holds.** For a sample of them (at least one per directory), give the closure Squeal records, its observed runtime inputs and its declared inputs. Then list which `src/` files the bundle holds and the key does not.
3. **Option A: declare `src/**/*.ts` for them**, as 001-399 did. Measure the cost on a scratch clone: the files one typical `src/` edit re-keys, and their summed and wall run time at 4 workers. Use the 011-126 and 011-124 edits as samples, and record the load beside each timing.
4. **Option B: the run observes the bundle's inputs.** Can esbuild's metafile (or the helper's own list of bundled files) be recorded as paths the run read, through the existing observation path (spec 011 C4, 004 D8, `observe.runtimeInputs`)? Name the seam, the store or key change it needs, and whether `KEY_FORMAT_VERSION` must rise.
5. **Other options**, such as a narrower declaration per directory, or caching the built bundle by its inputs, with their costs.
6. **Recommendation.** The options ranked by correctness, then by CPU cost per edit. Give each its spec sections and its regression test.

## Rules

- To reproduce, `git clone` this repository under `/tmp`, never `git worktree add`. Install offline with `npm ci --offline`. Run any scratch daemon with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`, and at most 4 test workers. No build in your worktree. Never run a script under `evals/bin/`.
- The live host is read-only evidence. Never connect to a live daemon's socket, open a live store, or signal a process you did not start.
- At the end, stop what you started, remove your clones, and show that nothing of them is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Budget about two hours.

Own `research/cli-build-inputs.md` and `research/probes/cli-build-inputs/` only. Edit no board, spec, status, config, test or product file.

Done when every numbered question has a tagged answer, or "not determined, because". The cost of option A must be measured, not modelled. Commit.
