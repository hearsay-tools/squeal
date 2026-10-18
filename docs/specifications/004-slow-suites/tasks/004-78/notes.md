# 004-78 notes (worker, 2026-10-18)

Brief: `tasks/wave-11.md`, "## 004-78". Evidence: `research/atomic-flags-0215.md` 1, 2 and 4.

## The named wait

- **What is left out.** `pauseOnlyIds` (`src/cli/named-files.ts`) picks out the selected slow files that are pending, not running, and have nothing holding them but the slow tier's turn. That is the same test as `queuedReason`'s `slow`: no other worktree's claim, and no open run in the file's lane. A slow file that is running, or queued behind a slow tier that is running, is still held. A slow file with a current or stale result counts in the verdict as before.
- **When it is decided.** At each ready read (the selection decided, the daemon alive), for the selected files not yet left out. A file once left out stays out for the rest of the wait. So a slow tier that starts mid-wait (another shell's `run --slow`) does not make the wait hold again.
- **Outcomes.** `settled` and `timeout` judge only the held files: `verdict` leaves out `leftForPause`, and so does the exit code (`namedCode`). The new outcome `slow` covers a wait that selects nothing but pause-only files. It returns at the first ready read, exit 3, with the line `Named test files have no verdict: every selected test file is slow: ...`.
- **Text.** After the verdict line, `; N slow test file(s) wait(s) for a pause or \`squeal run --slow\`, which this wait does not hold for: <paths>`. The ending follows `stop.requireSlowSuite`, read off `slowTier.stopWaitMs` as 004-71's quiet line reads it. Off: `this repository does not require it before you finish`. On: `this repository requires it before you finish: \`squeal run --slow --wait 60000\` runs and waits for it`. No build command is named (004-71's rule). The class lines (`Pending (1): ...: slow, run when the agent pauses or on ...`) are unchanged.
- **JSON.** `wait.leftForPause` holds `{project, path}` refs. On `NamedWait` the field is optional (`leftForPause?`) so that literals in `test/evals/evidence-squeal.test.ts` still build without it; that file belongs to 006, which I left alone. It is always present on the payload.
- **Skill.** `references/commands.md` now has the sentence the coordinator accepted, in the claude-code, codex and pi copies; OpenCode ships no skill copy. Pinned in `test/harness/skill-wait.test.ts`.

## The primer fold

At the eval cell's 217-character CLI, dropping the path wait was not enough. The text that names the CLI at the wait (`first` naming, plain sentence) is 1,314 + n characters with one slow file under policy off (1,311 + n under policy on), so 1,531 at 217, over the 1,500 cap. I added a `short` wait sentence, which the coordinator accepted: `Wait only when you need a result, as before you finish: \`<CLI> status --wait 60000\`.`. The primer tries it at `first` naming once the projects are folded, before the CLI goes unnamed.

What each CLI length gets (Vitest, one slow file, no projects, policy off; under policy on each boundary is 3 characters higher):

| CLI length | Primer |
| --- | --- |
| up to 186 | the CLI named at the wait in the plain sentence (unchanged) |
| 187 to 230 | the CLI named at the wait in the short sentence (new) |
| over 230 | no CLI path; `on the CLI SQUEAL messages name` with the path wait (unchanged, as before 004-78) |

With node:test or pytest projects, or excluded Vitest projects, every boundary falls lower by the length of the extra coverage text. Pinned at 217 (the cell's command) and at 230 and 240 in `test/harness/primer-wait.test.ts`.

## Not done here

- `plugins/*/dist` is not rebuilt (the brief says no `npm run build`). The four bundle-drift tests fail until the coordinator rebuilds.
- `KEY_FORMAT_VERSION` did not need a re-pin: `test/keys` passes and no guarded source changed.
- No eval run. Whether Luna's a2, a3 and a8 flags and Sonnet's a11 flags clear is for the four-scenario re-run on the candidate (research 4).
