# 005-116: the dead-daemon hook text drops the run ids and the revision

Wave 26 W1. The human, 2026-11-17: "Drop run numbers, keep cause". In hooks the dead-daemon
text says: the last daemon died without shutting down, the test files it ran, the cause sentence
(`DEATH_CAUSE`), and `squeal start` where the hook already said it. `squeal status` and
`squeal why` keep the full text (`deathText`, unchanged).

## The change

`src/core/status/died.ts` adds `deathHookText(died)`: the open runs' test files, flattened in
run order and cut at `DIED_FILES_SHOWN` (5) as `deathText` cuts each run's, with `and N more`.
`header.ts` `diedText` (every header branch that names a death) and `format.ts`
`notValidatedLine` use it. `status-detail.ts` and `outstanding-text.ts` (status) keep
`deathText`.

## Sentences before and after

| Where | Before | After |
|---|---|---|
| Hook header, a death during a run (`diedText`) | `The last daemon died without shutting down, during run r1 (revision 3) of test/0.test.ts. A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.` | `The last daemon died without shutting down while running test/0.test.ts. A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.` |
| Hook header, two runs open | `…, during run r1 (revision 3) of a, b; run r2 (revision 3) of [slow] c.` | `… while running a, b, [slow] c.` |
| Hook header, between runs | `The last daemon died without shutting down, between runs. <cause>` | unchanged |
| Not-validated line (`notValidatedLine`) | `Not validated: no daemon has validated since <time>; the last daemon died without shutting down, during run r1 (revision 3) of test/0.test.ts; `squeal start` starts one; any change this call made has no result.` | `Not validated: …; the last daemon died without shutting down while running test/0.test.ts; `squeal start` starts one; any change this call made has no result.` |

## Decisions the brief left open

- `squeal start` is kept where the hook already said it (the not-validated line, the "no daemon
  is running" unlisted line). No new copy is added to the header's death sentence: a message
  with the not-validated line would then say it twice, and with a starting daemon (slow,
  stopped or just spawned) `squeal start` is wrong (row 005-108).
- The not-validated line gets no cause sentence: it did not carry one, and the header of the
  same message does.

## Copies checked

`test/e2e/**`, `evals/lib/**` and the skill copies hold no death sentence. Tests changed:
`test/status/died.test.ts` (new `deathHookText` case; the header case asserts no run id and no
revision), `test/daemon/died.test.ts` (the real SIGKILL: the next hook names the file and the
cause, never the run id; status's two assertions unchanged).

## Repair, review 0.1.554 B2 (the restart command)

The row's done-when needs `squeal start` in the dead-daemon hook text. The first commit kept it
only where a hook already said it, and the review found a case with none: test files listed,
the daemon died, no successor starting, and the first tool boundary registers the consumer
(`registerOwing`, `src/harness/shared/deliver.ts`). A registration has no Not validated line,
so nothing said the command.

Main before this row (18450706c) had the same gap: the new registration test fails there too
(`expected 0 to be 1`), since `diedText` then carried the run ids and the cause but no command.

Now:

- The header's plain down sentence (no daemon or successor running, `noneRunning`) ends the
  death with `` `squeal start` starts one.`` (`livenessSentence`). Every form uses it:
  registration, news, Stop's full form.
- While a start runs (just spawned, slow or stopped, row 005-108/005-111) the death sentence
  has no command. SessionStart registers before it starts the daemon and says "A daemon is
  starting", so it has none either.
- `headerRestarts(daemon)` (`header.ts`, exported) says whether a header names the death and
  the command. `deliver.ts` passes it to `notValidatedLine(…, { deathTold })`; with it, the
  line leaves out its death clause and command. The command is never twice in one message.
- `notValidatedLine` without a header (no news) keeps the death and the command, and drops the
  command while `startingSince` is set.

| Message | Before | After |
|---|---|---|
| Registration at a tool boundary, listed, dead, nothing starting | `Revision 1 (changed src/math.ts): No daemon has validated since <time>; results are as of revision 1. The last daemon died without shutting down, between runs. <cause>` | the same, then `` `squeal start` starts one.`` |
| Edit's report with a news header and the Not validated line | header: `… The last daemon died …, between runs. <cause>`; line: ``Not validated: no daemon has validated since <time>; the last daemon died without shutting down, between runs; `squeal start` starts one; any change this call made has no result.`` | header: ``… The last daemon died …, between runs. <cause> `squeal start` starts one.``; line: `Not validated: no daemon has validated since <time>; any change this call made has no result.` |
| Not validated line with no header (no news) | `…; the last daemon died …; `squeal start` starts one; …` | unchanged |
| SessionStart (a start follows) | `A daemon is starting; results are as of revision 1. The last daemon died …. <cause>` | unchanged, no command |

`src/harness/shared/deliver.ts` is outside this row's listed files; the change is the
`deathTold` argument, three lines. W2 does not own it.

Tests: `test/harness/not-validated.test.ts` "a death's restart command, once per message":
the registration (fails on b45d6d0a7 and on 18450706c), SessionStart (no command), an edit's
report with the line (command once), and Stop after it (at most once). `test/status/died.test.ts`:
the header with and without a start running, `notValidatedLine` in its three modes, and S1.

## S1

`headerParts`' `told` now picks `editsLate`; the first commit's note claimed it, the edit had
not applied. `test/status/died.test.ts` calls `headerParts` with `{ editsLate }`.
