# 023 Results at a commit: dogfooding lessons

## Round 1 (023-10)

Row 023-10, wave 12, worker 2d31de9d, 2026-11-18 16:57Z to 17:32Z. Squeal 0.1.563 as released (hub entry `c50cc3c`, tag `squeal--v0.1.563`), in Claude Code 2.1.300, model `claude-sonnet-5-5`, as the throwaway OS user `squeal-e2e`. The brief is `tasks/wave-12.md`. The scripts are in `tasks/023-10/bin/`, the setup and the raw data in `tasks/023-10/notes.md`.

The question: when an agent needs a before/after comparison or a red proof, does it use `squeal status --at` or `squeal proof`, read the answer right, and leave its own tree alone?

Two sets of sessions ran on the same tasks:

- **Round 1, the briefed six (s1 to s6).** A short task in a user's words that does not name Squeal or its commands.
- **Round 2 (r1 to r5), approved by the coordinator after round 1.** The same five non-control tasks on fresh clones, with one sentence added to each prompt: "Squeal is installed here; `squeal --help` lists its commands." No command name. Round 1 had given no evidence on how agents read the answers, because no agent used the commands.

### Verdict

- **Discovery fails.** With no hint, 0 of 5 agents used `status --at` or `proof`. Nothing they read names the commands: not the primer, not the hooks, not the skill. Only `squeal --help` lists them, and no round-1 agent ran it. The shipped skill teaches the opposite: its "Red/green" section tells the agent to revert the fix in its own tree and restore it (s4 did exactly that, quoted below).
- **With the hint, 4 of 5 used them.** r4 and r5 used `squeal proof` right, read the verdict and the failure text right, and changed no file. r1 used both commands and changed no file, but it reported one file as passing at HEAD when the report said its green side was "not read". r2's `status --at HEAD~1 --run` in Squeal's repository selected 1,338 test files, ran past its 600 s budget (667.6 s), was killed, kept 0 results and the session hit its 20-minute limit with no answer. r3 followed squawk's own documented recipe (a disposable worktree) instead.
- **Own tree.** No session that used a Squeal command wrote to its tree. Of the six sessions that did the work by hand, two swapped a tracked file in their own tree and restored it (s1, s4), one wrote an old copy of the test into the tree and deleted it (s5), and three used a disposable `git worktree` with hand runs (s2, s3, r3). Every tree ended clean; s1 and s4 each made the daemon queue about a hundred test files twice.
- **Answers.** Round 1: right in 4 of 5. s1 answered a different question (a red proof of the new test) and said "one test file differs" for a file that does not exist at the parent. Round 2: right in 3 of 5 (r3, r4, r5), with an over-claim in r1 and in r5; r2 gave none.
- **Control.** s6 fixed the failing test with `squeal status --wait` and used neither command. Right.

### Setup

