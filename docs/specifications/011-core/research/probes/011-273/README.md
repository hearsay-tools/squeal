# Probe for row 011-273 (throwaway)

Throwaway. Not part of the product suite; nothing imports it. It backs `research/named-wait-rule.md` findings F1 to F4 and P5.

`probe.test.ts` drives `RunQueue`, `Promotions`' published row and the focused row through their public modules, on a private temporary store. It starts no daemon or runner.

Run from the repository root, with the one-minute load below the CPU count:

    env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run --config docs/specifications/011-core/research/probes/011-273/vitest.config.ts --silent=false --reporter=verbose

Recorded run: 2026-10-31, commit `b34b00682`, Vitest 5.0.3, load 21.4 to 23.0 on 24 CPUs, 5 of 5 passed in 1.2 s. Output in `result.txt`.
