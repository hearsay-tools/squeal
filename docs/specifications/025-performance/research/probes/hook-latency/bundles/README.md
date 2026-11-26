# Probes for row 025-14 (hook bundles): throwaway

Throwaway probes for `research/hook-bundles.md`. They change no product code and
never write `plugins/*/dist`; scratch builds go to `$TMPDIR`. Run from the
repository root unless a probe says otherwise.

| Probe | What it does |
|---|---|
| `sections.mjs` | Bytes per source file (or group) of a bundle, from esbuild's `// src/...` module comments |
| `growth.mjs`, `growth.txt` | Per release step, the groups and files that grew a committed hook bundle |
| `commits.sh`, `commits.txt` | Per release step, the first-parent commits that grew a committed hook bundle most |
| `build-variant.ts` | Scratch build of the hook bundles with `bundleOptions` plus a variant (minify, split, builtins, lazy, cut) |
| `hook-runs.probe.ts`, `vitest.probe.config.ts` | `latency.test.ts`'s seeded store and cases, run against several dists interleaved; optional coverage, CPU profile, compile cache |
| `summarize.mjs`, `parity.mjs` | p50/p95 per case and dist; stdout parity of a variant against the base build |
| `coverage.mjs`, `coverage-main.txt` | Source files of each bundle no function of which ran (`NODE_V8_COVERAGE`) |
| `dominated.mjs`, `dominated-main.txt` | Never-called modules whose lazy import would take the most bytes out of a bundle |
| `chains.mjs`, `chain.mjs` | Import chains from a hook entry (metafile) |
| `phases.mjs` | Stripped copies of a dist (empty, builtins, parse, eval) that split a run into phases |
| `profile.mjs`, `profile-main.txt` | `--cpu-prof` profiles split into Node start, top-level evaluation and hook work |
| `builtins.mjs`, `builtins-host.txt` | Start cost of each `node:` builtin, alone and at the margin |
| `parse-size.mjs` | Read-and-compile cost of the bundles of several releases |
| `boat.sh`, `remote.sh`, `boat/run1/` | The quiet-host run on a boat.dev sandbox (9950X): parity, builtins, phases, variants, parse size |
| `rounds.sh`, `summarize-rounds.mjs`, `boat/rounds/` | Four interleaved rounds of the main variants on a second sandbox (9700X), pooled |
| `host/` | Development-host phases and variants (load 2.1 to 3.3), raw samples and summaries |

Run a probe test: `timeout 600 pnpm exec vitest run --config docs/specifications/025-performance/research/probes/hook-latency/bundles/vitest.probe.config.ts`
with the `PROBE_*` variables its header lists.
