# Throwaway OpenCode continued-turn diagnosis

Row 011-284, wave 63 R2. These probes are research only. They do not change product code, checked-in bundles, timeout values or test policy. Runtime fixtures and built bundles live in private `/tmp` directories; no `node_modules` is committed.

Sources: Squeal `33cdf29a1`, Node 24.22.1, Vitest 5.0.3, OpenCode 1.18.35. The relevant test, fixture and OpenCode source files are unchanged from failed CI commit `6ceaf9b85`.

Run from the repository root, alone, only below the host's CPU count in load:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run --config docs/specifications/011-core/research/probes/ci-opencode-continued/vitest.config.ts --silent=false
```

The custom config runs only `deadline.probe.ts`, with one worker and the repository's normal cleanup. It builds the normal OpenCode fixture into `/tmp`, then wraps only that private Stop entry. There are three serial cases:

1. Normal Stop, with timestamps at the plugin and bridge boundary.
2. A 700 ms asynchronous pause before the Stop handler. The 500 ms idle budget kills the bridge before delivery.
3. A 700 ms asynchronous pause after the Stop handler prepared its output. The idle budget kills it after delivery was committed but before the plugin reads its answer.

These pauses model scheduling or output delays without making CPU load. Both delayed cases keep the original 30,000 ms poll and expect it to expire. They then send a real user prompt and inspect its model request. This shows whether the transition survives. They exercise the initial continuation only; the unchanged original test covers the recovery and aborted-continuation paths.

The probe wraps `promptAsync` and the plugin hooks to trace calls. It logs the prepared Stop report and the consumer view after expiry. It checks that the normal continuation contains `PASS -> FAIL`, the pre-handler timeout preserves that transition for the next prompt, and the post-handler timeout loses it. The last assertion describes current behavior, not a desired regression-test expectation.

`ci-excerpt.txt` preserves the fetched CI timestamps and stack. `local-results.txt` preserves the successful baseline and corrected probe run. `initial-probe-error.txt` preserves the first probe run's harness error: it passed `ConsumerRecord` where the store required `.consumer`; this was fixed only in the throwaway probe. No product failure claim relies on that erroneous store read.

Reproduction limit: the original two-test file was run once. The three-case probe was run twice (the second corrected its store read). No full suite, retry command, CPU stress, dependency install or repository-wide build was run.
