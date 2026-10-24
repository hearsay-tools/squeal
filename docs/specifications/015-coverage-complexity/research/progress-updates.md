# 015-26: progress updates on a failing function

Researcher for row 015-26, 2026-10-24. Brief: `progress-updates-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, spec D2, D5, D6 with the 2026-10-24 amendments, `../status.md`, `../lessons.md` "Round 1, live sessions (015-10)", 011 C5 and C6, and the source at `55afb856a` (0.1.292): `src/core/delivery/code-deliver.ts`, `code-delta.ts`, `code-format.ts`, `src/cli/code.ts`, `src/core/code/store/types.ts`. Session evidence: the 015-10 part C streams and base files that worker 4ddd4e37 left under `/tmp/dogfood-015-10/w-4ddd4e37/` (read only). The sessions ran 0.1.284, before 015-19 to 015-27. Probes: `probes/progress-updates/` (throwaway). No agent session, no daemon and no test run. Peer pages were fetched with curl on 2026-10-24.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Need | 7 of 12 sessions worked on a function over 20. 4 of them ran `squeal code` (11 calls), and each of those 4 prompts named `squeal code`. Only 2 calls read a count while an attempt was still over (sq5 at 22, cz5r at 23). Both came in the same Bash call as the agent's test run. sq3 tried ESLint once, and ESLint did not run. Under 0.1.292, a subscription would add 2 lines over the 12 sessions, one each in sq5 and cz5r. sq3's case is now told by 015-21. | verified by experiment (stream tally, edit replay) |
| 2 | Key | The check identity `(path, qualified name, occurrence)`, held as the consumer's view entry. The command takes the `path:line` the line already prints and resolves it once. A same-body move or rename keeps the entry. A move and edit in one revision, or a split under new names, ends it with `RESOLVED`. Extracting helpers keeps the name, so the entry stays. | read in source code; inferred |
| 3 | Delivery | At the tool boundary, in `codeStep`, as `STILL FAIL` is today. One line per delivery per function, sent when the function's last own edit moved its body. The line gives the count now and the count at the last line, which needs one stored value. It ends at `PASS`, `RESOLVED`, SessionEnd, a recount re-seed or an explicit stop, and needs a bound. | read in source code; inferred |
| 4 | Noise and cost | 1 extra line per subscribed attempt in the sessions. In general, k − 2 lines when the k-th body edit passes on a standing failure. No daemon CPU. The hook writes one view row per line. An unsubscribed agent pays about 77 characters on each `STILL FAIL` line for the hint (8 lines in the 12 sessions). | verified by experiment (counts); cost inferred |
| 5 | Peers | SonarQube for IDE, the CodeScene extension and ESLint in an editor show the current count after each change. That feedback is on by default for every function. None of them subscribes to one function. CodeScene compares with the merge base, not with the last edit. Wallaby has no complexity; its opt-in is by file (Smart Start), and its agent skill pulls after each fix. | read in official docs, read in source code |

## Findings

### 1. Need: what the 015-10 sessions did

`tally.py` lists, per session, each `squeal code` call and each delivered complexity line (`probes/progress-updates/tally-out.txt`). Seven sessions edited a function that was over 20: sq1, sq2, sq3, sq5, cz1, cz2 and cz5r. sq4 (a rename), sq6 (a pull), cz3, cz4r and cz6 did not.

| Session | `squeal code` calls | A call at a count still over, mid-attempt | What a subscription adds under 0.1.292 |
|---|---|---|---|
| sq1 | 0 | — | 0: `STILL FAIL` 21, then the next edit is `PASS` |
| sq2 | 3: before the edit; with the edit, stale (P4); `sleep 5`, then again | 0 | 0: one edit, `PASS` |
| sq3 | 0. One `npx eslint`, which failed with no config: "so I couldn't check the complexity rule" | 0 | 0: 015-21 now tells `STILL FAIL … is 22` |
| sq5 | 3: before; mid-attempt; after `PASS` | 1, at 31.0 s: `vitest …; squeal code src/cli/remove.ts \| grep`, 159 characters back | 1: `removeCommand` 22, was 25 |
| cz1 | 0 | — | 0: no later edit |
| cz2 | 2: before; with the edit, stale (P4) | 0 | 0: one edit, `PASS` |
| cz5r | 3: before; mid-attempt; after `PASS` | 1, at 20.7 s: `npm test …; squeal code … \| grep`, 437 characters back | 1: `discoverInstallation` 23, was 29 |

`replay-edits.mts` applies sq5's and cz5r's Edit calls to the base files and counts each step with this worktree's counter (`replay-out.txt`). The counts are 28, 25, 22, 19 and 31, 29, 23, 20, the same as the session lines and `lessons.md`. Each round was two Edit calls. In each round only one of them moved the function's body: the other added the helper. That is 3 of 6 Edit calls per session. verified by experiment.

So the observed need is small and prompted. The only mid-attempt pulls came from the two sessions told to "refactor in small steps", whose prompts named `squeal code`. Each pull cost no extra tool call, because it rode on the test command. No session ran `squeal code --changed`. The sq3 gap that started the idea (`lessons.md` P3) is now covered by 015-21. A subscription matters only from an agent's third edit that leaves the function over. inferred from the table.

Under 0.1.292 that third edit is quiet. In `code-delta.ts`, `editToTell` returns `null` when the entry is `told: "still"`, and the view becomes `still` after the first `STILL FAIL` or after 015-21's second one. read in source code.

### 2. Key

- **What the store already keys.** A code check is `CodeCheckId { path, qualifiedName, occurrence }` (`src/core/types/code.ts`). Each consumer's view row is keyed by it and the measure (`codeKey`). A subscription held as a view entry state is keyed the same way and needs no new id. read in source code.
- **What the agent can type.** The line prints `name (path:line)`. 2 of the 4 distinct names in sq6 hold `<…>` (`waitForNamed.<withStatusStore>`, `recordFocusedTier.<map>`), and 38% of functions here are anonymous (D2). Such a name breaks an unquoted shell command, because `<` is a redirect. The printed `path:line` is copyable as is. The line can move with later edits (cz5r: 25 to 43 after a helper went above), so the command should resolve `path:line` to the identity once, at the call, from the current count (`lineOf` does the reverse). An id printed only for this would be a third name for the same check. inferred.
- **Rename and move.** `CodeStateRepo.move` gives the new check "every consumer view's entries" in one transaction (store types, D2). A subscription stored in the view follows a same-body move or rename with no extra code. read in source code.
- **Move and edit in one revision.** D2 reads this as a removal plus a new check. The view entry is `fail`, so the removal is told `RESOLVED … no longer in the code`, and the entry goes. The subscription ends there. Following it into the new check would need an identity D2 does not have. read in source code (`planCodeDelta`, the loop over remaining view entries).
- **Split.** All five refactors in 015-10 kept the function's name and extracted helpers (sq1, sq2, sq5, cz2, cz5r: each `PASS` names the original function). The subscription stays on the original. A split into two new names ends it with `RESOLVED`. A new part over 20 gets its own `FAIL` as a first-seen fail, which is delivered to every session anyway. verified by experiment (session lines); split into new names inferred.
- **Occurrence.** A new function with the same qualified name above it shifts `occurrence`. The pass then reads a move by body hash, if the body is the same. That is rare (1.1% share a name). inferred.

### 3. Delivery

- **Where.** At the tool boundary, in `codeStep` (`code-deliver.ts`), as `STILL FAIL` is today. It reads `store.states.edits` (the last edit per state) and the consumer's view on every delivery already. A subscribed entry state, for example a fourth value of `CodeTold` beside `count`, `full` and `still`, would let `editToTell` tell again. The condition stays the same: an own revision (`isOwn`) after the entry's `toldAt`. Not at Stop: D7 keeps code out of Stop. read in source code; the entry state is inferred.
- **When one fires.** When the function's last edit moved its body, with its identity kept, in a revision that is the session's own. 015-19 already marks no edit for a pull, merge, rebase or checkout, so a pulled change sends nothing. Several revisions between two tool boundaries give one line, because `edits` keeps only the last edit. An edit that moves the body but keeps the count still fires. The "count did not move" filter was rejected in 015-10, because it would have cut sq1's useful line (`lessons.md`, open question 2). read in source code; the filter verdict is from `lessons.md`.
- **What one says.** One line in the existing block, for example `STILL FAIL complexity: removeCommand (src/cli/remove.ts:44) is 22 after the edit, was 25, over 20 (ESLint rule)` (111 characters). "Was" needs the value at the last line. `CodeViewEntry` holds no value on purpose: the fingerprint is rule and threshold (D5). `CodeEdit` holds only revision and time, and a transition is recorded only on a change of state. So the subscription needs one stored number per entry, or the line drops "was". read in source code.
- **How it ends.**
  - **At or under the threshold.** `PASS`, and a passing function leaves the view ("Told or not, a passing function leaves the view", `code-delta.ts`), so the subscription ends with no extra rule.
  - **Removed.** `RESOLVED`, and the entry goes.
  - **Session end.** `dropCode` at SessionEnd and in the consumer sweep (015-20).
  - **A recount** (threshold, include or counter change). `seed` calls `views.clear`, so subscriptions are lost. A spec would need to keep them or say so.
  - **An explicit stop.** It needs a command.
  - **A bound.** It needs a number. Nothing in 015-10 shows one; no attempt went past 3 rounds.

  read in source code; the bound is inferred.
- **One side effect.** `squeal code` reads the stores only (D4, D6: "needs no daemon, like status"). A subscribe command writes the consumer's view, so `squeal code` would get its first write. It finds the consumer as `--told` does (`waitConsumer`: `CLAUDE_CODE_SESSION_ID`, `CODEX_SESSION_ID`, `OPENCODE_SESSION_ID`). In a shell with no session it has nothing to subscribe. read in source code.

### 4. Noise and cost

- **Updates per attempt.** On a function that was already over, an attempt that passes at its k-th body edit gets k − 2 extra lines from a subscription: the first edit already gets `STILL FAIL`, and the k-th gets `PASS`. After a `FAIL` the edit made it, 015-21 tells the next edit too, so it is k − 3. An attempt that never passes gets one more, up to the bound. In sq5 and cz5r, k = 3 on a standing failure, so 1 line each. Over the 12 sessions that is 2 lines, about 220 characters, against 2 pulls of 159 and 437 characters that cost no extra tool call. verified by experiment (k from the replay); formula inferred.
- **Cost per delivery.** No daemon CPU: the count and the edit mark are made by the pass already (`markEdited`). In the hook the delivery reads the same rows. A line adds one view row write, so that delivery takes the write transaction instead of the read-only path. 015-20 measured a PostToolBatch with one code transition on 20,000 functions at about 45 ms (`../status.md`, amendment of 2026-10-24). A subscribed line should cost the same order. Not measured here. inferred.
- **What an unsubscribed agent sees.** Only the longer `STILL FAIL` line. Today's 015-21 line is 208 characters. An advertising clause such as ` To hear each edit's count instead: squeal code --follow src/cli/retry.ts:69.` adds 77, to 285. The 12 sessions would have carried 8 such lines: 7 `STILL FAIL` after P1's fix, plus sq3's 015-21 line. The 3 noise lines of sq4 (a rename) would carry the hint too. verified by experiment (character counts); the line count is from `lessons.md`.
- **Fit with the vision.** "Neither is a failure that is still failing" (principle 1) and "push transitions, pull state" (decision filter 6). A subscription pushes state, but only on the agent's own request. That is the sole argument for it under the filter. inferred.

