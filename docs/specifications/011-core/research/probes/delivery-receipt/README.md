# Throwaway delivery-receipt probes

Research only, row 011-288. Squeal `ecf1d10b4` (0.1.384), Node 24.22.1,
Vitest 5.0.3. No product code or committed bundle is changed. No real harness
session runs. No daemon starts: `ensureDaemon` is a stub that returns `alive`.
The test helpers make temporary repositories and real SQLite stores under `/tmp`.
The probe bundles only its small entry and imported handlers into temporary files
with esbuild. Child processes and workers receive a private HOME. No credentials
are passed and no node_modules are committed.

Run from the repository root:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run --config docs/specifications/011-core/research/probes/delivery-receipt/vitest.config.ts --silent=false
```

One file, one worker, six serial cases. The probe seeds PASS, registers a consumer,
then records FAIL. It calls each real tool-boundary handler. At handler return it
writes a private marker with the prepared report, proving that the view committed.
A normal control returns immediately. The delayed case awaits an asynchronous
3-second timer before stdout or `postMessage`; it creates no CPU load.

- Claude Code and Codex: real handler + serializer in a child process; a **modeled**
  host kills it after the configured 2 seconds. This does not test either live
  harness. Their timeout rules are established separately by docs/source.
- Pi: real handler in a worker and the **real `createDeliveryHost`** enforce the
  extension's actual 2-second bound. This does not start Pi itself.

Each case checks the prepared PASS -> FAIL, persisted failing view, transport
result, and absence of that transition at the next shared tool boundary. The
next boundary is called through Pi's thin `toolBoundary` wrapper, which uses the
same shared delivery core as the two process hooks. Registration also uses the Pi
wrapper for all cases to isolate the delivery question from startup packaging.
The loss assertions describe current behavior; a repair must reverse them.

`results.txt` is the one run: 6/6 passed, 8.45 s. The normal transports took
67–75 ms; delayed cases ended after 2,003–2,012 ms. These are fixture timings,
not a production latency estimate. `sources.txt` holds short fetched source
excerpts and snapshot hashes. Full downloaded pages stayed outside git in `/tmp`.
