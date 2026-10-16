# Throwaway probes: issue 13

**Throwaway.** Nothing here is product code. These files exist only to produce the evidence in `../../issue-13.md` (hearsay-tools/squeal#13). Delete them freely.

- `format.probe.ts`: formatter reproduction. The product's reason builders (`withoutTouched`, `withheldForTouch`, `withholdNote`) and renderers (`formatDelta`, `unknownFileText`), fed synthetic artifact paths sized like the issue's.
- `scheduler.probe.ts`: the real scheduler, Vitest adapter, store and delivery (`test/scheduler/helpers.ts`). A held run hears the touch of `ISSUE13_PATHS` (default 600) committed `dist/*.d.ts` files rewritten with their own bytes. The batch is handed over by the harness; no watcher, daemon or hook runs.
- `results/`: the recorded outputs, 2026-10-16, at 4e6354d7.

Run from the repository root after `npm ci`:

```sh
P=docs/specifications/001-core-loop/research/probes/issue-13
npx vitest run --config $P/vitest.config.ts $P/format.probe.ts --silent=false --reporter=verbose
ISSUE13_PATHS=600 npx vitest run --config $P/vitest.config.ts $P/scheduler.probe.ts --silent=false --reporter=verbose
```