### 5. Peers

| Peer | What it shows per edit on one function | Opt-in? | Source |
|---|---|---|---|
| SonarQube for IDE (VS Code docs, updated 2026-10-07) | Re-analysis "when you open a file, as you type, or with each file save"; the issue text carries the count: "Refactor this function to reduce its Cognitive Complexity from {{complexityAmount}} to the {{threshold}} allowed." (S3776, default 15) | No. Automatic analysis is on by default and toggled for the whole workspace, never per function | read in official docs; read in source code (SonarJS `729dc4fc`, `S3776/rule.ts`, `config.ts`) |
| CodeScene for VS Code (README, `39d52b9b`) | "analyses and scores your code as you type". The Code Health Monitor shows each file's "previous and current Code Health score, along with a clear delta value … at the file or function level". The baseline is the merge base (`baseline_branch`) | No. Code lenses are on by default (`Enable Review Code Lenses`: true). The Monitor tracks every changed file | read in official docs |
| ESLint `complexity` in an editor (main `67d2ca2d`) | "{{name}} has a complexity of {{complexity}}. Maximum allowed is {{max}}." re-reported on each lint | No: the project's rule config, for every function | read in source code |
| Wallaby (docs, v3) | No complexity. Coverage "is updated in real-time. As soon as you start changing your code". Smart Start runs only "the files that you're currently working on" | Smart Start is an opt-in by file. The agent skill pulls: "Fix … Call wallaby_failingTests → Confirm no failures remain" | read in official docs |

