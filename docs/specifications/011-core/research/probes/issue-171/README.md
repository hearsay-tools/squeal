# Probe: issue 171 (throwaway)

Throwaway. Not product code, not part of any suite. Run once for
`../../issue-171.md`; delete when that finding is closed.

    node_modules/.bin/vitest run --config docs/specifications/011-core/research/probes/issue-171/vitest.config.ts

It uses an in-memory-style fresh store from `test/state/helpers.ts` and
`createDelivery` directly. No daemon, no hook process, no real HOME.
