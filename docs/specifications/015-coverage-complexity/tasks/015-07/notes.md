# 015-07 notes: delivery, status and `squeal code`

Worker efe25473, 2026-10-24. What 015-08 and the review read first.

## Seam map

| What | Where |
|---|---|
| Payload types: `CodeDeltaEntry`, `CodeNews` (`Delta.code`), `CodeRegistration` (`Registration.code`), `CodeStatus` (`StatusSnapshot.code`), `CodeRecount`, `CodeTooBig`, `CODE_LISTED_MAX` | `src/core/types/code-delivery.ts` (imported directly, not through `types/index.ts`) |
| Where hooks, status and the CLI open the code store; nothing is opened while the policy is off | `src/core/delivery/code-source.ts`: `codeSource(commonDir, root)`, `withCode` |
| The view diff, pure | `src/core/delivery/code-delta.ts`: `planCodeDelta`, `seedEntry`, `codeKey` |
| Seeding at registration, the delivery's news, the recount and too-big records | `src/core/delivery/code-deliver.ts`: `registerCode`, `tellCode`, `readRecount`, `isTooBig`, `lineOf`, `lastTransition` |
| "Since this session started" | `src/core/delivery/code-since.ts`: `codeSince` (shell session, else oldest registration), `consumerSince`, `wentOverSince`, `changedSince` |
| Text | `src/core/delivery/code-format.ts`; `format.ts` adds the lines after every test block (in the tail, never cut) and the registration line after `Known failures` |
| The two calls | `delivery.ts`: `registerCode` in `register`, `tellCode` in `deliver` (tool boundaries and turn starts; at a Stop only beside other news) |
| Hooks' source | `src/harness/shared/context.ts` passes `code: codeSource(...)` to `createDelivery` |
| Status | `src/core/status/code-status.ts`, called from `snapshot.ts` and `format-status.ts`; `StatusOptions.shell` from `waitConsumer(env)` in `main.ts` |
| D7 | `src/harness/shared/stop-code.ts`, called from `stop.ts`'s `decide` |
| `squeal code` | `src/cli/code.ts` (command, text), `src/cli/code-report.ts` (read model, JSON shape) |

## The contract with 015-06 (coordinator, 2026-10-24)

1. `states.removeMany` keeps view entries; `views.removeMany(consumer, entries)` is new (commit f0700c908). The delivery tells a removed `fail` once, then removes the entry.
2. The pass writes code `meta` `recount:<worktreeId>` = `{ revision, at, reason, threshold }`, reason `first`, `threshold`, `include` (`maxFileBytes` too) or `counter`, the first that applies in that order. A consumer seeded before `at` gets one summary line and is seeded again by count.
3. No `first-seen-fail` at a first count.
4. A file over `maxFileBytes` has a `files` row with `tooBig` and no count; `uncounted` leaves it out. Until 015-06 lands, `isTooBig` reads `tooBig` as an optional field, so this tree compiles before and after; the too-big test marks the field through a wrapped source.

The told marks are code `meta` keys per consumer: `seeded:<worktree>:<session>:<agent>` (epoch ms) and `tooBigTold:<...>` (JSON paths). They are never pruned; a quality pass may drop them with the views of a consumer that left.

## Decisions the spec left open

1. **A change is told only when its last transition explains it** and is newer than the view entry and the seed. Any other difference (a first count, a recount without its record, a pending file counted) is written to the view silently, told by count. So a missing recount record floods nothing.
2. **`pending` and `unknown` are never seeded or told**; their view entry stays as it was.
3. **At a Stop, code news rides only beside other news**, so a code change alone never keeps the agent going (D7). It is told at the next tool boundary or prompt.
4. **A peek and the idle waiter carry no code**: a code failure never denies and never wakes an idle agent.
5. **The changes past 5** are written as told by `count`, the 5 listed as `full`.
6. **Wording beyond the spec's lines**: `RESOLVED complexity: <name> (<path>) is no longer in the code`; `(radon rule)` for `.py`; a second function of one name reads `name (occurrence 2)`; the code-only title `SQUEAL · N complexity changes at revision R`; `first` reads `Complexity counted: N functions over T; squeal code lists them.`, `include` and `counter` say "counted again" and why; registration before any store exists says `Complexity: counting has not started.`; status with no file says `Complexity: no file counted yet.` and with a parse error adds `; N functions in parse errors not judged`.
7. **"Since this session started"** counts the functions failing now whose last transition went to `fail` after the registration: the shell's session (`CLAUDE_CODE_SESSION_ID`, `CODEX_SESSION_ID`, `OPENCODE_SESSION_ID`, as `status --wait`), else the oldest registered consumer's, and the line says which (`since the oldest registered session started`). A function failing since a first count has no transition, so it never counts, and never blocks Stop.
8. **`squeal code --changed`** keeps functions whose last transition is after that registration, recoveries included; a removed function is not listed, since its state is gone.
9. **`squeal code` exit codes**: 0 with an answer, 1 with complexity off, no code store or the store unavailable, 2 on a usage error; `--json` then prints `{ v: 1, available: false, message }`.
10. **A busy code store** costs that delivery, status read or Stop check its code part, never an error or a stall: the hooks open it with their own busy timeout, `withCode` reads a busy error as `null`, and the delivery reads first and takes the write lock only when it has a view or told mark to write.
11. **Status `code` JSON** adds `since` (`session`, `oldest` or `null`) and `files` beside D6's fields, so the text can say which registration and how far the count is.

## For 015-08 (the first edit to a standing failure)

The view already holds `told: "count"` for every function failing at registration and `full` for each one told in its own line. The hook reads only the store, so the pass's list of functions whose body hash changed (015-06 returns it and stores nothing) must reach the store for `tellCode` to see it: a per-revision code `meta` record, or the body hash on the state row. `tellCode`'s plan is the place to add the rule: for a `fail` state with a `count` view entry whose body changed after the view's `toldAt`, tell it in full once and write `full`.

## Not done here

- `plugins/*/dist` are not rebuilt (not this row's); the four bundle-drift tests fail until the candidate's build.
- Pi and OpenCode get the code part only where they go through `openContext`; their own tests were not extended.