No peer named here lets a user subscribe to one function. Where the count is live, it is live for every function over the limit, in a passive place (a squiggle, a lens, a panel) that costs the reader nothing until they look. An agent's context has no such place: each line is read. CodeScene's "previous" is the merge base, not the last edit, so its delta is the total change, not the step. inferred from the table.

## Recommendation for Squeal

1. **Do not make it a row now.** The need seen is two pulls in 12 sessions (finding 1). Both were prompted by a task that named `squeal code`, and both rode free on a test command. 015-21 already covers the sq3 case that raised the idea. Pulling costs one shell pipe. Advertising a subscription costs 77 characters on every `STILL FAIL` line, including the noise ones (finding 4). This is a lean on small evidence. Part B of 015-10, the passive day, would show whether unprompted agents run a third body edit on a function they were told about. Count those third edits there before deciding.
2. **If the human wants it, keep it inside the view** (findings 2 and 3). It is a fourth `CodeTold` state on the consumer's existing entry, keyed by the check identity, set by a command that takes the printed `path:line`. It fires in `codeStep` on the same own-edit condition as `STILL FAIL`, one line per delivery, with a stored "was" value. It ends at `PASS`, `RESOLVED`, SessionEnd or an explicit stop, plus a bound. Moves and renames come free. State what a recount does to it. Accept that `squeal code` then writes.
3. **A cheaper middle option, from the same evidence.** Leave the delivery as is, and make the 015-21 hint name the pull the sessions already used: `squeal code src/cli/retry.ts` (it is there today) after the test run. This adds no state, no write and no characters. It is what sq5 and cz5r did unprompted once they knew the command.

