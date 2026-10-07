# Throwaway Node test runner API probes

These are throwaway research probes, not Squeal product code or a supported adapter.
`node_modules/`, fetched `sources/`, and generated `.scratch/` fixtures are ignored.
The fixture generator creates `packages/demo`, typed `*.test.ts` files, a CJS
import, an extra `--import ../../scripts/preload.mjs`, and `--import tsx`.
It intentionally creates failing tests, syntax errors, hangs, and snapshots.

From this directory:

```sh
npm ci --ignore-scripts
node probe.mjs /home/agent/.nvm/versions/node/v22.23.3/bin/node
node probe.mjs /home/agent/.nvm/versions/node/v24.21.0/bin/node
```

Run versions sequentially to avoid competing benchmarks. `probe.mjs` starts a
fresh process per case (except the explicit repeated-run cases). It bounds child
process groups with an 8-second watchdog, or 30 seconds for 20-file process tests.
The script exits successfully when observation is complete; individual expected
failures are recorded, not asserted away. `api.mjs` consumes `run()` directly;
`reporter.mjs` consumes the CLI's identical event interface and preserves Error
properties through `serialize.mjs`. Result files preserve arguments, exit status,
timings, events, stderr and fallback reporter output. `<fixture>` and `<probe>`
replace machine-specific fixture paths. Benchmark records retain summaries rather
than every event. Durations are wall-clock milliseconds, with three samples per
configuration, on the same loaded Linux host; they are not portable performance
budgets. Each result records CPU, available parallelism and initial load average. The
launcher sets `NODE_OPTIONS` empty, but this environment still injects proxy
warnings; measured startup includes host instrumentation. No environment values
other than the fixture markers are logged.

Versioned sources used by the report were fetched with HTTPS from
`https://raw.githubusercontent.com/nodejs/node/v<VERSION>/` for:

- `doc/api/test.md`, `doc/api/cli.md`, `doc/api/typescript.md`
- `lib/internal/test_runner/runner.js`, `tests_stream.js`, `test.js`

Their canonical URLs are in the findings. Sources are not vendored here.

After both versions, run `node summarize.mjs` to regenerate `evidence.md`, then
`node check-results.mjs` to check the main observations against the saved records.

## Raw records

The raw per-case records (`results/v22.23.3.json`, `results/v24.21.0.json`, about 1.8 MB together) were dropped at integration (coordinator, 2026-10-07) to keep the repository small; `evidence.md` and `verification.md` summarize them, and `probe.mjs` regenerates them.
