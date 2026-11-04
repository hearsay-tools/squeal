# 019-41 notes: the control's remaining race is the host load

Worker b38bdd04, 2026-11-04. Row 019-41, brief `../wave-8.md`, "Before the 0.1.401 release". Shape: repair.

## The failing assertion

Main CI 41773837324 at `529d3b01b`, Node 22 (1/3), claude-code. The failing line is `run-triggers-control.test.ts:144`, `expect(now.texts).toEqual(before.texts.map(accepted))`. It is not the `delivered` comparison (line 143), which passed. `texts` holds five entries: SessionStart (`null` for Claude Code), the prompt, the two Stop texts and `squeal status`.

The diff is in `squeal status`, in each of the two known failures' facts:

```text
- … load <n> per CPU when it ran; no retry asked at these inputs
+ … load <n> per CPU when it ran; no retry asked at these inputs; if the changed files are not the cause, `squeal retry test/e2e/flow.test.ts --reason load` runs it once more when the one-minute load average is below the CPU count
```

`-` is 0.1.393's session, `+` is this version's. Everything else in the five texts was equal.

## The race

A known failure's facts name a `load` retry when the run that recorded the failure ran at a load of one per CPU or more (`recordedText` and `loadRetryText` in `src/core/retry/text.ts`, row 011-67). The rule and the text are the same at 0.1.393 (`24a8a63b6`) and now: `git show 24a8a63b6:src/core/retry/text.ts` has the same `loadRetryText`.

The control runs the 0.1.393 session first and this version's session after it, minutes apart, on the same runner. The runner also runs the shard's other test files. So the edit's failing runs of one session can start at a load below one per CPU and the other session's at a load above it. Then one text names the retry and its twin does not.

The control's `named` already named the number alike (`load <n> per CPU`). It did not name the retry, whose presence follows the number. So the race is the host load at each failing run, not the order of deliveries or the boundary that carried them.

Locally the load is below one per CPU (the 24-CPU host reads 14 to 17), so local runs never name the retry. That is why the control passed locally and in the later CI runs.

## The fix

`loadNamed` in `run-triggers-control.test.ts` names each load reading alike in one pass:

- A known failure's reading with no retry asked (`load X per CPU when it ran; no retry asked at these inputs`) and the load retry after it read as `load <n> per CPU when it ran; no retry asked at these inputs`, when the retry agrees with the reading: a retry with a reading of 1.00 or more, no retry with a reading of 1.00 or less. The printed reading is rounded to two places, so 1.00 agrees either way.
- A reading whose retry does not agree keeps its number and its retry as printed. Its twin is named, so the comparison fails and shows both.
- The retry is matched exactly: its sentence, `--reason load`, and one of the fixture's four test files. A changed retry does not match, keeps its number, and fails the comparison.
- Any other reading (`load X per CPU`) reads `load <n> per CPU`, as before.

Two checks in the same file prove it, with no fixture: the CI pair (1.37 with its retry, 0.42 without) and the 1.00 cases read alike. A missing retry at 1.37, an extra retry at 0.42, a retry for another file, a retry for another reason and a changed sentence do not.

The comparison of `delivered`, the positional `texts`, the Stop decisions and the files each step ran are unchanged. The 0.1.399-r2 mutations (FAIL to PASS, a lint count, an expected value, a test path, missing, duplicate, reordered or extra output) still change a string outside the load reading.

## What the 10 runs prove

The host's load stays below one per CPU, so the real sessions take the idle path in both versions. The 10 runs show the change breaks no comparison and no other race shows at this load. The busy path is proven by the two checks above, with CI's text. Making the host busy on purpose to reach it is not allowed (no artificial load).

## Runs

`pnpm exec vitest run test/e2e/run-triggers-control.test.ts`, 10 times in a row at `5da1ce7a1`, both plugins each time: 10 of 10 exit 0, `Tests 4 passed (4)`, about 29 s each. The host's one-minute load average was 8.9 to 14.4 on 24 CPUs (0.37 to 0.60 per CPU), read before and after each run. This is the host's own load from other sessions; nothing added load.
