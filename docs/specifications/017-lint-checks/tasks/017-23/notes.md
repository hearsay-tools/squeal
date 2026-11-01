# 017-23: lint news at Stop

Row 017-23 makes a lint change news at Stop by itself (spec D8 "At Stop",
the human 2026-11-01: "Yes, like tests"). It replaces 017-10's decision 2
(`../017-10/notes.md`): lint was told at Stop only beside other news.

## The seam

`src/core/delivery/delivery.ts` `deliver`. Before:

```ts
const changes = liveness && (tests || !stop);
const code = tellCode(..., { changes, ... });
lintRead.read = changes ? readLintNews(...) : null;
```

After (two commits):

```ts
lintRead.read = liveness ? readLintNews(...) : null;
const lint = lintRead.read?.news ?? null;
const changes = liveness && (tests || lint !== null || !stop);
const code = tellCode(..., { changes, ... });
```

At a tool boundary that is not a Stop, `changes` was already `liveness`,
so nothing changes there. At Stop, lint is read whatever the tests say,
and a code change rides beside lint news (decision 1).

Everything else was in place:

- Every harness's Stop goes through `src/harness/shared/stop.ts`
  `stopTurn` → `newsText` → `delivery.onToolBoundary(consumer, { stop: true })`
  → `deliver` with `liveness: true`. A delta with only lint news is
  `news`, so Stop speaks: Claude Code as context that keeps the turn going,
  Codex as a `block` whose reason is the news, OpenCode and Pi as the
  continuation's report.
- "Told once": `acknowledgeLint` writes the consumer's lint mark after the
  delivery's transaction commits (017-10 decision 1). The next Stop reads
  nothing new and ends the turn.
- "Not waited for": Stop's wait (`waitForPending`) reads only the tests'
  header. Lint has no wait. A file still `pending` at Stop is deferred by
  `news.ts` `fileStep` and the next boundary (tool call, prompt) tells it.
- "With `lint.blocking` off, Stop holds no further": `lintStopReasons`
  (`stop-lint.ts`) gives no reason when blocking is off. With it on, the
  block carries the reason and the same news text.
- The waiting Stop entry (`stop-slow.ts`) tells news only beside its own
  block, and is silent when the 2 s entry spoke. Lint news follows it.
- A SubagentStop now tells a subagent's lint change too, as it tells its
  test changes, and still unregisters the subagent.
- The idle waiter (`deliverIdle`, `liveness: false`) still reads no lint.
  A lint result stored after the turn ended waits for the next prompt or
  tool call; it does not wake the agent.

No change in `src/core/lint/surface/deliver.ts`, `news.ts`, `told.ts` or
`src/harness/shared/stop*.ts`. Sibling W1 (017-15) rekeys those lint maps
by path and tool; this row does not collide with it.

## Tests

`test/lint/wiring/stop.test.ts`, over the real lint pass and a fake
provider:

- Per harness (Claude Code, Codex, OpenCode, Pi): an edit adds one
  finding, no tool boundary after it. The first Stop tells
  `FAIL lint: src/b.js: 1 finding, +1 no-console (no-console found)` under
  `SQUEAL · 1 lint change at revision N`. The Stop after it is silent and the
  turn is idle; a later Stop is silent too. Red before the change in all
  four.
- Per harness: a test failure and a lint change at one Stop are told in one
  delivery, the test block first, and not again.
- Claude Code: an edit the lint pass has not judged at Stop gives a silent
  Stop that ends the turn; once the pass stores it, `UserPromptSubmit`
  tells it.
- `test/lint/wiring/stop-code.test.ts`, through the shared delivery with a
  seeded code store: a Stop whose news is lint alone tells a complexity
  change beside it, both once; a Stop with only a code change still tells
  nothing, and the next tool boundary tells it; with lint off, a Stop with
  a lint finding in the store and a code change tells nothing, and with a
  test change its text equals a delivery without the lint source.
- Claude Code: `lint.blocking` off tells the change as context, never a
  block; on, the block reason names the file and carries the same line,
  and the Stop after it (`stop_hook_active`) is silent.
- The evals' parser (`evals/lib/squeal-text.mjs` `squealEvidence`) reads the
  Stop's text, plain and as the hook's JSON, with no test check and no
  failure. `test/evals/lint-lines.test.ts` is unchanged.

`test/lint/wiring/rig.ts` gains `hookedRepo`: a `squealRepo` with a lint
policy, linted once, whose `edit` and `write` can carry test results so
the tree's and the main store's revisions move together.
`hooks.test.ts` uses it instead of its own copy.

## Decisions the spec did not settle

1. **Code changes at a Stop whose only news is lint** (the coordinator,
   2026-11-02: option (b)). 015 D6/D7 say a Stop tells code changes "only
   beside other news". The reading this row applies: lint news is other
   news, so a code change rides beside a Stop's lint news, as it rides
   beside test news. A Stop whose only change is code's still tells
   nothing. `deliver` now reads lint first (read only, acknowledged after
   the delivery commits, as before) and passes
   `changes: liveness && (tests || lint !== null || !stop)` to `tellCode`.
   Lint news here is any `LintNews`: entries, a config summary or a D9
   reason. With lint off, `readLintNews` is `null` and the condition is
   015's as before. The coordinator amends 015's `status.md` with its
   coordinator.
2. **Which boundaries read lint.** Every delivery with `liveness`: tool
   boundaries, `startTurn` and Stop. Not `peek` and not the idle waiter,
   as before.

## For the next worker

- The per-harness Stop drivers in `stop.test.ts` (`Harness`) are a
  pattern for any "at Stop, in each harness" done-when. Codex's recorded
  input names its own session; read the consumer from it.
- W1 (017-15) adds `tool?` to `LintNewsEntry`; once oxlint lines exist, a
  Stop with an oxlint change takes the same path and needs no change here.
