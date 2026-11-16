# 011-371: `Scheduler.idle()` goes (wave 116 W1)

Worker 98337e28, 2026-11-16. Base: main `bbd3f9d99`.

## Removed

- `src/core/types/scheduler.ts`: `idle(): Promise<void>` and its doc comment, from the `Scheduler` interface.
- `src/core/scheduler/scheduler.ts`: the `idle()` method; the `#idle` resolver list; its two resolve loops (at `close()` and at the pump's end); `#isIdle()`, which had no other use. `#stalled`, `#busy`, `#pumping` and `#admit()` stay: other code reads them.
- No behaviour change: nothing in `src/`, `evals/` or `scripts/` called `idle()`; the removed resolve loops only settled promises of that method. No tier, order, width, status payload, note text, CLI output or key change, so `key-format` needs no raise.

Left as is: other classes' `idle()` (coverage writer, code and lint passes, shared reader, the OpenCode turn) and the `"idle"` values of other types (`slow.trigger`, delivery turn, shutdown reason). Comments in `test/` that say what `Scheduler.idle()` did stay as history; `quiet-point-abandon.test.ts` now says "did" instead of "does". `git grep` still finds `scheduler.idle()` in 68 files under `docs/` (old research probes and reviews, records, not compiled: `tsconfig.json` includes only `src` and `test`); not edited.

## Review `011-380-b4-b6.md` N1

Option taken: narrow the comments. `test/scheduler/scheduler-rest.test.ts` cases 1 to 3 no longer claim the pump's last pass came before the rest; they say the record (and, in case 2, the gather's end) came first, which is what `side.current(path)` checks. No barrier was added: one would need a hook at the pump's end that the scheduler does not expose, and the brief allows either option. The assertions still use `rest()`, not `quiet()`.

## `GLOSSARY.md` "Rest"

No change needed: it does not mention `idle()`. Its `_Avoid_: idle (...)` line names the word, not the method, and stays.

## Checks

- `git grep -nE "scheduler\??\.idle\(|Pick<Scheduler, \"idle\">" -- src test evals scripts`: nothing.
- `pnpm run typecheck`: pass. `pnpm run lint`: pass (3540 files).
- One run, `scheduler-rest`, `model-scheduler`, `key-format`, `quiet-point-abandon`: 4 files, 25 tests passed, 16.2 s; then `scheduler-rest` twice more, 3 of 3 each. Load 8.1 before, 10.6 after, on 24 CPUs.
