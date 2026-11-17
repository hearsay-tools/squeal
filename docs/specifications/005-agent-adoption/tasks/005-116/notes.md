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