| Item | Value |
|---|---|
| Isolation | OS user `squeal-e2e`, case root `/home/squeal-e2e/runs/w12` (`HOME`, `TMPDIR`, `CLAUDE_CONFIG_DIR`, `XDG_RUNTIME_DIR`, the pnpm store under it), cwd `/`, `env -i`. Credentials by name only: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` through `sudo --preserve-env`. |
| Squeal | The release's own `install.sh` (`git show squeal--v0.1.563:install.sh`) with `SQUEAL_MARKETPLACE` pointing at a clone of the hub at `c50cc3c`, since the hub is private. `claude plugin install squeal@hearsay` then fetched the plugin from public github.com at the hub's pinned tag and sha. The launcher went to `~/.local/bin/squeal`; `squeal --version` printed 0.1.563. No `codex` on the `PATH`. |
| Harness | `timeout 1200 claude -p --model sonnet --output-format stream-json --verbose --include-hook-events --permission-mode bypassPermissions <prompt>`, Node 24.21.0. |
| Repositories | squawk: a bundle of the read-only checkout at `0dfe0724c`, one clone per session at the session's commit (branch `main`). Squeal: `git fetch --depth 50` of `20f03a431` from github.com. Each clone had its own `pnpm install --frozen-lockfile` and so its own store; no clone shared results with another. |
| Fixtures | s5, r5: `feb856667`'s defect as two commits on `0dfe0724c`, built as `test/e2e/at-commit-proof.test.ts` builds it (`bin/fixture-s5.mjs`). s6: an uncommitted bug in `packages/contract/src/report-title.ts` (`/\..*$/` for `/(.+)\.[^.]+$/`, `bin/fixture-s6.mjs`). |
| Daemon | Started by each session's hooks, lookup-only (squawk's and Squeal's configuration): no stored result at the start of any session. |
| Load | 1-minute load 6.0 to 11.9 at each session's start; it reached 58 at 17:17Z while r2's `--run` and other sessions on the host ran. |
| Cleanup | After each session `squeal stop`; at the end no process of `squeal-e2e`, no checkout under `~/.cache/squeal/checkouts`, no extra registered worktree in any clone. All clones, the squawk bare clone, the hub clone and the pnpm store removed after the last session (17:33Z). The transcripts stay under `/home/squeal-e2e/runs/w12/claude/projects/`. |

### Round 1: no hint

Times are seconds from the session's first stream line. Tokens: cache writes / cache reads / output.

| Session | Task (commit) | Expected | Command used | Answer | Writes to its own tree | Wall, tokens, cost |
|---|---|---|---|---|---|---|
| s1 | Before/after, squawk `8be977ad6` | `status --at HEAD~1`: no test file changed result; `active-run-write-index.test.ts` is new (absent at the parent) and passes | `git checkout 8be977ad6~1 -- active-run-write.ts`, `squeal run tests … --wait`, restore | Wrong framing: "Yes, one test file differs", a table of the new test over the old code (a red proof). It does say the file is new | Swap of `active-run-write.ts` and restore (revisions 1 and 2; the daemon queued 111 test files) | 97 s; 38k / 244k / 2.0k; $0.14 |
| s2 | Before/after, Squeal `20f03a431` | The same: no change; one new test in `test/store/open.test.ts` passes | `git worktree add /tmp/prev HEAD~1`, `node_modules` symlinked in, plain Vitest on both sides, a Python diff of the JSON reports | Right | None (a worktree outside, removed) | 34 s; 11k / 174k / 1.5k; $0.06 |
| s3 | Red proof, source fix, squawk `6414b6c20` | `squeal proof .github/scripts/queue-ci-proof.test.cjs --base HEAD~1`: proven | squawk's `docs/sdlc/regression-proof.md` recipe: a disposable worktree at `HEAD~1`, the new tests copied in, `node --test`, then the fixed sources copied in | Right (4 assertion failures red, 84 of 84 green) | None | 21 s; 20k / 170k / 2.1k; $0.09 |
| s4 | Red proof, test-only fix, squawk `e71888f91` | `squeal proof <test> --base HEAD~1 --case test`: proven | Loaded the `squeal` skill, read `references/commands.md` "Red/green", then `git show e71888f9^:<test> > <test>`, `squeal status --wait`, `git checkout -- <test>`, wait | Right (expected `[101 … 105]`, got `[]`; FAIL -> PASS) | Swap of the test file and restore (revisions 1 and 2; 94 test files queued). The first wait took 93 s | 118 s; 19k / 203k / 1.5k; $0.08 |
| s5 | Red proof, hidden dependency, fixture of `feb856667` | `squeal proof <test> --base HEAD~1 --case dependency --env GITHUB_RUN_ATTEMPT=2`: proven | `git show HEAD^:<test> > scripts/zz-old-identity.mjs`, `node --test` with `GITHUB_RUN_ATTEMPT=1` and `=2` on both versions | Right, with the control (old passes at 1, fails at 2; new passes at both) | A new file holding the old test, deleted after | 32 s; 17k / 159k / 1.9k; $0.08 |
| s6 | Control: fix `report-title.test.ts` | Neither command | `squeal status --wait 60000 <test>`, an edit, the same wait | Right (FAIL -> PASS) | The fix only | 67 s; 14k / 87k / 0.8k; $0.05 |

Misread or misleading Squeal text: none in round 1. s5 stated a false belief about Squeal: "I ran `node --test` by hand … because this was a reproduction that needs a specific environment variable. Squeal can't set one." `squeal proof --env` does.

### Round 2: "`squeal --help` lists its commands"

| Session | Commands, in order | Answer | Writes | Wall, tokens, cost |
|---|---|---|---|---|
| r1 (s1's task) | `squeal --help`; `status --at HEAD~1 --run --json` (86 s, then `tail -60`); `status --at HEAD~1 active-run-write.ts active-run-write-index.test.ts --run`; `status --wait 60000 active-run-write.ts`; `proof ast-rules-active-run.test.ts active-run-write-index.test.ts --base HEAD~1 --case source` | The same framing as s1 ("changed the result for one test file", a red proof). Over-claim: "`ast-rules-active-run.test.ts` passes both before and after", while the proof said `red: pass … green: not read` | None | 155 s; 18k / 196k / 1.4k; $0.08 |
| r2 (s2's task) | `squeal --help`; `status --at 20f03a4~1` (58 s); `status --at 20f03a4~1 --run` | None: the `--run` took the shell tool's whole 600 s, went to the background, the agent slept 540 s and the session's 1,200 s limit ended it | None | 1,200 s (killed); no usage reported |
| r3 (s3's task) | Loaded the skill, read `squeal --help` and squawk's recipe in one call, then the recipe (disposable worktree, `node --test`), then `squeal status --wait 60000 <test>` in its own tree as the recipe asks | Right (3 of 62 fail red, 62 pass green; it ran only `queue-ci-proof.test.cjs`) | None | 52 s; 45k / 193k / 2.1k; $0.15 |
| r4 (s4's task) | `squeal --help`; `squeal proof <test> --base e71888f9~1 --case test --timeout 600` (18 s, 2 runs) | Right, and read the "not stored (git's checkout rules changed packages/mobile/android/gradlew.bat)" line right: "Both runs were real, but their results weren't saved … This doesn't affect the verdict" | None | 27 s; 22k / 94k / 0.7k; $0.07 |
| r5 (s5's task) | `squeal --help` (three reads); `squeal proof <test> --base ce4ebfb7 --case test --env GITHUB_RUN_ATTEMPT=2 --timeout 300` (23 s) | Right on the proof: quotes `'1.2.3-dev.9.2'` vs `'1.2.3-dev.9'` and the nightly and PR variants, and "a side under a condition is never stored". Over-claim: "The fixed test still passed with every `GITHUB_*` variable removed" was never run, and no run showed the old test passing without the variable | None | 41 s; 21k / 167k / 1.8k; $0.09 |

r5 chose `--case test` with `--env` rather than `--case dependency`. Here the two run the same sides (only the test changed), so the verdict holds.

### The shipped text that teaches swapping files

The coordinator asked for the exact text and every place it ships. In 0.1.563 the only such text is the "Red/green" section of the skill's `references/commands.md`, lines 55 to 64, in four copies: `plugins/claude-code/skills/squeal/`, `plugins/codex/seed/skills/squeal/`, `plugins/codex-runtime/skills/squeal/` and `plugins/pi/skills/squeal/` (main still has it, at line 53 of the Claude Code copy). OpenCode ships no skill. Lines 57 to 62:

```text
To show that a test fails without your fix and passes with it, let Squeal run it rather than running it yourself. Results would arrive with your next tool call anyway; here each step needs its result before the next, so wait after each edit:
# 1. Revert the fix, then:
squeal status --wait 60000   # Returned on news: the test's PASS -> FAIL
# 2. Restore the fix, then:
squeal status --wait 60000   # Returned on news: FAIL -> PASS
```

Line 64 continues: "Each edit is its own revision, so the first wait reports the revert, not the fix …". Each copy's `SKILL.md` points the agent there for red proofs: "`references/commands.md`: … and red/green through the wait. Read it … before a red/green check" (line 25 of the Claude Code copy, line 27 of the others).

s4 read exactly this (`grep -n -i -B2 -A25 'red/green' …/references/commands.md`) and then overwrote its test file with the old version. The primer and the hook texts in these sessions teach no swap; they only say to run tests by hand when no daemon validates or a gate requires it, which s2, s3, s5 and r3 took as leave to run the test runner themselves. The skill names `squeal --help` once (`commands.md` line 3); no skill, primer or hook text names `status --at` or `proof`.

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| P1 | **The skill teaches a swap in the tree.** The "Red/green" section above sent s4 to overwrite its test file; s1 swapped a source file the same way. Both made the daemon queue 94 and 111 test files twice, and s4's first wait took 93 s. | Replace the section with `squeal proof <test file> --base <commit>`, its three cases in one line each, and a sentence that it changes no file in the worktree. Keep the revert-and-wait form only for an uncommitted fix, and say so. Same text in all four copies. |
| P2 | **Nothing names the commands.** 0 of 5 found them without the hint; with one sentence pointing at `squeal --help`, 4 of 5 used them. s5 believed "Squeal can't set" an environment variable. | One line in the primer and in `SKILL.md` step 5: "for results at another commit use `squeal status --at <commit>`; for a red proof use `squeal proof` (it can set variables and hide files); both leave your tree alone". |
| P3 | **`--run` lost every result at its budget.** r2: `status --at 20f03a4~1 --run` in Squeal's repository selected 1,338 test files (the diff changes `src/core/store/mark.ts`, which many closures hold) and ended past the budget: "--run: 0 of 1338 test files with no result at a5c9b7223 ran in its checkout, 0 stored at its keys (667.6 s of the 600 s budget)". Files read "not determined (run: the run's process ended on SIGKILL with no answer)"; the clone's store held 0 results afterwards, although test processes had run in the checkout for minutes. The agent kept only the last 30 lines, so whether an estimate was printed first is not known. D4.6 says files not started read `not run (budget)`; here the files that did run were lost too. The default budget, 600 s, is also Claude Code's longest Bash call: past it the harness moved the command to the background, and the agent slept and was cut off. | Keep and report each file completed before the budget ends; stop at the budget, not after it. Print D17.1's estimate before a `--run` whose selection is large, as `--all-missing` does, and say how to narrow it (paths). Make the default budget, keying included, end well inside a 600 s tool call. |
| P4 | **`status --at` takes no source path.** r1 named the changed source and its new test: the source read "not determined (no runner lists it at d8abcfe46) -> not determined (the daemon lists no such test file)"; `squeal status <path>` takes the same path and selects the test files that read it. r1 gave up on `--at` and used `proof`. | Accept a source path as `status <path>` does (it selects the test files whose closure holds it), or reject it with "not a test file; name test files, or pass no path". |
| P5 | **The "now" side reads "the daemon lists no such test file" while the daemon is starting.** r2's first `status --at` (58 s after start) gave that for every file; its `--run` report later gave "no result" for the same files. In r1 every `root:test:unit` node:test file read it at 86 s. | Say the daemon has not listed the test files yet, or fall back to the store lookup at the working tree's keys (D3's rule with no daemon). Whether r1's node:test files are a separate defect (a project name mismatch) is not diagnosed here. |
| P6 | **A cold store makes the report a wall.** With no stored results every file is unknown, and D3 lists unknown files one per line: r2's reports ended "0 pass -> fail, 0 fail -> pass, 0 unchanged, 1962 unknown" after a list the agent cut with `tail`, and r1's `--json` was so long that `tail -60` showed only unknown files; the agent called it "too broad". | Group unknown files by reason with a count and a few paths each, as `squeal status` does; keep the full list for `--json` or `--full`. |
| P7 | **"green: not read" read as a pass.** r1's proof printed `ast-rules-active-run.test.ts: not red / red: pass … / green: not read`; the agent wrote that the file "passes both before and after". | Say why and what it means: "green: not run, because red passed (nothing to prove)". |
| P8 | **A before/after question answered with a red proof.** s1 and r1 both read "did the commit change any test results" as "does the new test fail on the old code". With `--at`, the new test reads `absent -> …`, which r1 got but did not use. | When a selected test file is `absent` at the commit, add one line: "new in this range; `squeal proof <file> --base <commit>` shows whether it fails on the old code". |
| P9 | **A condition's proof does not show the condition matters.** r5's proof under `--env GITHUB_RUN_ATTEMPT=2` was proven, but nothing showed the old test passing without the variable, and r5 claimed more than it ran. s5, by hand, showed both. | For `dependency` (and any case with a condition), also run the red side once without the condition and report "red only under the condition" or "red without it too". The answer to "did it depend on the environment" is then one line. |

Not product defects, recorded for the coordinator:

- **A repository's own recipe wins over the hint.** squawk's `docs/sdlc/regression-proof.md` (linked from its `AGENTS.md`) describes the disposable-worktree recipe; s3 and r3 followed it, r3 after reading `squeal --help`. The recipe leaves the tree alone, so the outcome is safe, only slower to write and run by hand. A note in squawk's recipe that `squeal proof` does the same is squawk's change, not Squeal's.
- **The `packages/mobile` limit (023-09 D3) read right.** r4 quoted the 023-18 wording and drew the right conclusion.
- **Time.** Where the command was used it was as fast as by hand or faster: r4 27 s against s4's 118 s; r5 41 s against s5's 32 s. A proof spent 8.7 to 11.4 s per temporary checkout.

### Open for a later round

- Round 2's sentence is not a product text. After P1 and P2, run the five tasks again with no hint; the question is whether the skill and primer alone bring the commands in.
- r2's task again after P3, and a before/after task in a repository where the store already holds the current side (a worktree that has run its tests), which is the usual case for a user; every session here started with an empty store.