## Open questions

1. In unprompted work (015-10 Part B), how often does an agent make a third body edit to a function it was told is over, while it stays over? That is the only case a subscription adds a line for.
2. Should a subscription survive a threshold change? `seed` clears the view today.
3. What bound: a number of lines, or the end of the attempt (the next `PASS`)? No session reached one.
4. Does a "was" value break D5's rule that the value is no part of what the consumer was told? It is stored for the line only, never compared, but a spec must say so.

## Sources

- Squeal at `55afb856a` (0.1.292): `src/core/delivery/code-deliver.ts` (`codeStep`, `seed`, `dropCode`, `tellCode`), `src/core/delivery/code-delta.ts` (`editToTell`, `stateStep`, `planCodeDelta`, `isOwn`), `src/core/delivery/code-format.ts` (`quietHint`, `codeEntryLine`), `src/cli/code.ts`, `src/cli/status-wait.ts` (`waitConsumer`), `src/core/code/store/types.ts` (`CodeEdit`, `CodeStateRepo.move`), `src/core/types/code.ts` (`CodeCheckId`, `CodeTold`, `CodeViewEntry`).
- Spec 015 `spec.md` D2, D5, D6, D7; `../status.md`; `../lessons.md` "Round 1, live sessions (015-10)"; `../tasks/015-10/part-c/prompts/*.txt`; 011 `spec.md` C5; `docs/vision.md`.
- Session evidence: `/tmp/dogfood-015-10/w-4ddd4e37/logs/sessions/*/stream.jsonl` and `files/base-{squeal,cezar}/` (015-10 part C, Squeal 0.1.284, Claude Code 2.1.300, Sonnet). The originals under `/home/squeal-e2e/runs/d1510/` were not readable from this user.
- Probes: `probes/progress-updates/replay-edits.mts`, `tally.py`, outputs `replay-out.txt`, `tally-out.txt`.
- SonarQube for IDE, VS Code, "Running an analysis" (updated 2026-10-07): https://docs.sonarsource.com/sonarqube-for-vs-code/getting-started/running-an-analysis
- SonarJS at `729dc4fcea3b` (2026-10-23): https://github.com/SonarSource/SonarJS/blob/729dc4fcea3b1e3ec8fa13c55a89fbf494d819b9/packages/analysis/src/jsts/rules/S3776/rule.ts and `S3776/config.ts`, `S1541/rule.ts`
- CodeScene for VS Code README at `39d52b9b` (2026-10-24): https://github.com/codescene-oss/codescene-vscode/blob/main/README.md
- ESLint `lib/rules/complexity.js` at `67d2ca2d` (2026-10-23): https://github.com/eslint/eslint/blob/main/lib/rules/complexity.js
- Wallaby docs (v3): https://wallabyjs.com/docs/ , https://wallabyjs.com/docs/features/coverage/ , https://wallabyjs.com/docs/features/ai/
