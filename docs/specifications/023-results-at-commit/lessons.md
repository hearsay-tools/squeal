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

## Round 3 (023-23)

Row 023-23, wave 15, worker 37851dda, 2026-11-19 15:35Z to 17:29Z, on the lab VM. Squeal 0.1.568 as released (hub entry `d84397e`, tag `squeal--v0.1.568`), which carries round 1's P1 and P2 (the skill's step 8 and the "Red/green" section name `status --at` and `proof`) and fixes for P5 to P9. Claude Code 2.1.327, model `claude-sonnet-5-5`, no hint in any prompt. The brief is `tasks/wave-15.md`; the scripts, the per-session data and the judgements are in `tasks/023-23/`.

### Verdict

- **Discovery works now.** With no hint, 55 of 55 non-control sessions loaded the skill and used the right command: `squeal proof` in 30 of 30 red-proof sessions, `squeal status --at` in 25 of 25 before/after sessions. Round 1: 0 of 5. The 3 control sessions used neither.
- **No session that used them wrote to its tree.** 0 swaps in 55. The only write that swapped versions was in a control session (s6-03, below).
- **Red proofs are right.** 30 of 30 answers right, 23 to 90 s per session (round 1 by hand: 21 to 118 s). Every s5 session read P9's new line, "red only under the conditions (without them: pass)", and claimed no more than it showed.
- **Before/after does not get an answer on an empty store.** No session of 25 passed `--run`. With an empty store (s1, s2) every file read `no result -> no result`, so no session could answer the question in full: 12 of 20 said they could not tell, 3 added a proof of the new test and stated the rest as unknown, 5 claimed more than they had (2 over-claims, 3 gave a red proof as the file's changed result). With the store holding HEAD's results (s7), 5 of 5 answered right: no file changed result, 1,799 unchanged, the new file passes, and 24 files left unknown that `--run` would have settled.
- **Every before/after session also ran `status --at` on HEAD itself** (25 of 25), believing it gives the "after" side. Each call keyed 1,920 or 1,962 test files in 57 to 104 s; the pair passed the agent's 120 s tool limit in 19 of 25 sessions, which then polled a background output file.
- **New findings:** the report on no-result files names no next step (no `--run`); the key of one test file at `--at HEAD` differs from its key in a clean worktree at HEAD; the daemon in squawk took more than 60 s to start, so 3 of 3 control sessions got no verdict from their first wait; a directory path to `squeal run <group>` selects nothing and the text misled one agent.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. 1-minute load 0.95 to 10.69 at each session's start; at most 3 sessions at once, each started only while the load was below 12 (`bin/batch.mjs`). |
| Isolation | Throwaway OS user `squeal-w15`, case root `~squeal-w15/runs/w15` (`HOME`, `TMPDIR`, `CLAUDE_CONFIG_DIR`, `XDG_RUNTIME_DIR`, the pnpm store under it), cwd `/`, `env -i`; never the VM's `agent` HOME or its Claude Code configuration. The VM's Claude Code reaches the API through `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` (no login file); both passed by name only through `sudo --preserve-env`. |
| Squeal | The release's own `install.sh` (`git show squeal--v0.1.568:install.sh`) with `SQUEAL_MARKETPLACE` pointing at a clone of the hub at `d84397e`; `claude plugin install squeal@hearsay` fetched the plugin from public github.com; `squeal --version` printed 0.1.568. |
| Harness | Node 24.21.0 (nodejs.org, checked against `SHASUMS256.txt`); Claude Code 2.1.327 from npm into the case root; `timeout 1200 claude -p --model sonnet --output-format stream-json --verbose --include-hook-events --permission-mode bypassPermissions <prompt>`, the prompts exactly as round 1 (`tasks/023-23/bin/prompts.json`; s7 has s1's prompt). |
| Repositories | squawk: a bundle of history up to `0dfe0724c`, one fresh clone per session at the session's commit; Squeal: `git fetch --depth 50` of `20f03a431` from github.com. Each clone had its own `pnpm install --frozen-lockfile` (2 to 11 s with the shared store) and its own Squeal store. s5 and s6: round 1's fixtures (`tasks/023-10/bin/fixture-s5.mjs`, `fixture-s6.mjs`). |
| Daemon | Started by each session's hooks, lookup-only. s1 to s6: no stored result at the start. |
| s7 store | s7-01's clone ran `squeal start`, then `squeal run --all --wait` for 32 min (load about 11): 1,823 of 1,920 test files current; the 97 `browser` files run only on request and stayed without a result; 3 known failures from the VM (no Chrome for the e2e global setup; 2 tests in `packages/web/src/test/poll.test.ts`). s7-02 to s7-05 (the coordinator's choice, a test shortcut, not what a user does): a fresh clone at the same commit with its own install, s7-01's `.git/squeal` copied in (without `locks` and `logs`) before Squeal started there; `squeal status --wait 120000` then read 1,823 current and 97 not current, the same as s7-01, and `--full` listed the results as "Inherited from other worktrees: 33884 current results … from …/s7-01". s7-01 stayed on disk until s7-05 ended. |
| Cost | 58 sessions, $4.16 in all (the last result event of each session; `total_cost_usd` is cumulative). |
| Cleanup | After each session `squeal stop` and the clone removed; at the end every clone, the sources, the stores, the installs and the user's `/tmp` files removed, no process of the user left. The transcripts (`~squeal-w15/runs/w15/claude/projects`, 14 MB; the agents' background outputs under `tmp`, 9 MB) and the full streams under the work folder stay on the VM until the coordinator lets them go. |

### Per group

Wall time is the session's, from its first stream line; cost is the sum over the group.

| Group (n) | Expected | Right command | Answer | Swaps | Skill loaded | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|
| s1 before/after, squawk `8be977ad6`, empty store (10) | `status --at d8abcfe46`, with `--run` | `status --at` 10 of 10, never `--run`; `proof` of the new test 5 of 10 | full 0; honest "cannot tell" 5; partial with a proof 3; over-claim 2 (s1-04, s1-05) | 0 | 10 | 251 s (207 to 699) | $0.79 |
| s2 before/after, Squeal `20f03a431`, empty store (10) | `status --at a5c9b7223`, with `--run` | `status --at` 10 of 10, never `--run`; `proof` 3 of 10 | full 0; honest "cannot tell" 7; red proof given as the file's changed result 3 (s2-02, s2-09, s2-10) | 0 | 10 | 262 s (208 to 730) | $0.83 |
| s3 red proof, source fix, squawk `6414b6c20` (10) | `proof <test> --base HEAD~1` | 10 of 10 | right 10 (proven; the 3 failing tests and their assertions) | 0 | 10 | 35 s (28 to 38) | $0.54 |
| s4 red proof, test-only fix, squawk `e71888f91` (10) | `proof <test> --base HEAD~1 --case test` | 10 of 10 (9 left `--case` to its default, which picked `test`) | right 10 (proven; expected `[101 … 105]`, got `[]`) | 0 | 10 | 32 s (23 to 90) | $0.56 |
| s5 red proof, hidden dependency (10) | `proof <test> --base HEAD~1 --env GITHUB_RUN_ATTEMPT=2` | 10 of 10, all with `--case test` (the same sides as `dependency` here); 4 also ran a proof with the variable unset | right 10 | 0 | 10 | 59 s (47 to 73) | $0.76 |
| s6 control: fix `report-title.test.ts` (3) | neither command | neither, 3 of 3 | fixed 2; s6-03 asked instead | 1 (s6-03) | 0 | 97 s (75 to 97) | $0.18 |
| s7 before/after, squawk `8be977ad6`, HEAD's results stored (5) | `status --at d8abcfe46`, `--run` for the files with no result there | `status --at` 5 of 5, never `--run` | right 5: 0 flips, 1,799 unchanged, the new file passes; 23 files with no result at the parent and 97 never run, all stated as unknown | 0 | 5 | 226 s (222 to 238) | $0.50 |

Per session: `tasks/023-23/data/judgements.tsv` (command, answer and reason, swaps, misread text) and `data/<id>/` (timeline, summary, the clone's git state after the session).

s6-03 in detail: its first `squeal status --wait 60000 packages/contract/src/report-title.test.ts` returned after 60 s with no verdict while the daemon was starting. The agent then ran `git checkout packages/contract/src/report-title.ts`, discarding the user's uncommitted edit, wrote "I shouldn't have reverted that", restored the edit with Edit and asked the user which side is right. Its tree ended with the user's edit as before.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| A report of only unknown files, ending `0 pass -> fail, 0 fail -> pass, 0 unchanged, 1920 unknown`, after `1920 test files: no result -> no result: … and 1917 more`; no next step | s1, s2: 20 of 20 | Read it right ("no stored results, nothing to compare") but never found `--run`; offered `proof`, a wait, or a hand run (s2-07: `pnpm exec vitest run` at each commit). |
| `squeal status --at <commit>: … against the working tree (HEAD <sha>)` | 25 of 25 | Ran `--at` on HEAD too, as the "after" side. Only s7-01, s7-02 and s7-04 said afterwards that the HEAD call compared HEAD with itself. |
| `squeal: keying test files at <commit> in a temporary checkout` | s1-10, s2-06 | Said while waiting that Squeal "runs the tests" / "has to run 1962 test files" in the checkout; it keys only. |
| `green: not run (red passed: nothing to prove)` | s1-05 | Wrote that `ast-rules-active-run.test.ts` "passes both with the parent's code and with the commit's code". Round 1's P7 text was changed and the misreading stayed (r1 there, s1-05 here). |
| A source-case proof's red side (`the test at <HEAD> over the code at <base>`) | s2-02, s2-09, s2-10 | Gave it as the file's result at the parent: "its result did change", "It failed at the parent commit", "It went from fail to pass". The parent's own version of `test/store/open.test.ts` was never run. |
| `packages/cezar/src/lint selects no test file of any group.` (from `squeal run tests packages/cezar/src/lint --wait 300000`) | s1-04 | "Squeal found no test file under `packages/cezar/src/lint`"; there are several. A directory is not a path the command selects by. |
| `no test file's closure holds packages/contract/src/report-title.test.ts` (first wait, daemon starting) | s6-03 | Gave up on the wait and reverted the user's edit (above). The file is a test file; the daemon had not listed it yet. |

Read right, round 1's fixes at work: the startup line "This worktree's daemon has not listed its test files yet: now is the stored results at the working tree's keys" (P5); the grouped unknown files, so `head -60` showed the whole report (P6); the line "`<file>` is new since `<commit>`: `squeal proof <file> --base <commit>` shows whether it fails on the code at `<commit>`" (P8), which 10 of 10 s1 sessions offered (5) or ran (5); s1-05's stop on an unchanged test ("changed files neither --with nor --source names") and its rerun with `--source`, as D5.2 intends; the e2e and `poll.test.ts` failures in s7, which every s7 agent named as unrelated or not settled.

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| Q1 | **`--run` is never found.** 0 of 25 before/after sessions passed it; on an empty store none of 20 could answer, and in s7 24 files stayed unknown. The report gives no next step, and the skill's step 8 and the "Red/green" section name `status --at <commit>` without `--run`. | When files read `no result` at the commit, end the report with the command and its size: "`squeal status --at d8abcfe46 --run` runs the 23 files with no result there (estimate …)". Name `--run` in step 8: "files with no result at the commit: add `--run`". |
| Q2 | **`--at HEAD` is run as the "after" side.** 25 of 25 sessions ran it; each cost 57 to 104 s of keying, and the pair passed Claude Code's 120 s tool limit in 19 of 25 sessions, which then polled a background file. | Step 8 and the help: "`--at <commit>` compares that commit with your working tree; one call is the whole comparison". When `<commit>` is HEAD, say "HEAD is your working tree's commit: compare with its parent, `--at HEAD~1`" and do not key. |
| Q3 | **Keying a commit takes about a minute every time.** 57 to 104 s per call on 12 CPUs for 1,920 or 1,962 test files, repeated for the same commit within a session; two agents believed it runs the tests. | Keep a commit's keys once computed (they do not change), so a repeated call is instant; start with "keying 1920 test files at <commit> (no test runs; about a minute)". |
| Q4 | **One key differs between the temporary checkout and the worktree.** In all 5 s7 sessions (the same store), `status --at 8be977ad6` with HEAD at `8be977ad6` and a clean tree read `packages/cezar/src/home/runtime-cli.test.ts: no result -> pass (now: run in this worktree)`, where every other file read unchanged. | Diagnose: something this test's key reads differs between a fresh checkout with a frozen install and the worktree (D5.1 names installed packages as one such input). Not diagnosed here. |
| Q5 | **A red proof is still given as the file's changed result** (s2-02, s2-09, s2-10; round 1's s1 and r1, P8). | In step 8: "a proof answers 'does the new test fail on the old code'; for the old version of the file at the commit, use `status --at`". In a source-case report whose test changed: "red is not the file's result at <base>: that version is `squeal status --at <base> <file>`". |
| Q6 | **"green: not run (red passed: nothing to prove)" still read as a pass at HEAD** (s1-05; round 1's r1, P7). | "green: not run. Red passed, so this proof says nothing about HEAD; `squeal status <file>` gives its result now." |
| Q7 | **A slow start reads as a verdict on the file.** In squawk the daemon took more than 60 s to start from an empty store: 3 of 3 control sessions' first 60 s wait returned with no verdict; s6-03's text said "no test file's closure holds" the test file itself, and the agent reverted the user's edit. | While the daemon is starting, say only that: "Squeal is still starting here (62 s); wait again with the same command"; never a closure statement about a file it has not listed. |
| Q8 | **A directory path selects nothing** (s1-04, "selects no test file of any group"). | Take a directory as its test files, or say "a directory is not a path `squeal run` selects by; name test or source files". |

Not product defects, recorded for the coordinator:

- **s6-03's revert** came after Q7's text, but discarding a user's uncommitted edit is the agent's own step; it restored the edit itself.
- **s1-04's lead sentence** ("No existing test file changed") contradicts its own later text; Squeal said nothing to that effect.
- **The s7 store copy** is a test shortcut; `squeal status --full` named the results as inherited from s7-01, and no s7 agent mentioned inheritance.
- **Empty folders stay behind.** After the round the user's `~/.cache/squeal/checkouts` held 56 empty folders (224 KB), one per clone that ran `status --at` or `proof`; the checkouts in them were removed (spec D6). Harmless, but a user's cache grows by one folder per repository and copy.
- **The warm-up** (`squeal run --all --wait`) took 32 min on 12 CPUs and ended with exit 3 because the 97 `browser` files run only on request.

### Open for a later round

- After Q1 to Q3, s1 and s2 again with no hint: whether the report's next step brings in `--run` and a full answer fits the session's limit. Round 1's P3 (`--run` in Squeal's repository past its budget) stays untested: no session here passed `--run`.
- These rounds used Claude Code and Sonnet only; the Codex, Pi and OpenCode copies of the skill text were not exercised.

## Round 4 (023-28)

Row 023-28, wave 17, worker 8b7173f6, 2026-11-20 14:34Z to 16:25Z, on the lab VM. Squeal 0.1.577 as released (hub entry `c126136`, tag `squeal--v0.1.577`), which carries Q1 (the report ends with the `--run` command and its size), Q2 ("one call is the whole comparison"; `--at HEAD` on a clean tree names `HEAD~1` and does not key), Q5, Q6 and Q7, and names `--run` in the skill's step 8. Claude Code 2.1.327, `--model sonnet`, prompts exactly as round 3, no hint. The brief is `tasks/wave-17.md`; scripts, per-session data and judgements are in `tasks/023-28/`.

### Verdict

- **No. `--run` is now found, but no session got a full answer.** 25 of 25 sessions passed `--run` with no hint (round 3: 0 of 25). 0 of 25 answered the whole question. 11 gave a partial answer that was right for the files they compared; 1 more (s7-04) gave a partial answer with one unsupported claim; 7 said honestly they could not tell; and 6 were wrong.
- **On an empty store, `--run` fills only one side.** It runs the commit's files. The working tree side stays `no result`, and `--at HEAD --run` says "no file with no result at <HEAD> to run" even when every file has no result there. The 7 partial answers in s1 and s2 came from sessions that ran the current side themselves, with `squeal run tests` or a path-limited `--at HEAD~1 --run`.
- **`--run` is blocked for reasons the report gets wrong.** In squawk, the browser group's setup fails on a host without Chrome and stops the whole batch: "0 of 108 ran" after 70 s, yet the report says "108 not run (budget)" and suggests `--timeout 600`, then `--timeout 1200`. 4 of 5 s7 sessions reran with the longer budget and got the same result. In Squeal's own repository, the parent's `--run` selects 1,338 files for a 7-line change, runs 0 to 56 of them in 300 s, and still offers "A rerun that fits: … --timeout 600".
- **The red-proof misreading doubled.** In s2, 6 of 10 sessions gave the proof's red side as the file's change (round 3: 3 of 10). Each proof printed Q5's new line: "red is the test at <HEAD> over the code at <base>, not the file's own result at <base>". The 3 sessions that ran `--at HEAD~1 --run test/store/open.test.ts` got the right answer (pass at both commits) in under a minute.
- **HEAD is still compared with itself.** 24 of 25 sessions called `--at` on HEAD (round 3: 25 of 25). 22 of them passed `--run` on that call at least once, which skips Q2's refusal, so the call keyed for up to 99 s and then compared HEAD with itself. The 5 sessions that made the call without `--run` got the refusal and went on with `HEAD~1`, as intended.
- **New:** a `--run` checkout left a squawk e2e server and headless Chrome running after the session and the checkout had ended. Round 3's Q4 key difference showed again in 4 of 5 s7 sessions, s7-01's own store included.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs, used from 14:34Z, after the coordinator's steer (the previous runs ended 14:29Z, load 0.31). 1-minute load at session start 1.93 to 11.62. Sessions started only while the load was below 12, at most 3 at once (`bin/batch.mjs`). The load reached 20.75 at 14:54Z: `--run` now runs tests inside 3 sessions at once, which the start gate cannot see. |
| Isolation | Throwaway OS user `squeal-w17`, case root `~squeal-w17/runs/w17`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 3. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.577:install.sh`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `c126136`; `squeal --version` and `claude plugin list` printed 0.1.577. |
| Harness | Round 3's scripts with the changes in `tasks/023-28/notes.md`; `summarize.mjs` now also counts `--run`, each `--at` revision, HEAD calls and calls past 120 s. |
| Repositories | As round 3: squawk at `8be977ad6` (s1, s7), Squeal at `20f03a431` (s2), one fresh clone and install per session. |
| s7 store | s7-01: `squeal run --all --wait`, 34 min, exit 3. 1,823 of 1,920 files current, the 97 `browser` files only on request, and the 3 known failures of round 3 (e2e global setup without Chrome, 2 tests in `poll.test.ts`). s7-02 to s7-05: s7-01's store copied in (round 3's shortcut). Each copy read 1,822 or 1,823 current results "Inherited from other worktrees". |
| Order | s1-01 alone as a trial, then s1-02..10 and s2-01..10 interleaved, 3 at once; then s7-01's warm-up and session alone; then the s7 copies, 3 at once (`bin/s7chain.sh`). |
| Cost | 25 sessions, $2.36 (s1 $1.03, s2 $0.94, s7 $0.40). |
| Cleanup | Each clone was removed after its session. At the end: every process of the user ended, the user and its home removed, `/opt/squeal-w17` and the user's 63 `/tmp` entries removed, and the work folder deleted, transcripts included. No uid-1002 file and no process left. |

### Per group

Round 3's counts are in brackets. "Past 120 s" counts sessions with at least one tool call longer than Claude Code's 120 s default limit, whether it was moved to the background or the agent had raised its own timeout to 600 s.

| Group (n) | `--run` | Answer | `--at` on HEAD (refused) | Past 120 s (moved to background) | Swaps | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|
| s1 squawk before/after, empty store (10) | 10 [0] | full 0 [0]; partial, right 4 [3] (s1-03, 05, 09, 10: the lint folder at both sides); honest "cannot tell" 6 [5]; wrong 0 [2] | 9 [10] (4) | 9 (3) | 0 [0] | 327 s (214 to 543) [251 s] | $1.03 [$0.79] |
| s2 Squeal before/after, empty store (10) | 10 [0] | full 0 [0]; partial, right 3 [0] (s2-01, 07, 10: `open.test.ts` passes at both commits); honest 1 [7]; wrong 6 [3] (s2-02, 04, 05, 06, 08, 09: red proof given as the file's change) | 10 [10] (1) | 10 (9) | 0 [0] | 478 s (215 to 545) [262 s] | $0.94 [$0.83] |
| s7 squawk before/after, HEAD's results stored (5) | 5 [0] | partial, right 4 [5]: 0 flips, 1,802 unchanged, 118 unknown at the parent (97 browser, 20 that `--run` could not run, the new file); s7-04 limited itself to the lint folder (27 unchanged) and claimed a parent result for `layer-import.test.ts` that the report did not give | 5 [5] (0) | 4 (0) | 0 [0] | 308 s (170 to 389) [226 s] | $0.40 [$0.50] |

Per session: `tasks/023-28/data/judgements.tsv` and `data/<id>/`, which holds the timeline, summary, the Squeal calls with their full output in `squeal-results.txt`, and the clone's state after `squeal stop`.

The s7 unknowns did not shrink: round 3 left 120 files unknown (23 without a result at the parent and 97 browser files) without `--run`, and this round leaves 118 with it.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `--run: no file with no result at 8be977ad6 to run`, after `1920 test files: no result -> no result` (`--at HEAD --run` on an empty store) | 17 of 20 in s1 and s2 called it | Read it correctly as nothing to compare. No session learned from it how to fill the current side, because the report does not say. |
| `red is the test at <HEAD> over the code at <base>, not the file's own result at <base>; that is squeal status --at <base> <file>` (Q5's line in the proof report, under the red side's diff) | s2: 6 of 6 sessions that ran `proof` | Gave "fail -> pass" or "the only file shown to change result" anyway. s2-09 half-read it: "strictly, this file had no new failure to flip at the parent". |
| `108 not run (budget). A rerun that fits: squeal status --at '8be977ad6~1' --run --timeout 600`, after `--run: 0 of 108 … ran … (70.4 s of the 300 s budget)` and `vitest run: the run failed to start: Browser E2E environment bootstrap failed` | s7: 5 of 5 (s7-04 avoided it by passing a path) | 4 reran with `--timeout 600`, got the same result, and then offered `--timeout 1200`. The cause was the failed browser setup, not the budget. |
| `1307 not run (budget). A rerun that fits: … --timeout 600`, after 31 of 1,338 ran in 301 s | s2: 7 final answers name it as the next step (s2-04 to s2-10) | Offered the rerun as the way to a full answer; at that rate 600 s runs about 60 files, not 1,307. |
| `--run: 9 of 9 test files with no result at d8abcfe46 ran`, beside `layer-import.test.ts: no result -> pass` | s7-04 | "I ran it in the parent's checkout and it passes there too". The file was not in the selection, and the report does not say so. |
| `packages/cezar/src/lint selects no test file of any group` / `these paths select none` (a directory given to `squeal run`) | s1-05, s1-08, s1-09 | Retried with `squeal run tests <dir>` or file paths. Q8 is still open (row 023-27). |

Read right this time: `squeal status --at: 8be977ad6 is HEAD, your working tree's commit, and the tree is clean: compare with its parent` (5 of 5 sessions that got it went on with `HEAD~1`); `pass -> no result (at d8abcfe46: run by this command, not stored)` (s1-07: "a measurement gap, not a regression"); the s7 `poll.test.ts` failures (5 of 5 named them as not settled, not as caused by the commit); `<file> is new since <commit>` (every s1 and s7 session named the new test as new, not as changed).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| R1 | **`--run` leaves the current side empty.** On an empty store, no s1 or s2 session could compare the suite. `--at <commit> --run` runs only the commit's side, and `--at HEAD --run` finds "no file with no result to run" although all 1,920 files have none. The 7 partial answers came from sessions that ran the current side themselves. | With `--run`, also run, through the worktree's daemon, the selected files that have no result now, within the same budget. If not, end the report with the step: "the working tree has no result for N of these files: `squeal run tests <files> --wait`". In step 8: "`--run` covers both sides". |
| R2 | **Q2's refusal does not apply with `--run`.** 22 of 25 sessions called `--at <HEAD> --run` at least once. Each such call keyed for up to 99 s and then compared HEAD with itself. The 5 calls without `--run` got the refusal and did the right thing. | Ask `headRefusal` with `--run` too. With R1, the refusal can name `--at HEAD~1 --run`. |
| R3 | **A failed batch setup is reported as the budget.** s7: "0 of 108 ran" after 70 s of 300 or 600 s, then "108 not run (budget)" and "a rerun that fits: --timeout 600", then 1200. The browser group's setup (no Chrome) stopped the whole batch, including the 20 other files. 4 of 5 sessions reran and failed the same way. | Report it as a setup failure: "108 not run: the batch's setup failed (Browser E2E … Chrome failed to launch)". Run groups that run only on request (here `browser`) in their own batch, or leave them out of `--run` unless they are named, so their setup cannot stop the rest. |
| R4 | **"A rerun that fits" does not fit.** s2: 31 of 1,338 ran in 301 s, and the report offers `--timeout 600` for the 1,307 left. | Compute the fit from the rate measured in this run. When no budget up to the cap fits, say so: "1307 not run; at this run's rate they need about 3 h". |
| R5 | **The red proof is still read as the file's change, now 6 of 10 s2 sessions.** Q5's line was printed in every one of those proofs, under the red side's stack trace and diff. The right command, `--at HEAD~1 --run <file>`, gave 3 sessions the right answer in under a minute. | Put the distinction in the proof's summary line ("proven: the new test fails on the old code. This is not the file's result at <base>"). In step 8: "to compare a changed test file with its old version: `squeal status --at <base> <file> --run`; `proof` answers a different question". |
| R6 | **`--run` leaves processes behind.** s1-10's parent `--run` started squawk's e2e test environment in its checkout. A `cezar serve`, an `agent-browser` and 15 headless Chrome processes were still running 4 minutes after the session ended, after `squeal stop`, and after the checkout was removed (cwd "(deleted)"). The user's `/tmp` held 63 entries from the e2e harness. | When `--run` or `proof` removes a checkout, first end every process of the user whose cwd or command line lies under it, and name them in the report. The harness's own leak belongs to the project, but Squeal owns the checkout's lifetime. |
| R7 | **Q4 shows again.** `packages/cezar/src/home/runtime-cli.test.ts: no result -> pass` in the HEAD comparison of 4 of 5 s7 sessions. In s7-01 the results were its own ("now: run in this worktree"), with no store copy. Row 023-25 could not reproduce it. | Give 023-25 this setup: a clone (`git clone --no-checkout` from a bare repository, then `checkout -B main 8be977ad6`), `pnpm install --frozen-lockfile`, `squeal run --all --wait`, then `status --at HEAD --run`. |
| R8 | **A file outside the `--run` selection reads as if it ran.** s7-04: "9 of 9 … ran" beside a file still at `no result`. | Mark such files: "`layer-import.test.ts`: no result at d8abcfe46, not selected by the change; `--all-missing` runs it". The next-step line already names `--all-missing` without `--run`. |

Not product defects, recorded for the coordinator:

- **Longer sessions.** Wall medians rose from 251/262/226 s to 327/478/308 s, because `--run` now runs tests. s2's parent `--run` alone used the whole 300 s budget. No session reached the 1,200 s session limit.
- **One agent cited the repository's rules.** s2-03 stopped its own background comparison because "the project's rules say not to" run a full suite. Squeal's own repository has that rule for its agents.
- **The s7 store copy** is round 3's test shortcut. No agent mentioned inheritance.
- **Empty folders stay behind.** 25 empty folders in the user's `~/.cache/squeal/checkouts`, one per clone, as round 3 noted.

### Open for a later round

- After R1 to R4: s1 and s2 again, to see whether a full answer fits a session on an empty store and within the 1,200 s session limit. In Squeal's own repository a 7-line change selects 1,338 files, so R1 may need a selection cap or a statement of what is left.
- R5's step-8 wording with s2 only, at least 10 sessions, since s2 alone shows the proof misreading.
- Codex, Pi and OpenCode are still not exercised.

## Round 5 (023-33)

Row 023-33, wave 19, worker c997603f, 2026-11-21 07:12Z to 08:41Z, on the lab VM. The human chose the VM this once, as round 4, because the boat.dev sandbox had no model credential. Squeal 0.1.584 as released (tag `squeal--v0.1.584`, hub entry `cf42b11`), which carries 0.1.583's R1 to R6. Claude Code 2.1.327, `--model sonnet`, prompts exactly as round 4, no hint. The brief is `tasks/wave-19.md`; scripts, per-session data and judgements are in `tasks/023-33/`.

### Verdict

- **Still no full answer, but no wrong one.** 0 of 20 sessions answered the whole question. 13 gave a partial answer that was right for the files they compared (s1 10, s2 3); one of them (s1-03) added an unsupported side claim. 7 said honestly they could not tell. 0 were wrong (round 4: 6).
- **squawk (s1): one call now gives all the answer the store can give.** 10 of 10 sessions made one `--at <parent> --run` call. It filled both sides (R1) and reported 0 flips, 14 unchanged and the new test file, in 175 to 350 s. Round 4: 4 partial, 6 "cannot tell". Every s1 answer stopped short of full for the same three reasons. Squeal printed each one and the agents read it right: 2 selected lint files ran but were not kept ("read paths first seen during the run"); 97 browser files did not run, because the VM has no Chrome (R3's new line); and 1,808 files were "not selected by the change". All 10 listed those 1,808 as not compared. None said the commit cannot change their result.
- **Squeal's own repository (s2): R1 works against a wide change.** The parent `--run` selects 1,338 files. At the end of its 300 s budget, 35 to 50 have run at the parent and 0 to 11 in the working tree. The rest "go on in the daemon": about 1,300 files stay queued in the agent's own daemon, and Squeal's own estimate was 71 to 110 minutes. All 10 sessions then narrowed to `test/store/open.test.ts`, as R4's line asks. In 7 of them, that one file's working-tree run waited behind the queue ("behind the vitest tier of 200 test files …; the tier does not yield") for the whole 300 s budget. The 3 right answers came from narrowed calls that ended in 41 to 53 s, made before the queue filled or between its tiers.
- **R2, R3, R4 and R5 worked as intended.**
  - R2: every `--at <HEAD> --run` call was refused, in 13 sessions (round 4: 22 of 25 sessions compared HEAD with itself).
  - R3: the browser setup failure was named, and 10 of 10 s1 sessions called it an environment problem.
  - R4: "at this run's rate they need about 79 min; name test files or folders to narrow it" made 10 of 10 s2 sessions narrow.
  - R5: no session ran `proof` (round 4: 6 of 10 s2 sessions ran it, and all 6 misread it). The sessions used `--at <base> <file> --run` instead.
- **R6 is half fixed.** In 16 sessions Squeal ended what ran under its checkout ("ended 2 processes left under the checkout (cezar, test-env-lease watch-app)"). But the working-tree side now runs in the user's own tree through the daemon. In 10 of 10 s1 sessions, squawk's e2e environment started there (its server and lease watcher) outlived the session and `squeal stop`.
- **Time:** s1 median 287 s (round 4: 327 s). s2 median 796 s (round 4: 478 s), longest 918 s. No session reached the 1,200 s limit, but s2 spent most of its time waiting for runs that did not end.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 07:10Z the load was 0.00 and no user job ran (the coordinator: "VM free"). Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 1.05 to 13.21. The 15-minute load was 15.6 at 08:39Z, and agents quoted 1-minute loads of 10 to 33: the queued daemon runs of R1 kept running after each call ended. |
| Isolation | Throwaway OS user `squeal-w19`, case root `~squeal-w19/runs/w19`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 4. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.584:install.sh`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `cf42b11`; `squeal --version` and `claude plugin list` printed 0.1.584. |
| Harness | Round 4's scripts with the changes in `tasks/023-33/notes.md`. New: 5 s after `squeal stop`, each process left under the session's clone or its checkout folder is recorded in `leftover.txt` and then ended. |
| Repositories | As round 4: squawk at `8be977ad6` (s1), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (175 s), then s1-02..10 and s2-01..10 interleaved, 3 at once. |
| Cost | 20 sessions, $1.78 (s1 $0.74, s2 $1.04). The boat.dev sandbox ran no session; it was deleted after 3,699 billed seconds of a large type, $0.037. |
| Cleanup | Each clone was removed after its session. At the end: every process of the user ended, the user and its home removed, `/opt/squeal-w19` and the user's 170 `/tmp` entries removed, and the work folder deleted, streams and transcripts included. No uid-1002 file and no process left. |

### Per group

Round 4's counts are in brackets. "Both sides" counts sessions that got a result on both sides for the files they compared. "Past 120 s" counts sessions with at least one tool call longer than Claude Code's default 120 s limit; in brackets after it, the sessions in which Claude Code moved a call to the background.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (10) | 10 [10] | 10 [0]: 14 of the 16 selected unit files (s1-08: 12) | full 0 [0]; partial, right 10 [4] (s1-03 with one unsupported claim); honest 0 [6]; wrong 0 [0] | 3 [9] (3; s1-04, 06 and 08 also hit "--wait with --at") | 10 (0) [9 (3)] | 0 [0] | 10 of 10: the e2e server and lease watcher in the clone; 8 also a Squeal store process | 287 s (175 to 350) [327 s] | $0.74 [$1.03] |
| s2 Squeal, empty store (10) | 10 [10] | 3 [3]: `open.test.ts` (s2-03, 04, 07); 3 more read only the parent side | full 0 [0]; partial, right 3 [3] (`open.test.ts` passes at both commits); honest 7 [1]; wrong 0 [6] | 10 [10] (10 [1]) | 10 (8) [10 (9)] | 0 [0] | 4 of 10: a Squeal store process only | 796 s (467 to 918) [478 s] | $1.04 [$0.94] |

Per session: `tasks/023-33/data/judgements.tsv` and `data/<id>/`, which holds the timeline, summary, the Squeal calls with their full output in `squeal-results.txt`, the clone's state after `squeal stop`, and `leftover.txt`.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `1808 test files: no result at d8abcfe46, not selected by the change; --all-missing runs them`, and the summary `… 14 unchanged, 1906 unknown` | s1: 10 of 10 | Listed them as "not compared" or "unknown"; 8 offered `--all-missing` (slow) as the way to a full answer. None said the commit cannot change their result. s1-08 came closest: "I'm relying on that import analysis". |
| `1 not stored (the gate did not keep it: it read paths first seen during the run (.ai/ast-grep/rules/…baseline.json))`, twice | s1: 10 of 10 | Named both files as not compared, which is right. s1-03 said the commit touches those baseline files; it touches only `active-run-write.ts` and its new test. No session reran them. |
| `test/store/open.test.ts: pass -> no result (queued)`, then `now: 1 without a result: the budget ended; their runs go on in the daemon`; in `status --wait`: `queued, promoted, … behind the vitest tier of 200 test files …; the tier does not yield` | s2: 7 of 10 | Waited 2 to 4 more minutes, then answered "cannot tell". No session saw that its own first `--run` had queued the 1,300 files ahead of its file. s2-05 would not run the file by hand "since CLAUDE.md says to rely on Squeal". |
| The narrowed call's result (parent `pass`, stored) | s2-01, 08, 09, 10 | Said the parent side had no result. They never read the output: the call ran the full 300 s budget, Claude Code moved it to the background at the same second (the agents had set a 300 s timeout), and Claude Code blocked their `sleep N; cat <output>`. This is not Squeal's text, but the timing is Squeal's. |
| `squeal status: unknown option "--wait" with --at`, followed by the whole help | s1-04, 06, 08 | Retried without `--wait`; under 2 s each. |

Read right this time: the HEAD refusal with `--run` (all 13 sessions went on with `HEAD~1`); R3's `97 not run: the batch's setup failed (browser: … Chrome failed to launch)` (10 of 10 called it the environment); R4's rate line (10 of 10 narrowed); `<file> is new since <commit>`; `pass -> no result (running) (at d8abcfe46: run by this command, not stored)` (s1-08).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| T1 | **A wide `--run` fills the user's daemon and blocks the narrowed call that follows.** In s2, the parent `--run` selects 1,338 files. In the working tree 0 to 11 run before the budget ends, and about 1,330 "go on in the daemon", which Squeal estimates at 71 to 110 minutes. In 7 of 10 sessions the next call, narrowed to one file as R4 asks, waited the whole 300 s behind that queue ("the tier does not yield") and returned `pass -> no result (queued)`. Host load rose, and the s2 median went from 478 to 796 s. | When the budget ends, remove from the daemon's queue the files this call queued and did not start, and say so ("now: 1,331 not run; taken back from the daemon"). A later `--at … <file> --run` puts its named files ahead of earlier `--run` work. Before running, when the selection clearly cannot fit (1,338 files, no stored durations), print R4's line and run nothing until the user narrows. |
| T2 | **"Not selected by the change" reads as "not compared".** 10 of 10 s1 sessions counted the 1,808 files as unknown, and the summary line counts them in `1906 unknown`. Their inputs are equal at both commits, so the commit cannot change their result, except the incomplete closures that Squeal already lists. | Say what it means: "1808 test files: not selected: none of their inputs differs between d8abcfe46 and the working tree, so this commit cannot change their result (the 15 with an incomplete static closure excepted; `--json` lists them)". Count them apart from "unknown" in the summary line. |
| T3 | **R6 covers the checkout, not the working tree.** The working-tree side now runs in the user's tree through the daemon. squawk's e2e server and lease watcher, started by that run, outlived `squeal stop` in 10 of 10 s1 sessions (cwd: the clone). | Record the process group of each run the daemon starts for `--run`, as for the checkout's install, and stop it when the run ends; let `squeal stop` end what is left, and name it. |
| T4 | **A selected file that the gate never keeps can never be compared.** In s1, 2 of 16 selected unit files ran on both sides and were kept on neither ("read paths first seen during the run"). | In a `--run` comparison, compare such a file from this run's results on both sides, marked "(this run, not stored)". The parent side already shows that in s1-08. |
| T5 | **`--wait` with `--at` prints the whole help.** 3 s1 sessions. | One line: "`--at` takes no `--wait`; `--run` waits up to `--timeout` (300 s)". |
| T6 | **The budget ends exactly when the agent's tool limit does.** 8 of 10 s2 sessions set a 300 s Bash timeout, and the call that used the full 300 s budget went to the background at the same moment. 4 of them never read that output. | Step 8 of the skill: "give the call a timeout above `--timeout`, for example 360 s for the default 300 s". Or end the budget a few seconds before a round number. |

Not product defects, recorded for the coordinator:

- **No Chrome on the VM**, as in round 4: the 97 browser files could not run on either side. With Chrome they would run (023-32 saw 96 of 97).
- **A Squeal store process was alive 5 s after `squeal stop`** in 12 of 20 sessions. The check did not wait longer, so this can be a normal slow exit. The harness ended it.
- **`/tmp` collects squawk's e2e folders**: 170 entries after 21 runs (round 4: 63 after 25).
- **The sessions share one OS user**, so s2-07 saw another session's `--run` in `pgrep` and named it as host load. The same held in round 4.
- **One agent cited the repository's rules again**: s2-05 would not run a test by hand.

### Open for a later round

- After T1: s2 again, 10 sessions, to see whether the narrowed call then gets both sides inside a session.
- After T2: s1 again; the full answer is then within reach of one call, except where Chrome is missing.
- s1 on a host with Chrome and a model credential (a boat.dev sandbox once the account has one), to compare the 97 browser files too.
- Codex, Pi and OpenCode are still not exercised.

## Round 6 (023-44)

Row 023-44, wave 27, worker 9016d863, 2026-11-22 16:42Z to 17:47Z, on the lab VM. A boat.dev sandbox was checked first: it has Claude Code but no Claude login, the account holds no model credential for sandboxes, and this host's credential is never forwarded. The human then allowed the lab VM this once ("Lab VM once", 2026-11-22), as for round 5. Squeal 0.1.597 as released (tag `squeal--v0.1.597`, hub entry `e74aa47`), which carries spec D7: `status --at --run` on the commit daemon and the worktree daemon, a 100 s wait and then a return with the rest still running, a later `--wait` that joins it, and `proof`'s passing side on the commit daemon. Claude Code 2.1.327, `--model sonnet`, prompts exactly as round 5, no hint. The brief is `tasks/wave-27.md`; scripts, per-session data and judgements are in `tasks/023-44/`.

### Verdict

- **Still no full answer, but every answer is now partial and right.** 0 of 20 sessions answered the whole question. 20 of 20 gave a partial answer that was right for the files they compared. 3 of them stated one sentence too strongly (s2-08, s2-10, and s2-02's "I stopped it"); 2 of them got a side fact wrong (s1-04, s1-10). 0 said only "cannot tell" (round 5: 7), and 0 were wrong (round 5: 0).
- **Much faster.** The s1 median fell from 287 s to 109 s. The s2 median fell from 796 s to 263 s, and the longest s2 session took 709 s (round 5: 918 s). The wide first call now returns at the 100 s wait instead of the 300 s budget. A call narrowed to one file then gets both sides in 1 to 95 s, even with the wide queue still running: T1 is fixed for single files. No call went to the background (round 5: 8 s2 sessions).
- **s1 (squawk): one call, about 100 s.** 10 of 10 sessions made one `--at <parent> --run` call. Each reported 0 flips, 11 unchanged and the new test file, and named "124 not selected: … this commit cannot change their result" right (T2). All 10 stopped short of a full answer for three reasons:
  - 1,669 + 16 files had no result at the parent, and their runner "does not tell whether the static closure is complete".
  - 97 browser files could not run on the VM (no Chrome).
  - 2 files were reported "not comparable (needs .agents/skills/…)". That text is wrong: the path exists at the parent through a tracked symlink (V1). 9 of 10 sessions repeated it as fact.
- **s2 (Squeal's own repository): the wide selection still decides.** For a 7-line change, `--run` queued 1,338 files on each side. Squeal estimated "about 3 to 11 min at this machine's rate". The measured rate was 90 to 157 parent results in 320 to 400 s, and 144 in 700 s, with up to 3 sessions at once: about an hour or more, not minutes (V2). 9 of 10 sessions then narrowed. Their narrowing worked in two different ways:
  - **One file:** `test/store/open.test.ts` got both sides in 1 to 95 s. It passes at both commits.
  - **A folder:** the 5 sessions that narrowed to `test/store` got all 38 working-tree results. At the parent, 35 of 36 were still running after 98 to 298 s (V3).
  - **The one that did not narrow:** s2-09 joined with `--wait 600000` instead and got 143 unchanged and 1 flip. It judged the flip a timeout under load, which is right, and it did not retry it.
- **The new D7 texts were read right, with two exceptions.** 15 sessions got a call back with work still running, and 13 read it right. s2-06 read the queued full run as never started ("would have queued about 1,338 runs"). s2-02 said it "stopped" the run, which goes on. 3 sessions joined the running work with a later `--wait` (s2-05, s2-09, s2-10). A narrowed `--wait` then reports the whole queue ("joined 1338 …") rather than the named files (V4).
- **Kept from round 5:** the HEAD refusal (13 of 13 went on with `HEAD~1`); the browser setup failure named (10 of 10 s1 called it the environment); no swaps and no edits in any session. No session ran `proof`, so its D7 side was not exercised.
- **What sessions leave behind:**
  - Every session left its commit daemon and commit worktree after `squeal stop`, as D7.7 intends. The harness stopped each one with `squeal stop --at HEAD~1`; without that, each s2 commit daemon would have gone on with about 1,200 to 1,300 queued files (V5).
  - squawk's e2e server and its lease watcher outlived the session in 10 of 10 s1 sessions (T3 is still open). A lease watcher started in the commit worktree outlived its removal in 9 of 10 (V7).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 16:42Z the load was 0.00, no user job ran and no throwaway user from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 0.23 to 12.13, and it reached 19.5 at 17:07Z. The s2 commit daemons and worktree daemons ran about 1,330 files each, and all their CPU was the throwaway user's. |
| Isolation | Throwaway OS user `squeal-w27`, case root `~squeal-w27/runs/w27`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 5. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.597:install.sh`, `SQUEAL_VERSION=0.1.597`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `e74aa47` ("squeal 0.1.597"). `squeal --version` and `claude plugin list` printed 0.1.597. |
| Harness | Round 5's scripts with the changes in `tasks/023-44/notes.md`. New: after `squeal stop`, `squeal ps` and the session's checkout folders are recorded (`commit-left.txt`), then `squeal stop --at HEAD~1` and `--at HEAD` run. A new dry check (`setup.sh dryat`) ran `status --at HEAD~1 --run` with no model first. |
| Repositories | As round 5: squawk at `8be977ad6` (s1), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (85 s), then s1-02..10 and s2-01..10 interleaved, 3 at once. |
| Cost | 20 sessions, $1.19 (s1 $0.61, s2 $0.58). The boat.dev check cost $0.0001; the sandbox was deleted at once and ran no session. |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: every process of the user ended, the user and its home removed, `/opt/squeal-w27` and the user's `/tmp` entries removed, and the work folder deleted, streams and transcripts included (17:52Z). No uid-1002 file and no process left; the VM's load was 0.08. |

### Per group

Round 5's counts are in brackets. "Both sides" counts sessions that got a result on both sides for the files they compared. "Still running" counts sessions in which an `--at` call returned at its wait with work still running. "Joined" counts sessions with a later `--wait` that joined that work. "Past 120 s" counts sessions with a tool call of 120 s or longer; in brackets after it, the sessions in which Claude Code moved a call to the background.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (10) | 10 [10] | 10 [10]: 11 unchanged files and the new file | full 0 [0]; partial, right 10 [10] (s1-04, s1-10 with one wrong side fact); honest 0 [0]; wrong 0 [0] | 6 [3] (6) | 5 (5; s1-09 half): the 97 browser files "still running" in the working tree | 0 | 0 (0) [10 (0)] | 0 [0] | 10 of 10: the commit daemon (stopped by the harness); e2e server and lease watcher in the clone; 9 also a lease watcher of the removed commit worktree | 109 s (85 to 113) [287 s] | $0.61 [$0.74] |
| s2 Squeal, empty store (10) | 10 [10] | 10 [3]: `open.test.ts` (9), 3 `test/store` files (5), 143 files (s2-09) | full 0 [0]; partial, right 10 [3] (s2-02, s2-08, s2-10 overstate one sentence); honest 0 [7]; wrong 0 [0] | 7 [10] (7) | 10 (8): about 1,330 per side | 3 | 4 (0) [10 (8)] | 0 [0] | 10 of 10: the commit daemon with about 1,200 to 1,330 files queued (stopped by the harness); no process | 263 s (121 to 709) [796 s] | $0.58 [$1.04] |

Per session: `tasks/023-44/data/judgements.tsv` and `data/<id>/`. Each holds the timeline, summary, the Squeal calls with their full output in `squeal-results.txt`, the clone's state after `squeal stop`, `commit-left.txt` and `leftover.txt`.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `.github/scripts/no-compat-policy.test.cjs: not comparable (needs .agents/skills/auto-merge/SKILL.md) -> no result` (and `lint-runner.test.ts`, needs `.agents/skills/check-code-quality/…`) | s1: 9 of 10 | Repeated it: "need files that are missing from the parent checkout". The text is wrong. At `d8abcfe46`, `.agents/skills/auto-merge` is a tracked symlink (mode 120000) to `../../.ai/skills/auto-merge`, and `.ai/skills/auto-merge/SKILL.md` is present (V1). |
| `squeal: --run: 1338 test files … queued in its commit daemon, up to 11 at once: about 3 min` (s2-06) to `about 11 min` (s2-02, s2-04) `at this machine's rate` | s2: 10 of 10 | 9 final answers quote the minutes as the time to a full answer. At the measured rate the parent side needs about an hour or more (V2). |
| `35 still running at a5c9b7223 (its worktree), 0 in the working tree`, after `HEAD~1 test/store --run --wait 100000` to `300000` | s2-03, 04, 05, 06, 10 | Read right as "the parent side is still running". 4 then narrowed to one file, which answered in 1 to 2 s; s2-10 joined it with `--wait` instead. The folder's files did not run ahead of the earlier queue at the parent (V3). |
| `--wait: joined 1338 test files … 90 have a result now; 1248 still running`, for `status --at HEAD~1 test/store --wait` | s2-05, s2-10 (with `open.test.ts`) | Read the whole queue's count as the folder's state. The report does not say how many of the named files are still running (V4). |
| `1338 still running at a5c9b7223 (its worktree), 1330 in the working tree; their runs go on in the daemons` | s2-06, s2-02 | s2-06: "a full comparison would have queued about 1,338 runs" (they were queued). s2-02: "too slow, so I stopped it", then "may still be going". The other 8 read it right. |
| `0 still running at d8abcfe46 (its worktree), 97 in the working tree`, beside `97 not run: the batch's setup failed (browser …)` at the parent | s1-05, 07, 08, 09, 10 | 4 read it as the browser files still queued, which is true. s1-09: "more results may come in", for files whose setup had already failed on the other side (V6). |
| `0 pass -> fail, 0 fail -> pass, 1 unchanged, 0 unknown` (a call narrowed to `open.test.ts`) | s2-08, s2-10 | "so no test file changed result" (s2-08); "No test file changed its result in commit 20f03a431" as the lead (s2-10). Both qualified it later. The summary line does not say it covers 1 named file out of 1,338 selected (V8). |

Read right this time: the HEAD refusal (13 of 13); `124 test files not selected: none of their inputs differs …, so this commit cannot change their result` (10 of 10 s1, T2); R3's setup-failure line (10 of 10 s1); a flip under load (s2-09: "a 5000 ms timeout at load 9 … I haven't retried it, so that is a judgement"); `group-pending-release.test.ts` failing for a missing release tag (4 s2 sessions named it as the clone's state).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| V1 | **Inputs under a tracked symlink read as missing at a commit.** In s1, 2 selected files are "not comparable (needs .agents/skills/…/SKILL.md)" at `d8abcfe46`, and they have no result in the working tree either. At that commit `.agents/skills/auto-merge` is a tracked directory symlink to `.ai/skills/auto-merge`, whose `SKILL.md` exists. 9 of 10 agents repeated the claim. Round 5 reported the same 2 files as "not stored (read paths first seen during the run)". | When Squeal reads a path at a commit from git objects, resolve tracked symlinks inside the tree, as the working tree does, before it decides that a path is missing. Test it on a fixture with a directory symlink, both at a commit and in the working tree. |
| V2 | **The time estimate is 5 to 15 times too low.** It said "about 3 to 11 min, up to 11 at once" for 1,338 files. Measured: 90 parent results after about 320 s (s2-05), 157 after about 394 s (s2-10), 144 after about 700 s (s2-09), with up to 3 sessions at once. Each session's commit daemon and worktree daemon ran about 1,330 files each, from the same user's pool of 11 permits. 9 answers quoted the estimate. | Base the estimate on both sides' runs (here about 2,670) and on the share of the pool that the user's other daemons leave, or on this call's measured rate. Say "both sides: 1,338 at a5c9b7223 and 1,330 here; about N min". |
| V3 | **Named folders do not lead at the commit side.** After `--at HEAD~1 test/store --run`, the working-tree side had 38 of 38 results. The commit side had 0 or 1 of its 35 to 36 after 98 to 298 s, in 5 of 5 sessions. A single named file finished in 2 to 95 s. | Make every file a call names lead the commit daemon's queue, including files that an earlier call already queued, and test it with a folder of several files behind a queue of 1,000 or more. If a running batch cannot yield, say so in the report, as round 5's `--wait` did ("the tier does not yield"). |
| V4 | **A narrowed `--wait` reports the whole queue.** `status --at HEAD~1 test/store --wait` printed "joined 1338 … 90 have a result now; 1248 still running". | Count the named files first ("test/store: 35 of 36 still running at a5c9b7223"), and give the rest of the queue on its own line. |
| V5 | **A wide `--run` leaves about an hour of work on two daemons.** In each s2 session, after the call returned, the commit daemon and the user's worktree daemon each had about 1,200 to 1,330 files left, for a 7-line change. With 3 sessions the VM load reached 19.5 on 12 CPUs. "Finish everything" is the human's decision (D7.3). | Keep the decision, and state the cost before it is paid: the first call's line names both sides' runs and V2's honest time, and it suggests narrowing first. Whether to run the wide selection at all after a narrowed answer stays the human's question. |
| V6 | **"Still running" for a group whose setup already failed.** The parent side says "97 not run: the batch's setup failed (browser …)", while the working-tree side says "97 in the working tree" are still running. | When one side's batch setup failed for a group in this call, name that next to the other side's count: "97 queued in the working tree (the browser group's setup failed at d8abcfe46)". |
| V7 | **T3 is still open, and the commit worktree adds a case.** In 10 of 10 s1 sessions, squawk's e2e server and lease watcher outlived the session in the clone. In 9 of 10, a lease watcher whose command line names the commit worktree outlived `squeal stop --at`, which removed that worktree. Its working folder is a deleted `/tmp` folder, so D6's working-folder rule does not find it. | T3's proposal: record the process group of each run a daemon starts, the commit daemon's runs included, and end it when the run ends or the daemon stops. Name what was ended. |
| V8 | **A narrowed summary line reads as the whole answer.** In 2 sessions, `0 pass -> fail, 0 fail -> pass, 1 unchanged, 0 unknown` for 1 named file became "no test file changed". | In a narrowed call, say what the counts cover: "of 1 named test file; the change selects 1,338 (`--at HEAD~1` without paths covers them)". |

Not product defects, recorded for the coordinator:

- **No Chrome on the VM**, as in rounds 4 and 5. The 97 browser files could not run on either side.
- **The sessions share one OS user**, so `squeal ps` and the load the agents saw included other sessions' daemons, as in rounds 4 and 5.
- **`/tmp` collects squawk's e2e folders**: 123 entries after 20 sessions (round 5: 170 after 21 runs).
- **The s2 clone has no release tags.** `test/cli/group-pending-release.test.ts` failed in the working tree in 4 sessions, and each named the missing tag.
- **No session ran `proof`.** The prompts ask a before/after question. Squeal suggested `proof` for the new s1 test file, and 8 answers named it as a next step. D7's `proof` side needs its own prompt.

### Open for a later round

- After V2 and V3: s2 again, 10 sessions. The question is whether a narrowed folder then gets both sides within the call, and whether the agents give the wide run's real cost.
- After V1: s1 again. The 2 symlink files should then compare, and the answer stops at the 1,669 files whose runner cannot tell their closure.
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- s1 on a host with Chrome and a model credential (a boat.dev sandbox once the account has a Claude credential).
- Codex, Pi and OpenCode are still not exercised.

## Round 7 (023-56)

Row 023-56, wave 29, worker 3f40e946, 2026-11-22 22:41Z to 23:38Z, on the lab VM, which the human allowed for this round ("Lab VM", 2026-11-22). Squeal 0.1.599 as released (tag `squeal--v0.1.599` at `8ec19a127`, hub entry `7e42195`). It carries row 023-47 (rewritten reads keyed, RECORDER_VERSION 7) and wave 28: V1 (paths under a tracked symlink held at the commit), V2 (an estimate per side from the measured rate or stored durations), V3 (named folders lead the commit queue), V4 (narrowed counts first), V6 (a failed setup named beside the other side) and V8 (a narrowed summary names its scope). Claude Code 2.1.327, `--model sonnet`, prompts exactly as round 6, no hint. The brief is `tasks/wave-29.md`; scripts, per-session data and judgements are in `tasks/023-56/`.

### Verdict

- **Still no full answer, and still no wrong one.** 0 of 20 sessions answered the whole question. 18 gave a partial answer that was right for the files they compared (round 6: 20). 2 said honestly that they could not tell yet (round 6: 0), and 0 were wrong. 10 of the 18 partial answers carry one wrong, stale or overstated sentence (round 6: 5).
- **V1 is fixed.** No s1 session printed "not comparable" (round 6: 10 of 10 printed it, and 9 repeated it). The two files under the tracked symlink now run and compare like any other: `no-compat-policy.test.cjs` passes at the parent in s1-04, and `lint-runner.test.ts` is unchanged in s1-05 and s1-10.
- **s1 (squawk): the selection can now be compared in full.** The change selects 13 unit files, the new test file and 97 browser files. 6 of 10 sessions got all 13 unit files on both sides, all unchanged (round 6: at most 11, because 2 were "not comparable"). The sessions stopped short of a full answer for two reasons only, and every one named both:
  - 97 browser files cannot run on the VM, which has no Chrome.
  - 1,669 + 16 files have no result at the parent, and their runner cannot tell whether the static closure is complete.
- **V3 works for folders.** After `--at <parent> <folder> --run`, the commit side answered within the call: the lint folder got 9 to 10 files in 17 to 37 s in 6 s1 sessions, and `test/store` got 35 files in 46 s in s2-05 (round 6: 0 or 1 of 35 after 98 to 298 s).
- **s2 lost 2 answers to a new case (W3).** In 6 of 10 sessions, the one named file `test/store/open.test.ts` was still running at the commit after the narrowed call's wait. It sat in the commit daemon's first batch of about 65 files, so its result came only when that batch ended, about 250 to 420 s after the first call. Meanwhile Squeal said "about 2 to 6 s for 1 test file". In s2-01 and s2-03 the result never came inside the session, and both answered "cannot tell yet". In the other sessions the narrowed call answered in 9 to 20 s (s2-02, 04, 07), or a folder call in 46 s (s2-05).
- **V2 is half fixed.**
  - Right: estimates from stored durations or from the call's own rate. At s1's commit side, "about 17 to 22 s for 2 to 10 files" matched the 9 to 10 results measured in 19 to 37 s.
  - Wrong: s2's first call guesses from 1 stored duration and puts every other file at that median: "about 4 to 11 min for 1,338 files" in 7 sessions. Measured, about 65 commit results came in 4 to 7 min, so the 1,338 files need about 1.5 to 2.5 hours.
  - Wrong: s1's working-tree estimate counts the 97 browser files whose setup had already failed at the parent: "about 14 to 35 min". The 13 unit files actually had both sides within about 200 s.
  - 8 answers quoted an estimate. Only s2-04's "about 4 hours" (from the measured rate) and s2-05's "about 80 minutes" were of the right size.
- **V4, V6 and V8 were read right.**
  - V4: "`test/store/open.test.ts`: 1 of 1 still running at a5c9b7223" with "The rest of the queue, outside these paths: 1337 more" was read right in every session that saw it (6 with the first line, 10 with the second).
  - V8: no narrowed summary was read as the whole answer (round 6: 2). Every narrowed answer said its scope ("for the one test file", "complete for the lint tests").
  - V6: "(97 of them in a batch whose setup failed at d8abcfe46)" appeared in 7 s1 sessions, and no agent waited for those 97 files.
- **New text problems:**
  - W2: 4 s1 sessions reported files as "still running" that their later narrowed call already counted as unchanged. The report counts unchanged files but does not name them.
  - W1: in s1-04, the working-tree side dropped the 13 unit files when the first call's wait ended ("13 without a result: group tests: not asked: the call's wait ended"). A later `--run` did not queue them again, and the agent then read the sides reversed.
- **Time:** s1 median 138 s (round 6: 109 s), s2 median 294 s (round 6: 263 s), longest 440 s. Sessions now join or narrow more often: 12 joined with a later `--wait` (round 6: 3). No session reached the 1,200 s limit.
- **What sessions leave behind:**
  - Every commit daemon outlived `squeal stop` and was stopped by the harness with `squeal stop --at HEAD~1`. The s2 commit daemons had about 1,070 to 1,330 files pending (V5, by design, unchanged).
  - squawk's e2e server and its lease watcher outlived 9 of 10 s1 sessions (T3). A lease watcher of the removed commit worktree outlived 4 of 10 (V7; round 6: 9 of 10).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 22:41Z the 1-minute load was 0.00, no other user job ran and no throwaway user from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 3.34 to 12.01, and the 15-minute load reached 14.2 at 23:34Z, all of it from the throwaway user's daemons. |
| Isolation | Throwaway OS user `squeal-w29`, case root `~squeal-w29/runs/w29`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 6. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.599:install.sh`, `SQUEAL_VERSION=0.1.599`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `7e42195` ("squeal 0.1.599"). `squeal --version` and `claude plugin list` printed 0.1.599. |
| Harness | Round 6's scripts with the changes in `tasks/023-56/notes.md`: names, and the time estimates each `--at` call printed collected per session. The `dryat` check ran first with no model. |
| Repositories | As round 6: squawk at `8be977ad6` (s1), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (147 s), then s1-02..10 and s2-01..10 interleaved, 3 at once. |
| Cost | 20 sessions, $1.23 (s1 $0.66, s2 $0.58). |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: every process of the user ended, the user and its home removed, `/opt/squeal-w29` and the user's 100 `/tmp` entries removed, and the work folder deleted, streams and transcripts included (23:38Z). No uid-1002 file and no process left; the VM's load was 0.21. |

### Per group

Round 6's counts are in brackets. Columns as round 6. "Both sides" counts sessions that got a result on both sides for at least one compared file.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (10) | 10 [10] | 9 [10]: all 13 unit files and the new file in 6 (s1-01, 02, 05, 08, 09, 10); 9 to 10 in s1-03 and s1-06; 4 in s1-07; s1-04 none (W1) | full 0 [0]; partial, right 10 [10] (s1-01, 05, 08, 09 with one stale "still running" fact; s1-03, s1-04 with one wrong fact; s1-10 with one overstatement); honest 0 [0]; wrong 0 [0] | 2 [6] (2) | 10 (9; s1-04 read the sides reversed) [5 (5)] | 4 [0] | 0 (0) [0 (0)] | 0 [0] | 10 of 10: the commit daemon, idle (stopped by the harness); 9 the e2e server and lease watcher in the clone; 4 also a lease watcher of the removed commit worktree | 138 s (110 to 211) [109 s] | $0.66 [$0.61] |
| s2 Squeal, empty store (10) | 10 [10] | 8 [10]: `open.test.ts` (7), 38 `test/store` files (s2-05) | full 0 [0]; partial, right 8 [10] (s2-04, s2-05, s2-10 with one wrong or unsupported sentence); honest 2 [0] (s2-01, s2-03: W3); wrong 0 [0] | 9 [7] (9) | 10 (10) [10 (8)] | 8 [3] | 2 (1) [4 (0)] | 0 [0] | 10 of 10: the commit daemon with its queue unfinished (stopped by the harness); no process | 294 s (120 to 440) [263 s] | $0.58 [$0.58] |

Per session: `tasks/023-56/data/judgements.tsv` (with a column per fix: V1, V2, V3, V4/V8, V6) and `data/<id>/`.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `Still to run, at a5c9b7223: about 4 min` (to `11 min`) `for 1338 test files, … a guess: 1 of them have a stored duration, the others count at their median`; in s1, `in the working tree: about 35 min for 106 test files` | s2-02, 06, 07, 10; s1-01, s1-07 | Quoted the minutes as the time to a full answer: "It should take about 6 minutes" (s2-10). At s2's commit side the measured rate gives about 1.5 to 2.5 hours. In s1, 97 of the files counted are in a group whose setup had failed at the parent (V2's rest). |
| `test/store/open.test.ts: 1 of 1 still running at a5c9b7223, none queued in the working tree` with `about 3 s for 1 test file, up to 1 at once, from their stored durations` | s2-01, 03, 06, 08, 09, 10 | Read right as "still running", and joined. The result came 250 to 420 s after the first call, when the batch the file was in ended; in s2-01 and s2-03 it did not come before the session ended (W3). |
| The narrowed call's `9 unchanged … of 29 named test files`, after an earlier call that listed `lint-ast-grep-1.test.ts: pass -> no result (running)` | s1-01, 05, 08, 09 | Reported the earlier "still running" files as unresolved, while the narrowed count included them. s1-09 filtered the output with `grep`. The report counts unchanged files without naming them (W2). |
| `13 test files: pass -> no result (at d8abcfe46: run in the commit's worktree)` after `now: 13 without a result: group tests: not asked: the call's wait ended` | s1-04 | Read the sides reversed: "They pass at 8be977ad6, but the parent run hadn't produced a result". The working-tree side had dropped them, and a later `--run` queued only the 97 browser files (W1). |
| `1669 test files: no result at d8abcfe46, not selected by the change, and its runner does not tell whether the static closure is complete` | s1-03, s1-10 | "can't be affected by this commit, because their inputs are identical" (s1-03); "Squeal judged the commit couldn't affect them" (s1-10, for the 19 such lint files). The text says the opposite: Squeal cannot tell. 8 sessions read it right. |
| A bare `squeal status --at <parent> --wait`: `1809 test files: no result -> no result` and `13 unchanged, 1907 unknown` | s1-02, s1-04 | The 124 files that the first call reported as "not selected: … this commit cannot change their result" are counted as unknown here, without the T2 line (W5). Both agents kept the first call's 124. |
| The commit side runs the file as at the commit | s2-05 | "This comparison runs the current version of the file on both sides". Wrong; no Squeal text says it. |

Read right this time: the HEAD refusal (11 of 11 went on with the parent); the browser setup failure (10 of 10 s1 called it the environment); V4's narrowed count (6 of 6) and "The rest of the queue, outside these paths" (10 of 10); V8's "of 1 named test file; the change selects 1338" (no narrowed answer read as the whole); V6's "97 of them in a batch whose setup failed"; T2's "124 test files not selected: … this commit cannot change their result" (10 of 10 s1).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| W1 | **The working-tree side can drop its queue when the call's wait ends, and a later `--run` does not queue it again.** s1-04: `now: 13 without a result: group tests: not asked: the call's wait ended`. The later `--wait` joined only the 97 browser files in the working tree, and the third call's `--run` queued only those 97. The 13 unit files passed at the parent and never ran in the working tree, so the session compared nothing. 1 of 10 sessions; the others kept their working-tree queue. | Find why the tests group was "not asked" at the end of the wait (the D7 contract keeps the rest running). A later `--run` must queue every selected file that has no result on that side, whatever an earlier call left. Test: a call whose wait ends while the group is still to be asked, then `--run` again. |
| W2 | **A later call does not say which earlier "still running" files now have both sides.** 4 s1 sessions named `lint-ast-grep-1/2` or `ast-rules-owners`, `lint-runner` and `plugin` as still running, while the narrowed call's "9 unchanged" included them. | In a narrowed call, list each named file's state by name, unchanged ones included, up to a limit (for example 20). In a `--wait`, name the files that went from running to a result since the call that queued them. |
| W3 | **A named file that is already running in a batch at the commit waits for the whole batch, and the estimate says seconds.** In 6 of 10 s2 sessions, `open.test.ts` was still running in the commit daemon's first batch of about 65 files after the narrowed call's wait. Its result came about 250 to 420 s after the first call, or not within the session (s2-01, s2-03: "cannot tell yet"). Squeal said "about 2 to 6 s for 1 test file". In s2-02, 04 and 07 the narrowed call answered in 9 to 20 s. | When a named file is running inside a larger batch, either run it on its own beside that batch at once, or say so with that batch's time: "`open.test.ts` runs in a batch of 65 files started 98 s ago; its result comes when that batch ends (about N min)". |
| V2 (rest) | **A guess from one stored duration is 10 to 20 times too low, and the working-tree side counts a group whose setup failed.** s2's first call: "about 4 to 11 min for 1,338 files" in 7 sessions, from 1 stored duration. Measured: about 65 commit results in 4 to 7 min, about 1.5 to 2.5 hours for all of them. s1: "about 14 to 35 min" in the working tree, for 97 browser files whose setup had already failed at the parent. 8 answers quoted an estimate; 6 of them were far off. | When less than a small share of the files has a stored duration (for example under 5 %) and the call measured no rate, say "time unknown" instead of a guess. Leave out, or name apart, the files of a group whose setup failed on the other side in this call. |
| W5 | **A bare `--wait` drops the "not selected" count.** After `--at <parent> --run`, the following `--at <parent> --wait` printed `1809 test files: no result -> no result` and `13 unchanged, 1907 unknown`, without the T2 line for the 124 files whose inputs are equal at both commits (s1-02, s1-04). | Give `--wait` the same categories as the call it joins: the T2 line and `124 not selected` in the summary. |
| V5, V7 | **Unchanged.** Each s2 commit daemon still has about 1,100 to 1,300 files pending when the session ends. squawk's e2e server and lease watcher outlived 9 of 10 s1 sessions, and the commit worktree's lease watcher outlived 4 of 10. | As round 6 proposed (V5's cost line; T3/V7's process-group stop). |

Not product defects, recorded for the coordinator:

- **No Chrome on the VM**, as in rounds 4 to 6. The 97 browser files could not run on either side.
- **The sessions share one OS user**, so `squeal ps`, the pending counts and the load the agents saw include other sessions' daemons.
- **`/tmp` collects squawk's e2e folders**: 100 entries after 21 runs (round 6: 123 after 20).
- **No session ran `proof`.** 10 answers mention it, as a next step or as not run, for the new or changed test file.

### Open for a later round

- After W3 and V2's rest: s2 again, 10 sessions. The question is whether the one named file then gets both sides within the call, and whether the agents give the wide run's real cost.
- After W1 and W2: s1 again. Every session should then reach all 13 unit files on both sides and name them right.
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- s1 on a host with Chrome and a model credential.
- Codex, Pi and OpenCode are still not exercised.

## Round 8 (023-63)

Row 023-63, wave 31, worker 98937582, 2026-11-23 12:59Z to 14:01Z, on the lab VM, which the human allowed for this round (2026-11-23). Squeal 0.1.609 as released (tag `squeal--v0.1.609` at `dc6384520`, hub entry `1cb3f8f`). It carries wave 30: W1 (a later `--run` queues every selected file still missing on a side), W2 (a narrowed call names each named file's state, up to 20), W3 (a named file inside a longer running Vitest batch at the commit is cut out and run on its own), W5 (`--wait` keeps the "not selected" count and the T2 line) and V2's rest ("time unknown: too few runs stored"; files of a group whose setup failed on the other side are left out of the estimate). Claude Code 2.1.327, `--model sonnet`, prompts exactly as round 7, no hint. New this round: a working Chrome for the throwaway user, so squawk's 97 browser files could run. The brief is `tasks/wave-31.md`; scripts, per-session data and judgements are in `tasks/023-63/`.

### Verdict

- **Still no full answer, and still no wrong one.** 0 of 20 sessions answered the whole question. 19 gave a partial answer that was right for the files they compared (round 7: 18). 1 said honestly that it could not tell yet (round 7: 2), and 0 were wrong. 5 of the 19 partial answers carry one wrong or undercounted sentence (round 7: 10). Apart from those, 6 s1 answers quoted a time that is far too short (below, V2).
- **W1, W2 and W5 are fixed.**
  - W1: no working-tree queue was dropped ("not asked: the call's wait ended" appears in no session). 9 of 10 s1 sessions got all 13 unit files on both sides, all unchanged (round 7: 6). The tenth, s1-09, lost 2 files to a new case (X1, below).
  - W2: no agent reported a file as still running after a later call had both sides for it (round 7: 4). The narrowed call names each file, and `--wait` names the files that went "from running to a result".
  - W5: all 3 bare `--wait` calls (s1-02, s1-03, s1-07) kept the T2 line and "124 not selected" (round 7: 0 of 2).
- **W3 is half fixed.** `test/store/open.test.ts` got its commit result inside the call that asked for it in 7 of 10 s2 sessions (round 7: 4), 98 to 192 s after the first call (median 141 s; round 7: 250 to 420 s when it waited). In the other 3 (s2-01, 03, 05) it was not cut out. Squeal said instead: "its result waits for the batch that holds it; test/store/open.test.ts runs in a batch of 200 test files started 3 min ago; its result comes when that batch ends (time unknown …)". s2-01 and s2-03 got it later with `--wait`, 285 and 241 s after the first call. s2-05 ended without it and answered "I can't say whether open.test.ts passed before".
- **V2's rest is fixed for the empty store, but a new estimate is wrong.**
  - Right: every s2 first call now says "1338 test files, time unknown: too few runs stored (1 of them have a stored duration) and this call measured no rate" (round 7: "about 4 to 11 min" in 7 sessions). No s2 answer quoted a wrong time. s2-09 quoted "roughly 3 hours" from the working tree's measured rate, which is the right size. s2-03 said "no time estimate from Squeal".
  - Wrong: in s1 the first call measured "14 results in 98 s", nearly all of them unit files. It then put the 96 browser files at that rate: "about 11 min for 96 test files" (8 sessions; up to 17 min). Measured, the browser files ran one at a time at 30 to 135 s each. The best side got 15 results in about 550 s, so 96 files take an hour or more per side. 6 answers quoted 11 to 17 minutes.
  - Not tested: the failed-setup exclusion, since no browser setup failed this round.
- **The browser files run now, but none got both sides.** With an AppArmor profile for the user's Chrome (`tasks/023-63/notes.md`), the browser group's setup no longer fails, and both daemons queued the 96 browser files. By each session's last call the commit side had 1 to 8 browser results and the working tree 0 to 15. No browser file had a result on both sides, because the two daemons ran them in different orders and too slowly for a 1,200 s session. 4 files failed at file level on either side with `agent-browser set viewport 1440 900 failed`. The 3 agents that saw it (s1-02, 03, 07) called it the environment, not the commit, and did not claim a change.
- **New text problems:**
  - X1: in s1-09, `lint-ast-grep-1/2` were still running at the commit when the agent narrowed to the lint folder with `--run`. They then ran on their own in 20 s and came back "not comparable (needs .ai/ast-grep/rules/)". That is round 6's symlink text, which V1 fixed for the commit daemon's own batches. The agent repeated it: "need `.ai/ast-grep/rules/`, which isn't present at the parent". 1 session; the other 9 had those files done before they narrowed.
  - X2: the hook after the first call says "browser: 97 test files; 97 pending, waiting for `squeal run browser`. Squeal runs them only on request", while that same call's `--run` had already queued them in the same daemon. All 10 s1 sessions got it; s1-06 repeated it: "The 319 run-loop files and 97 browser files haven't run at all, because Squeal only runs them on request".
- **Time:** s1 median 140 s (round 7: 138 s), s2 median 196 s (round 7: 294 s), longest 666 s (s1-02, which waited for the browser files). No session reached the 1,200 s limit. 7 sessions joined with a later `--wait` (round 7: 12); more s2 sessions now narrowed to the `test/store` folder and got their answer in that call.
- **What sessions leave behind:**
  - Every commit daemon outlived `squeal stop` and was stopped by the harness with `squeal stop --at HEAD~1`. Each s2 commit daemon had about 1,070 to 1,240 files pending (V5, by design, unchanged).
  - squawk's e2e server and its lease watcher outlived 10 of 10 s1 sessions (round 7: 9). A lease watcher of the removed commit worktree outlived 7 of 10 (round 7: 4) (T3, V7).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 12:59Z the 1-minute load was 0.00, no other user job ran and no throwaway user from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 4.21 to 11.97; it reached 19.7 at 13:47Z, all of it from the throwaway user's daemons, e2e servers and browsers. |
| Isolation | Throwaway OS user `squeal-w31`, case root `~squeal-w31/runs/w31`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 7. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.609:install.sh`, `SQUEAL_VERSION=0.1.609`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `1cb3f8f` ("squeal 0.1.609"). `claude plugin list` printed 0.1.609. |
| Browser | squawk's own e2e environment downloaded `agent-browser` 0.39.4 and Chrome for Testing 158.0.8127.36 into the user's home. One AppArmor profile let only that Chrome path use user namespaces, which Ubuntu 24.04 blocks by default. No OS package was added. A browser run as the user passed 4 of 5 files before s1 (`tasks/023-63/data/browser-proof.txt`). |
| Harness | Round 7's scripts with the changes in `tasks/023-63/notes.md`: names, the browser steps, and the W3, W5 and "time unknown" lines collected per session. The `dryat` check ran first with no model. |
| Repositories | As round 7: squawk at `8be977ad6` (s1), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (166 s), then s1-02..10 and s2-01..10 interleaved, 3 at once, 13:18Z to 14:00Z. |
| Cost | 20 sessions, $1.31 (s1 $0.78, s2 $0.53). |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: the AppArmor profile unloaded and deleted, the browser and `agent-browser` deleted, every process of the user ended, the user and its home removed, `/opt/squeal-w31` and the user's 96 `/tmp` entries removed, and the work folder deleted, streams and transcripts included (14:00Z). No uid-1002 file and no process left; the package list equal to the one before the round. |

### Per group

Round 7's counts are in brackets. Columns as round 7. "Both sides" counts sessions that got a result on both sides for at least one compared file.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (10) | 10 [10] | 10 [9]: all 13 unit files and the new file in 9 (all but s1-09); 11 of 13 in s1-09 (X1); no browser file in any | full 0 [0]; partial, right 10 [10] (s1-04, 06, 08, 09 with one wrong or undercounted sentence; s1-01, 04, 05, 06, 08, 09 quoted 11 to 17 min); honest 0 [0]; wrong 0 [0] | 9 [2] (9) | 10 (10) [10 (9)] | 5 [4] | 2 (0) [0 (0)] | 0 [0] | 10 of 10: the commit daemon, idle on browser files (stopped by the harness); the e2e server and lease watcher in the clone; 7 also a lease watcher of the removed commit worktree | 140 s (116 to 666) [138 s] | $0.78 [$0.66] |
| s2 Squeal, empty store (10) | 10 [10] | 9 [8]: `open.test.ts` (5), 38 `test/store` files (4) | full 0 [0]; partial, right 9 [8] (s2-10 with one wrong sentence); honest 1 [2] (s2-05: W3 not cut out); wrong 0 [0] | 6 [9] (6) | 10 (10) [10 (10)] | 2 [8] | 0 (0) [2 (1)] | 0 [0] | 10 of 10: the commit daemon with its queue unfinished (stopped by the harness); no process | 196 s (117 to 296) [294 s] | $0.53 [$0.58] |

Per session: `tasks/023-63/data/judgements.tsv` (with a column per fix: W1, W2, W3, W5, V2, and the browser results per side) and `data/<id>/`.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `Still to run, at d8abcfe46: about 11 min for 96 test files, at this call's rate there (14 results in 98 s)` (up to `about 17 min for 101 test files` in the working tree) | s1-01, 04, 05, 06, 08, 09 | Quoted 11 to 17 minutes as the time to a full answer: "It needs roughly 11 more minutes at the observed rate" (s1-04). The rate came from unit files; the 96 left are browser files that take an hour or more per side (V2, new). |
| `2 more test files: not comparable (needs .ai/ast-grep/rules/) -> pass`, after a narrowed `--run` ran `lint-ast-grep-1/2` on their own at the commit | s1-09 | "`lint-ast-grep-1.test.ts` and `lint-ast-grep-2.test.ts` need `.ai/ast-grep/rules/`, which isn't present at the parent." The folder is there through a tracked symlink (X1). |
| The hook: `browser: 97 test files; 97 pending, waiting for squeal run browser. Squeal runs them only on request` | s1-06 (all 10 s1 got it) | "The 319 run-loop files and 97 browser files haven't run at all, because Squeal only runs them on request", beside "About 96 e2e files … were still queued or running". The first call's `--run` had queued the 97 (X2). |
| `test/store/open.test.ts: 1 of 1 still running at a5c9b7223` with `its result waits for the batch that holds it; … a batch of 200 test files started 2 min ago; … (time unknown …)` | s2-01, 03, 05 | Read right. s2-01 and s2-03 joined with `--wait` and got it 80 and 18 s later. s2-05 stopped and answered "can't say whether open.test.ts passed before" (W3 not cut out). |
| The narrowed call's per-file lines, cut by the agent's own `tail -25` or `tail -30` | s1-04, s1-08 | Counted only the named lines: "the six files that ran on both commits" (s1-08; the call counted 10 unchanged), "nine lint test files, which are the ones Squeal selected" (s1-04; the first call had counted 4 more unit files unchanged, unnamed). |
| `test/store/open.test.ts: pass -> pass (at a5c9b7223: run in the commit's worktree; …)` | s2-10 | "Its pass at a5c9b7223 comes from a run of the current test file's code against the parent's source, not from the old test file." Wrong: the commit's worktree runs the old file. s2-01 said it right. Round 7's s2-05 made the same misread. |

Read right this time: the HEAD refusal (15 of 15 went on with the parent); "time unknown" (no agent made up a time from it); W2's named per-file lines and "went from running to a result" (no stale "still running"); W5's T2 line in `--wait`; V8's "of N named test files; the change selects …" (no narrowed answer read as the whole); "The rest of the queue, outside these paths"; T2's "124 test files not selected" (10 of 10 s1); the browser file-level failures read as the environment (3 of 3).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| X1 | **A named file that runs on its own at the commit loses the symlink hold.** s1-09: `lint-ast-grep-1/2` were running in the commit daemon's batch when the agent ran `--at HEAD~1 packages/cezar/src/lint --run`. The call queued them again ("queued 2 test files … 2 have a result now (20.2 s)"), and both came back "not comparable (needs .ai/ast-grep/rules/)". In the other 9 sessions the same 2 files ran in the commit daemon's batch and compared as unchanged. | Give the run that W3 cuts out (and any other single-file run at the commit) the same symlink hold as the batch (V1). Test: a named file under a tracked symlink, still running in a batch at the commit, then a narrowed `--run`; it must compare. |
| W3 (rest) | **The cut-out does not happen when the batch's time is unknown.** s2-01, 03, 05: "its result waits for the batch that holds it; test/store/open.test.ts runs in a batch of 200 test files started 3 min ago; its result comes when that batch ends (time unknown: too few runs stored (21 of its 200 files have a stored duration) …)". s2-05 ended without the result. In the other 7 sessions the commit result came within the call. | Cut the named file out also when the batch's remaining time is unknown, at least when the batch holds many files (for example more than 20), since an empty store is the common case. |
| V2 (new) | **The call's rate is applied across groups.** s1: "about 11 min for 96 test files, at this call's rate there (14 results in 98 s)". The 14 were unit files; the 96 left are browser files that run one at a time at 30 to 135 s each. 6 answers quoted 11 to 17 minutes; the best side got 15 browser results in about 550 s. | Measure the rate per group, and give a group with no rate of its own "time unknown", or its stored durations. |
| X2 | **The hook says a group waits for `squeal run` after `--at --run` queued it.** All 10 s1 sessions got "browser: 97 test files; 97 pending, waiting for `squeal run browser`. Squeal runs them only on request" after their first call had queued the 97 in the same daemon. s1-06 repeated it as fact. | When a request-only group has files queued by an `--at --run`, say so in the hook: "browser: 97 queued by `squeal status --at … --run`". |
| X3 | **The two sides run a group in different orders.** In s1-03 the commit side had `activity`, `artifact-project-links` and `automations-github`; the working tree had `agent-browser-tabs`, `chat-code-fence`, `command-palette` and 5 more. No browser file had both sides in any session, though the two sides had up to 8 and 15 results. | When both daemons run the files a change selects, run them in the same order on both sides, so each file gets both sides as early as possible. |
| V5, T3/V7 | **Unchanged.** Each s2 commit daemon still has about 1,070 to 1,240 files pending when the session ends. squawk's e2e server and lease watcher outlived 10 of 10 s1 sessions, and the commit worktree's lease watcher outlived 7 of 10. | As round 6 proposed (V5's cost line; T3/V7's process-group stop). |

Not product defects, recorded for the coordinator:

- **squawk's browser files are slow and run one at a time** (`fileParallelism: false`): 30 to 135 s each, so 96 files take an hour or more per side. No 1,200 s session can compare them, whatever Squeal does.
- **4 browser files fail at file level on this VM** with `agent-browser set viewport 1440 900 failed`, on either side. It is the environment under load.
- **The sessions share one OS user**, so `squeal ps`, the pending counts and the load the agents saw include other sessions' daemons and browsers.
- **No session ran `proof`.** 13 answers mention it, as a next step or as not run, for the new or changed test file.

### Open for a later round

- After X1 and W3's rest: s2 again, and s1 with a prompt that makes the agent narrow early. The question is whether every named file then gets both sides within the call.
- After the per-group rate (V2) and X3: s1 with a longer limit (for example 3,600 s) or a prompt that names one browser file, to see whether the browser files compare on both sides.
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- Codex, Pi and OpenCode are still not exercised.

## Round 9 (023-69)

Row 023-69, wave 33, worker 2da4d6fd, 2026-11-23 17:23Z to 18:17Z, on the lab VM, which the human allowed for this round (2026-11-23). Squeal 0.1.610 as released (tag `squeal--v0.1.610` at `adf64bc94`, hub entry `7b44459`). It carries wave 32: 023-64 (a folder read holds at the commit when its names on disk equal the commit's listing), 023-65 (a named file is cut out of a batch of unknown time when more than 20 unfinished files lie outside the call), 023-66 (the call's measured rate counts per group), 023-67 (a request-only group's files that a run request queued read as queued) and 023-68 (both sides start a request's files in one order). Claude Code 2.1.327, `--model sonnet`. s1 and s2 used round 8's prompts exactly. New this round: s1b, round 8's s1 prompt plus "Include `packages/web/e2e/thread-scroll.e2e.ts` in the comparison." The brief is `tasks/wave-33.md`; scripts, per-session data and judgements are in `tasks/023-69/`.

### Verdict

- **No wrong answer, and the named browser file got both sides in 1 of 5 sessions.** 0 of 20 sessions answered the whole question; the 96 other browser files cannot run in 1,200 s. 19 gave a partial answer that was right for the files they compared (round 8: 19). 1 said honestly that it could not tell yet (s1b-04; round 8: 1). 0 were wrong. 6 of the 19 partial answers carry one wrong, undercounted or overstated sentence (round 8: 5).
- **023-64, 023-65 and 023-66 are fixed.**
  - 023-64: no session printed "not comparable" (round 8: 1, X1). `lint-ast-grep-1/2` compared pass -> pass wherever they were named, and in s1b-01 the folder call held 28 lint files at the commit ("run in this worktree" on both sides), so 28 compared instead of 9.
  - 023-65: `test/store/open.test.ts` got its commit result inside the call that named it in 10 of 10 s2 sessions (round 8: 7), in calls of 5 to 54 s and 107 to 156 s after the first call (median about 112 s; round 8: 98 to 192 s, and 3 sessions without it). No s2 call printed "waits for the batch that holds it".
  - 023-66: every s1 and s1b first call now gives the browser group its own "time unknown", for example "95 test files, time unknown: none has a stored duration and this call measured no rate for the browser group (2 of its 15 results there in 98 s were that group's)" (round 8: "about 11 min for 96 test files" in 8 sessions). No answer took a browser time from the unit files' rate. s2-08 quoted "about 2.3 hours" from the working tree's measured rate, which is the right size.
- **The named browser file at the commit (s1b): fixed for the working tree, not for the commit side.** The working tree got `thread-scroll.e2e.ts` within 278 to 331 s of the first call in 5 of 5 sessions. The commit side got it in s1b-01 only, inside the narrowed call (both sides by 374 s). In the other 4, Squeal said "`thread-scroll.e2e.ts`: 1 of 1 still running at d8abcfe46" with "about 2 min for 1 test file" for 300 to 930 s, while the per-file line said "no result (queued)" at d8abcfe46 and the commit daemon ran no test process. The shared worker pool was full ("pool 11 of 11 permits" in s1b-04), held by other sessions' commit daemons. s1b-04 named only the 2 files, so its commit daemon had 1 file queued and nothing else, and it did not start it in 930 s (Y1, below).
- **023-67 is mostly fixed.** The hook no longer says the browser group waits for `squeal run` after `--run` queued it: 8 sessions got "97 pending, waiting for capacity … Squeal runs them now" or "running <file> since …". s1-01 got "95 queued by a request …, 2 pending, waiting for `squeal run browser`", while its call had queued all 97 (Y2). No agent repeated that browser files run only on request (round 8: 1).
- **023-68 is not visible.** No browser file other than the named one got both sides. In 9 of 9 sessions that queued all browser files, the commit side ran `activity.e2e.ts` first, and then `agent-browser-tabs`. The working tree left `activity.e2e.ts` queued and ran `agent-browser-tabs` or `agents-dock` (Y2).
- **New text problem (Y1):** "1 of 1 still running" counts a queued file as running. All 4 s1b agents that did not get the commit result read it as running: "The parent-commit run is still going in Squeal's daemon" (s1b-04), and "about 97 s left" (s1b-03).
- **Time:** s1 median 128 s (round 8: 140 s), s1b median 464 s (385 to 942), s2 median 123 s (round 8: 196 s), longest 942 s. No session reached the 1,200 s limit. s2 sessions now narrow and get their answer in the second call. s1b sessions joined with up to 4 more `--wait` calls of 100 to 300 s.
- **What sessions leave behind:**
  - Every commit daemon outlived `squeal stop` and was stopped by the harness with `squeal stop --at HEAD~1`. Each s2 commit daemon had about 920 to 1,310 files pending (V5, by design, unchanged). The s1b commit daemons had 1 to 95 browser files pending and no test process.
  - squawk's e2e server and its lease watcher outlived 9 of 10 s1 and s1b sessions (round 8: 10 of 10). A lease watcher of the removed commit worktree outlived 8 of 10 (round 8: 7 of 10) (T3, V7).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 17:23Z the 1-minute load was 0.00, no other user job ran and no throwaway user or AppArmor profile from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 3.74 to 14.05; `squeal ps` saw 19.1 at 18:09Z, all of it from the throwaway user's daemons, e2e servers and browsers. |
| Isolation | Throwaway OS user `squeal-w33`, case root `~squeal-w33/runs/w33`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 8. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.610:install.sh`, `SQUEAL_VERSION=0.1.610`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `7b44459` ("squeal 0.1.610"). `squeal --version` and `claude plugin list` printed 0.1.610. |
| Browser | As round 8: squawk's own e2e environment downloaded `agent-browser` and Chrome for Testing into the user's home, and one AppArmor profile let only that Chrome path use user namespaces. No OS package was added (877 before and after). `pnpm run test:e2e thread-scroll.e2e.ts` as the user passed 18 of 18 tests in 91 s before s1 (`tasks/023-69/data/browser-proof.txt`). |
| s1b's file | `thread-scroll.e2e.ts`: the median (93 s) of the 5 browser files whose single-file times round 8's browser proof recorded (30 to 135 s), and not one of the 4 files that fail at file level on this VM. Details in `tasks/023-69/notes.md`. |
| Harness | Round 8's scripts with the changes in `tasks/023-69/notes.md`: names, the s1b group, the browser proof filtered to one file, and the 023-64 to 023-67 lines collected per session. The `dryat` check ran first with no model. |
| Repositories | As round 8: squawk at `8be977ad6` (s1, s1b), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (125 s), then s1b, s2 and s1 interleaved, 3 at once, 17:33Z to 18:11Z. |
| Cost | 20 sessions, $1.34 (s1 $0.38, s1b $0.43, s2 $0.53). |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: the AppArmor profile unloaded and deleted, the browser and `agent-browser` deleted, every process of the user ended, the user and its home removed, `/opt/squeal-w33` and the user's `/tmp` entries removed, and the work folder deleted, streams and transcripts included (18:17Z). No uid-1002 file and no process left; the package list equal to the one before the round; the VM's load 0.04. |

### Per group

Round 8's counts are in brackets (s1b is new). Columns as round 8. "Both sides" counts sessions that got a result on both sides for at least one compared file.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (5) | 5 [10] | 5 [10]: 13 unit files counted unchanged in one call in s1-04 and s1-05; in s1-01, 02, 03 the first call counted 3 to 7 and the lint call 9 to 10 named; no browser file | full 0 [0]; partial, right 5 [10] (s1-03 with one undercount); honest 0 [0]; wrong 0 [0] | 4 [9] (4) | 5 (5) [10 (10)] | 0 [5] | 0 (0) [2 (0)] | 0 [0] | 5 of 5: the commit daemon (stopped by the harness); 4 the e2e server and lease watchers | 128 s (109 to 149) [140 s] | $0.38 [$0.78] |
| s1b squawk, one browser file named (5) | 5 (s1b-04 with its 2 named files only) | 4: all 13 unit files in 3 (s1b-01, 03, 05); 7 + 3 named in s1b-02; `thread-scroll` in s1b-01 only; s1b-04 none (it named 2 files, neither with a parent result) | full 0; partial, right 4 (s1b-01 compared the named file; s1b-01, 02, 05 with one wrong, unsupported or overstated sentence); honest 1 (s1b-04: Y1); wrong 0 | 3 (3), 5 calls | 5 (5, as printed; the text was wrong: Y1) | 4 | 12 calls in 5 (0) | 0 | 5 of 5: the commit daemon with 1 to 95 browser files pending and no test process (stopped by the harness); 5 the e2e server and lease watcher; 4 also a lease watcher of the removed commit worktree | 464 s (385 to 942) | $0.43 |
| s2 Squeal, empty store (10) | 10 [10] | 10 [9]: `open.test.ts` (6), 38 `test/store` files (3), `open.test.ts` and 6 files that import `mark.ts` (s2-08) | full 0 [0]; partial, right 10 [9] (s2-05, s2-07 with one wrong sentence); honest 0 [1]; wrong 0 [0] | 7 [6] (7) | 10 (10) [10 (10)] | 1 [2] | 0 (0) [0 (0)] | 0 [0] | 10 of 10: the commit daemon with its queue unfinished (stopped by the harness); no process | 123 s (117 to 308) [196 s] | $0.53 [$0.53] |

Per session: `tasks/023-69/data/judgements.tsv` (with a column per fix: 023-64 to 023-68) and `data/<id>/`.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `packages/web/e2e/thread-scroll.e2e.ts: 1 of 1 still running at d8abcfe46, none queued in the working tree` with `Still to run, at d8abcfe46: about 2 min for 1 test file, up to 1 at once, from their stored durations, times 1.22 for the host's load per CPU`, while the per-file line said `no result (queued) -> pass` | s1b-02, 03, 04, 05 | Read as running: "The parent-commit run is still going in Squeal's daemon" (s1b-04), "the parent run was still going when I stopped waiting (about 97 s left)" (s1b-03). The file had not started at the commit; the estimate stayed at 2 to 3 min for up to 930 s (Y1). |
| `browser: 97 test files; 95 queued by a request (…), 2 pending, waiting for `squeal run browser`` after the first call's `--run` queued all 97 in the working tree | s1-01 (seen, not repeated) | No agent repeated it. The 2 files match the 2 that "have a stored duration" in the working tree's estimate (Y2). |
| `test/store/open.test.ts: pass -> pass (at a5c9b7223: run in the commit's worktree; …)` | s2-05, s2-07 | "The new tests in open.test.ts passing at both commits means the new assertions don't fail at the parent" (s2-05; the parent side ran the old file, without them). "the file-level result can't show whether they pass" (s2-07; the file passes after the commit, so they pass). s2-01 said it right: "Squeal ran the parent's version of the file … The new tests … did not exist at the parent." Rounds 7 and 8 had one such misread each. |
| `124 test files not selected: … (the 16 … and the 1669 … excepted)` | s1b-01 | "The other 1,669 files … Of those, 124 files have inputs identical at both commits". The 124 are apart from the 1,669. The 4 other answers that named the 124 read it right. |

Read right this time: the HEAD refusal (14 sessions, 16 calls; all went on with the parent); "time unknown … no rate for the browser group" (no agent made up a browser time); 023-65's commit result inside the narrowed call (10 of 10); the folder call's per-file lines and "of N named test files; the change selects 110" (no narrowed answer read as the whole); "The rest of the queue, outside these paths"; "went from running to a result in the working tree" (s1b-03, s1b-05); the browser file-level failures read as the environment (s1b-02, 03, 05).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| Y1 | **A named file at the commit waits for a worker-pool permit, and Squeal calls it "still running" with a 2-minute estimate.** In s1b-02 to 05, the narrowed `--at HEAD~1 thread-scroll.e2e.ts --run` queued the file at the commit, and later calls said "1 of 1 still running at d8abcfe46" and "about 2 min" (also "about 3 min", "about 102 s", "about 97 s") for 300 to 930 s. The per-file line in the same output said `no result (queued)` at d8abcfe46. After s1b-04 (930 s), its commit daemon had "1 pending" and no test process, while `squeal ps` showed "pool 11 of 11 permits" held by other sessions' daemons, among them an s2 commit daemon's 200-file batch. s1b-01, which ran while the host was quiet, got the commit result in 148 s. The other sessions share one OS user, so in part this is the harness; but many worktrees on one machine is how users run (several agents at once), so the same wait occurs there. | (a) Count a queued file as queued, not running: "1 of 1 queued at d8abcfe46, waiting for a worker-pool permit (11 of 11 held, by 3 other daemons)". (b) Give a file that an `--at … <path> --run` names the same claim on the pool as a working-tree request, ahead of other daemons' background batches. (c) While a file waits for a permit, its estimate says "time unknown: waiting for capacity", not its stored duration. Test: fill the pool from another daemon, then a narrowed `--at --run` on one file; the call says queued and the file starts at the next free permit. |
| Y2 | **The working tree leaves the files the commit side ran first unqueued, so the two sides diverge from the first browser file.** In 9 of 9 sessions that queued all browser files, the commit side ran `activity.e2e.ts` (and then `agent-browser-tabs`) first; the working tree left `activity.e2e.ts` "queued" and ran `agent-browser-tabs` or `agents-dock`. In s1-01 the hook said "95 queued by a request …, 2 pending, waiting for `squeal run browser`", and the working tree's estimate said "2 of them have a stored duration". The 2 seem to be the files whose durations the commit daemon had stored in the shared store before the working tree took the request. This is a hypothesis from the counts; the data does not name the 2 files. | Check whether a file with a stored duration (from the commit daemon) is left out of the working tree's request set or put last. A request queues every file it names on both sides, in one order, whatever the store holds. Test: store a duration for one browser file from the commit side, then `--at --run`; both sides list it as requested and start it in the same position. |
| Y3 | **The commit-side run of a changed test file is still misread** (2 of 10 s2; rounds 7 and 8: 1 each). | When the named test file differs between the commit and the working tree, say it in the per-file line: "(at a5c9b7223: the file as it was at a5c9b7223, without this commit's changes to it)". |
| V5, T3/V7 | **Unchanged.** Each s2 commit daemon still has about 920 to 1,310 files pending when the session ends. squawk's e2e server and lease watcher outlived 9 of 10 s1 and s1b sessions, and the commit worktree's lease watcher outlived 8 of 10. | As round 6 proposed (V5's cost line; T3/V7's process-group stop). |

Not product defects, recorded for the coordinator:

- **squawk's browser files run one at a time**, about 90 to 130 s each on this VM, so the 96 not named cannot compare in 1,200 s, whatever Squeal does. A named file can: s1b-01 compared it in 374 s.
- **The sessions share one OS user**, so `squeal ps`, the worker pool, the pending counts and the load the agents saw include other sessions' daemons and browsers. Y1 depends on that.
- **No session ran `proof`.** 11 answers mention it, as a next step or as not run, for the new or changed test file.

### Open for a later round

- After Y1 and Y2: s1b again, 5 sessions, and 2 of them with another session's commit daemon busy. The question is whether the named browser file then gets both sides within the call.
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- Codex, Pi and OpenCode are still not exercised.

## Round 10 (023-75)

Row 023-75, wave 35, worker 9f960d34, 2026-11-23 21:56Z to 22:45Z, on the lab VM, which the human allowed for this round (2026-11-23). Squeal 0.1.611 as released (tag `squeal--v0.1.611` at `7d2ce9ab7`, hub entry `5352468`). It carries wave 34: 023-70 (a result of a folder-reading test counts at the commit only when the commit worktree wrote it), 023-72 with 023-74 (a narrow run request follows its file across a re-key instead of being dropped), 023-71 (a named file not started reads "queued", with a reason only when the daemon publishes one, and no time until it starts) and 023-73 (a changed test file's line says it ran as it was at the commit). Claude Code 2.1.327, `--model sonnet`. s1, s1b and s2 used round 9's prompts byte-equal. The brief is `tasks/wave-35.md`; scripts, per-session data and judgements are in `tasks/023-75/`.

### Verdict

- **No wrong answer, and the named browser file got both sides in 4 of 5 sessions (round 9: 1 of 5).** 0 of 20 sessions answered the whole question; the other 96 browser files cannot run in 1,200 s. 19 gave a partial answer that was right for the files they compared (round 9: 19). 1 said honestly that it could not tell yet (s1b-05; round 9: 1). 0 were wrong. 4 of the 19 partial answers carry one overstated, unsupported or undercounted sentence (round 9: 6).
- **023-71 is fixed.** No call said "still running" for a file that had not started (round 9: 4 of 5 s1b sessions, Y1). Every "1 of 1 still running at d8abcfe46" (s1b-01, 03, 04) matched a per-file row "no result (running)": the narrowed `--run` started the named file at the commit at once. A file waiting for the browser group's slot read "1 of 1 queued …, waiting for the browser group's slot" with "time unknown: waiting for capacity (the browser group's slot)" (the working tree in s1b-01, 03, 04; the commit side in s1b-05). That reason was true each time: the other side of the same clone held the slot. No call said it waited for the worker pool. No agent read a queued file as running.
- **The named file at the commit (s1b).** Its commit result came in s1b-01 to s1b-04, within 219 to 468 s of the first `--at` call (upper bounds; s1b-02 inside the narrowed call itself), and both sides by 343 to 476 s. In s1b-05 the working tree ran it first and the commit side waited for the shared slot; the agent stopped at 230 s and asked whether to keep waiting (Z1, below). Round 9: 1 of 5, by 374 s.
- **023-72 with 023-74 are mostly fixed.**
  - More browser files got both sides: `activity.e2e.ts` within the first call in 4 sessions (s1-03, s1-04, s1-05, s1b-03; counted from the unchanged totals, `tasks/023-75/notes.md`), and `agent-browser-tabs` and `agents-dock` too in s1-03's wide `--wait` (round 9: none apart from the named file). In the other 6 sessions the commit side ran `activity.e2e.ts` or `agent-browser-tabs` first and the working tree had not run it by the end of the first call; in s1-01 the working tree ran `agents-dock` instead (Z2).
  - The hook: 9 of 10 s1 and s1b sessions got "97 pending, waiting for capacity …" or "running packages/web/e2e/activity.e2e.ts". s1-02 got "96 queued by a request …, 1 pending, waiting for `squeal run browser`" while the call had queued all 97 in the working tree (round 9: s1-01, the same text). No agent repeated it (Z3).
- **023-73 is fixed.** All 10 s2 calls that compared `test/store/open.test.ts` said "(at a5c9b7223: the file as it was at a5c9b7223, without its changes since then; …)". 9 agents restated it right ("The 'before' side used the file as it was then, without the new tests", s2-04); s2-06 did not restate it and said nothing wrong. 0 misreads (round 9: 2 of 10).
- **023-70 costs nothing here.** No session printed "not comparable" (round 9: 0). `lint-ast-grep-1/2`, the two lint files that read a folder through a tracked symlink, compared pass -> pass "run in the commit's worktree" in all 7 sessions that narrowed to the lint folder (visible in 6; s1b-04's `tail` cut them from its 10 unchanged): the commit daemon ran both in its own worktree each time. A commit-side result that another worktree wrote appeared for 3 files (`parity-runner-subset.test.ts` in s1; `test/store/paths.test.ts` and `retry-while-busy.test.ts` in s2), and no folder read is in their sources.
- **Kept from round 9.** `test/store/open.test.ts` got its commit result inside the call that named it in 10 of 10 s2 sessions, 106 to 154 s after the first call (median 112 s; round 9: about 112 s). Every s1 and s1b first call gave the browser group "time unknown", and no agent made up a browser time. s1b-02's working-tree estimate "about 97 s for 1 test file" came true 117 s later.
- **Time:** s1 median 153 s (round 9: 128 s), s1b median 358 s (231 to 484; round 9: 464 s), s2 median 132 s (round 9: 123 s), longest 484 s. No session reached the 1,200 s limit.
- **What sessions leave behind:**
  - Every commit daemon outlived `squeal stop` and was stopped by the harness with `squeal stop --at HEAD~1`. Each s2 commit daemon had 1,084 to 1,305 files pending (V5, by design, unchanged); each s1 and s1b commit daemon had 93 to 96 browser files pending.
  - squawk's e2e server and its lease watcher outlived 10 of 10 s1 and s1b sessions (round 9: 9 of 10). A lease watcher of the removed commit worktree outlived 5 of 10 (round 9: 8 of 10) (T3, V7).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 21:56Z the 1-minute load was 0.00, no other user job ran and no throwaway user or AppArmor profile from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 4.63 to 11.68, all of it from the throwaway user's daemons, e2e servers and browsers. |
| Isolation | Throwaway OS user `squeal-w35`, case root `~squeal-w35/runs/w35`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 9. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.611:install.sh`, `SQUEAL_VERSION=0.1.611`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `5352468` ("squeal 0.1.611"). `squeal --version` and `claude plugin list` printed 0.1.611. |
| Browser | As rounds 8 and 9: squawk's own e2e environment downloaded `agent-browser` and Chrome for Testing into the user's home, and one AppArmor profile let only that Chrome path use user namespaces. No OS package was added (877 before and after). `pnpm run test:e2e thread-scroll.e2e.ts` as the user passed 18 of 18 tests in 97 s before s1 (`tasks/023-75/data/browser-proof.txt`). |
| s1b's file | `thread-scroll.e2e.ts`, as round 9. |
| Harness | Round 9's scripts with the changes in `tasks/023-75/notes.md`: names, versions, and the 023-71 and 023-73 lines collected per session (`lines10`). The `dryat` check ran first with no model. |
| Repositories | As round 9: squawk at `8be977ad6` (s1, s1b), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (153 s), then s1b, s2 and s1 interleaved in round 9's order, 3 at once, 22:04Z to 22:39Z. |
| Cost | 20 sessions, $1.26 (s1 $0.36, s1b $0.38, s2 $0.53). |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: the AppArmor profile unloaded and deleted, the browser and `agent-browser` deleted, every process of the user ended, the user and its home removed, `/opt/squeal-w35` and the user's 63 `/tmp` entries removed, and the work folder deleted, streams and transcripts included (22:45Z). No uid-1002 process left; the package list equal to the one before the round; the VM's load 0.02. |

### Per group

Round 9's counts are in brackets. Columns as round 9. "Both sides" counts sessions that got a result on both sides for at least one compared file.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (5) | 5 [5] | 5 [5]: lint folder call with 9 to 10 unchanged in s1-01, 02, 04, 05; 16 unchanged in one wide `--wait` in s1-03 (13 unit files and 3 browser files); `activity.e2e.ts` by count in s1-03, 04, 05 | full 0 [0]; partial, right 5 [5] (s1-01 with one overstated sentence, s1-05 with one unsupported); honest 0 [0]; wrong 0 [0] | 1 [4] (1) | 5 (5) [5 (5)] | 1 [0] | 0 (0) [0 (0)] | 0 [0] | 5 of 5: the commit daemon with 93 to 96 browser files pending (stopped by the harness); 5 the e2e server and lease watcher; 2 also a lease watcher of the removed commit worktree | 153 s (130 to 210) [128 s] | $0.36 [$0.38] |
| s1b squawk, one browser file named (5) | 5 [5] | 5 [4]: `thread-scroll` in 4 [1] (s1b-01 to 04); 9 lint files in s1b-01, 03, 04; s1b-05 3 unit files only | full 0 [0]; partial, right 4 [4] (all 4 compared the named file; s1b-03, 04 with one undercount); honest 1 [1] (s1b-05: stopped while the named file waited for the slot, Z1); wrong 0 [0] | 4 [3] (4), 7 calls [5] | 5 (5) [5 (5, the text was wrong)] | 3 [4] | 5 calls in 3 (0) [12 calls in 5 (0)] | 0 [0] | 5 of 5: the commit daemon with 93 to 95 browser files pending (stopped by the harness); 5 the e2e server and lease watcher; 3 also a lease watcher of the removed commit worktree | 358 s (231 to 484) [464 s] | $0.38 [$0.43] |
| s2 Squeal, empty store (10) | 10 [10] | 10 [10]: `open.test.ts` (6), 38 `test/store` files (4) | full 0 [0]; partial, right 10 [10] (none with a wrong sentence [2]); honest 0 [0]; wrong 0 [0] | 5 [7] (5) | 10 (10) [10 (10)] | 0 [1] | 0 (0) [0 (0)] | 0 [0] | 10 of 10: the commit daemon with 1,084 to 1,305 files pending (stopped by the harness); no process | 132 s (114 to 179) [123 s] | $0.53 [$0.53] |

Per session: `tasks/023-75/data/judgements.tsv` (with a column per fix: 023-70, 023-72/74, 023-71, 023-73) and `data/<id>/`.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `packages/web/e2e/thread-scroll.e2e.ts: 1 of 1 queued at d8abcfe46, waiting for the browser group's slot, 1 of 1 still running in the working tree` with `Still to run, at d8abcfe46: 1 test file, time unknown: waiting for capacity (the browser group's slot)` | s1b-05 | Read right ("still queued at the parent and running in the working tree"), then stopped at 230 s, 970 s before the limit: "Do you want me to keep waiting on it?" The slot holder was the working tree's run of the same file, which takes about 90 to 120 s (97 s in the proof; Squeal had no stored duration for it in this session) (Z1). |
| The hook: `browser: 97 test files; 96 queued by a request (…), 1 pending, waiting for `squeal run browser`` after the first call's `--run` queued all 97 in the working tree | s1-02 (seen, not repeated) | No agent repeated it. Same text as round 9's s1-01 (Z3). |
| The narrowed call's per-file lines, cut by the agent's own `tail -25` or `tail -30` | s1b-03, s1b-04 | Counted only the lines it saw: "Lint tests (7 files selected by the change)" (s1b-03; the call counted 9 lint files unchanged); "Only 7 to 8 of them had results when I stopped" (s1b-04; 10 unchanged and the new file). Round 8 had the same cut. |
| `94 test files: no result (queued) -> no result (queued)` beside `activity.e2e.ts: pass -> no result (queued) (at d8abcfe46: …)` and `agent-browser-tabs.e2e.ts: pass -> …` | s1-01 | "The 97 browser e2e files were still queued at both commits": 2 had passed at the parent. Overstated, not wrong about any change. |
| The narrowed lint call's `10 unchanged` with 6 named | s1-05 | "The other four are among the 7 selected files from the first, repo-wide comparison": unsupported. s1-02 said it right: "the other four weren't named in the output". |

Read right this time: "queued" and "still running" for the named file (no Y1); "waiting for the browser group's slot" and "time unknown: waiting for capacity"; 023-73's "the file as it was at a5c9b7223, without its changes since then" (9 of 10 restated it, 0 wrong); the HEAD refusal (10 sessions, 13 calls; all went on with the parent); "time unknown … for the browser group" (no agent made up a browser time); "of N named test files; the change selects 110" (no narrowed answer read as the whole); "The rest of the queue, outside these paths"; "went from running to a result" (s1b-01, 02, 04); "124 test files not selected" (no misread; round 9: 1).

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| Z1 | **A named file waiting for the slot that the other side's run of the same file holds gets no time.** s1b-05: at 226 s the commit side said "1 of 1 queued at d8abcfe46, waiting for the browser group's slot" and "time unknown: waiting for capacity (the browser group's slot)"; the working tree was running `thread-scroll.e2e.ts` (97 s in the proof; the call said it had no stored duration). The agent stopped and asked. In s1b-01, 03 and 04 the same wait sat on the working-tree side, and those agents joined with `--wait` and got both sides. The slot is one per repository, shared by the working tree and its commit worktree (`tasks/023-71-notes.md`), so the two sides of a browser file always run one after the other. | When a named file waits for a slot whose holder Squeal knows (a daemon of the same repository), say who holds it and since when: "waiting for the browser group's slot, which the working tree's run of thread-scroll.e2e.ts holds (running for 40 s); it starts when that run ends", with the holder's remaining time when it has a stored duration. This needs the slot to record its holder (today the publisher records none: 023-71's S1). Test: the working tree holds the slot with the named file; the commit side's narrowed call names the holder, and gives a time when the holder's file has a stored duration. |
| Z2 | **Both sides take the shared slot for different files first, so slot turns pass without a comparison.** In 6 of 10 s1 and s1b sessions the commit side ran `activity.e2e.ts` or `agent-browser-tabs` first, and the working tree had not run that file by the end of the first call (s1-01: it ran `agents-dock`). In the other 4, `activity.e2e.ts` got both sides within the first call; in s1-03 2 more files followed in the next 100 s. | When one `--at --run` request queues the same files on both sides of a shared slot, hand the slot over per file: the commit side's run of a file, then the working tree's run of the same file, then the next file, so every two slot turns give one compared file. Test: two daemons, one slot, three requested files; results arrive in pairs, in the request's order. |
| Z3 | **023-74's rest: one file left "waiting for `squeal run`".** s1-02's hook said "96 queued by a request …, 1 pending, waiting for `squeal run browser`" while the call said "97 queued in the working tree" (round 9: s1-01, same text). The data does not name the file. | When 1 to 3 files of a request-only group are pending outside a request, name them in the hook ("1 pending (activity.e2e.ts), waiting for …"), so the next round can find the cause; then fix it as 023-72. |
| V5, T3/V7 | **Unchanged.** Each s2 commit daemon still has 1,084 to 1,305 files pending when the session ends. squawk's e2e server and lease watcher outlived 10 of 10 s1 and s1b sessions, and the commit worktree's lease watcher 5 of 10. | As round 6 proposed (V5's cost line; T3/V7's process-group stop). |

Not product defects, recorded for the coordinator:

- **squawk's browser files run one at a time** (`maxParallel: 1`, one slot for both sides), about 90 to 130 s each on this VM, so the 96 not named cannot compare in 1,200 s, whatever Squeal does. A named file now compares in about 6 minutes.
- **The sessions share one OS user**, so `squeal ps`, the worker pool, the pending counts and the load the agents saw include other sessions' daemons and browsers. No call this round said it waited for the pool.
- **No session ran `proof`.** 6 answers mention it, as not run, for the new test file in s1 and s1b.

### Open for a later round

- After Z1 and Z2: s1b again, 5 sessions. The question is whether every agent waits for the named file once the call gives a time, and whether the browser files the two sides run first get both sides.
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- Codex, Pi and OpenCode are still not exercised.

## Round 11 (023-80)

Row 023-80, wave 37, worker 82295aab, 2026-11-24 08:10Z to 09:02Z, on the lab VM, which the human allowed for this round (2026-11-24). Squeal 0.1.614 as released (tag `squeal--v0.1.614` at `cbb83128c`, hub entry `8966745`). It carries wave 36 (released as 0.1.612 content): 023-76 (a listed folder's key covers every name on disk, ignored included; a folder-reading result still counts at the commit only when the commit worktree wrote it), 023-78 (the side that takes the free shared slot leads; the other side next runs the file the leader last ran, when its request holds it), 023-77 (a file waiting for the slot names its holder) and 023-79 (the hook names 1 to 3 files a held group keeps outside a request). Claude Code 2.1.327, `--model sonnet`. s1, s1b and s2 used round 10's prompts byte-equal. New in the harness: a copy of each clone's store after the session gives both sides' runs in order (`tasks/023-80/data/<id>/runs.txt`). The brief is `tasks/wave-37.md`; scripts, per-session data and judgements are in `tasks/023-80/`.

### Verdict

- **No wrong answer, and the named browser file got both sides in 4 of 5 sessions (round 10: 4 of 5).** 0 of 20 sessions answered the whole question; the other 96 browser files cannot run in 1,200 s. 19 gave a partial answer that was right for the files they compared (round 10: 19). 1 said honestly that it could not tell yet (s1b-01; round 10: 1). 0 were wrong. 3 of the 19 partial answers carry one wrong, overstated or loose sentence (round 10: 4).
- **023-77 works: the holder line was true in 5 of 5 s1b sessions, and 4 agents waited.** Each s1b call that narrowed to `thread-scroll.e2e.ts` said "1 of 1 queued at d8abcfe46, waiting for the browser group's slot, which the working tree's run of packages/web/e2e/thread-scroll.e2e.ts holds (running for 1 min 1 s); it can start after that run ends". The holder and its running time matched the store within 2 s each time. No line gave a time left: in a fresh clone the file has no stored duration. s1b-02 to s1b-05 waited with `--wait` and got pass -> pass. s1b-01 read the line right, stopped at 214 s and offered to keep waiting. The working tree's run ended at 220 s (round 10's Z1, now with the holder named, AA3).
- **The named file at the commit (s1b).** Its commit result came 359 to 526 s after the first `--at` call (s1b-02 ≤ 388 s, s1b-03 526 s, s1b-04 359 s, s1b-05 368 s; round 10: 219 to 468 s). The working tree ran it first in 5 of 5, in 74 to 135 s; the commit side then ran it in 108 to 159 s. In s1b-03 the commit side ran it twice (243 to 377 s, then 407 to 533 s), because the first run's key had moved (AA1, AA4).
- **023-78: the follow rule held, but the first pair came after the first call.** In all 6 s1 and s1b sessions whose working tree's first browser file was not a named file, that file was the one the commit side had just run (`activity` in s1-01, `agents-dock` in s1-02, `agent-browser-tabs` in s1-03, 04, 05 and s1b-02). In the 8 sessions with a wide `--run`, the commit side's first browser run started at 56 to 84 s, the working tree's at 94 to 178 s, and the commit side took the slot 1 to 3 times in a row first (2 or more in 7 of 8). So the first compared browser file finished at 118 to 214 s, after the first call (about 104 s). No s1 call showed a browser file on both sides (round 10: `activity.e2e.ts` in the first call of 3 s1 sessions by count). By each session's end, the store shows 1 to 2 browser files with both sides in s1 and 1 to 3 in s1b; 0 in s1b-01 (AA2).
- **023-79 found Z3's cause.** The hook named the one leftover file twice: "1 pending (packages/web/e2e/activity.e2e.ts)" in s1-01 at 104 s and "1 pending (packages/web/e2e/agent-browser-tabs.e2e.ts)" in s1-03 at 106 s. Each was the working tree's first browser run, started 10 and 8 s before and still running. Its key had moved during the run, so the request held the old key. In s1-01 the working tree ran the file again at 124 s. No agent repeated the line.
- **023-76: no "not comparable", and every lint folder file compared.** `lint-ast-grep-1/2` read pass -> pass "run in the commit's worktree" in every call that showed them (s1-01, s1-04, s1-05, s1b-01; in s1-02, s1-03 and s1b-03 the agent's `tail` or the wide call's grouping hid them in the unchanged count). The commit side ran them first in 8 of 8 sessions that ran them (at 56 to 99 s against 73 to 100 s). No session printed "not comparable" (round 10: 0).
- **023-81's cost is paid in every session, with no restart and no edit (AA1).** No session restarted a daemon or edited a file. Still, tests that list a folder ran a second time 8 to 42 s after their first run on the same side:
  - s1 and s1b: on the commit side `lint-ast-grep-1/2` in 8 of 8 sessions that ran them, on the working-tree side 4 to 6 lint files in 8 of 8.
  - s2: 4 `test/ci` export files on the working-tree side in 10 of 10, 10 to 20 s after their first run.
  - Browser files: one browser file in 4 of 10 s1 and s1b sessions (`activity` in the working tree in s1-01, `agents-dock` at the commit in s1-02, `agent-browser-tabs` in the working tree in s1-04, the named `thread-scroll` at the commit in s1b-03, +126 s).
  - What the agents saw: the first call of all 8 sessions read some lint files that had already passed once as "running" or "queued". Agents then made a second lint call; s1b-02 never compared its 7 lint files, and s1-03 swapped the two sides when it described them.
- **Kept from round 10.** 023-73's "the file as it was at a5c9b7223, without its changes since then" appeared in 10 of 10 s2 sessions, and all 10 agents restated it right. `test/store/open.test.ts` got its commit result inside the call that named it in 10 of 10, 109 to 177 s after the first call (median 114 s; round 10: 112 s). Every s1 and s1b first call gave the browser group "time unknown", and no agent made up a browser time. Once the working tree's run of the named file stored a duration, the commit side's calls gave a time ("about 3 min for 1 test file … runs on its own (about 93 s)", s1b-03, 04, 05).
- **Time:** s1 median 161 s (127 to 214; round 10: 153 s), s1b median 384 s (214 to 541; round 10: 358 s), s2 median 125 s (119 to 253; round 10: 132 s). No session reached the 1,200 s limit.
- **What sessions leave behind:**
  - Every commit daemon outlived `squeal stop` and was stopped by the harness with `squeal stop --at HEAD~1` (20 of 20; V5, by design, unchanged).
  - squawk's e2e server and its lease watcher outlived 10 of 10 s1 and s1b sessions (round 10: 10 of 10). A lease watcher of the removed commit worktree outlived 5 of 10 (round 10: 5 of 10) (T3, V7).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 08:10Z the 1-minute load was 0.02, no other user job ran, and no throwaway user or AppArmor profile from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 1.75 to 11.91, all of it from the throwaway user's daemons, e2e servers and browsers. |
| Isolation | Throwaway OS user `squeal-w37`, case root `~squeal-w37/runs/w37`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 10. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.614:install.sh`, `SQUEAL_VERSION=0.1.614`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `8966745` ("squeal 0.1.614"). `squeal --version` and `claude plugin list` printed 0.1.614. |
| Browser | As rounds 8 to 10: squawk's own e2e environment downloaded `agent-browser` and Chrome for Testing into the user's home, and one AppArmor profile let only that Chrome path use user namespaces. No OS package was added (877 before and after). `pnpm run test:e2e thread-scroll.e2e.ts` as the user passed 18 of 18 tests in 92 s before s1 (`tasks/023-80/data/browser-proof.txt`). |
| s1b's file | `thread-scroll.e2e.ts`, as rounds 9 and 10. |
| Harness | Round 10's scripts with the changes in `tasks/023-80/notes.md`: names, versions, the store's runs per session (`runs.mjs`) and the round 11 lines (`lines11`, `hooks11`). The `dryat` check ran first with no model. |
| Repositories | As round 10: squawk at `8be977ad6` (s1, s1b), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (144 s), then s1b, s2 and s1 interleaved in round 10's order, 3 at once, 08:21Z to 08:57Z. |
| Cost | 20 sessions, $1.30 (s1 $0.36, s1b $0.40, s2 $0.53). |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: the AppArmor profile unloaded and deleted, the browser and `agent-browser` deleted, every process of the user ended, the user and its home removed, `/opt/squeal-w37` and the user's `/tmp` entries removed, and the work folder deleted, streams and transcripts included (09:02Z). No uid-1002 process or file left; the package list equal to the one before the round; the VM's load 0.25. |

### Per group

Round 10's counts are in brackets. Columns as round 10. "Both sides" counts sessions that got a result on both sides, in the agent's own calls, for at least one compared file.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (5) | 5 [5] | 5 [5]: lint folder call with 9 to 11 unchanged in s1-01, 03, 04, 05; 13 unchanged in one wide `--wait` in s1-02; no browser file in any call [3 by count] | full 0 [0]; partial, right 5 [5] (s1-02 with one overstated sentence, s1-03 with one sentence that swaps the sides); honest 0 [0]; wrong 0 [0] | 2 [1] (2) | 5 (4) [5 (5)] | 2 [1] | 0 (0) [0 (0)] | 0 [0] | 5 of 5: the commit daemon (stopped by the harness); 5 the e2e server and lease watcher; 3 also a lease watcher of the removed commit worktree | 161 s (127 to 214) [153 s] | $0.36 [$0.36] |
| s1b squawk, one browser file named (5) | 5 [5] | 5 [5]: `thread-scroll` in 4 [4] (s1b-02 to 05); 28 lint files in s1b-01, 9 in s1b-03 | full 0 [0]; partial, right 4 [4] (all 4 compared the named file; s1b-05 with one loose sentence); honest 1 [1] (s1b-01: stopped while the named file waited for the slot, AA3); wrong 0 [0] | 3 [4] (3), 4 calls [7] | 5 (5) [5 (5)] | 4 [3] | 5 calls in 4 (0) [5 calls in 3 (0)] | 0 [0] | 5 of 5: the commit daemon (stopped by the harness); 5 the e2e server and lease watcher; 2 also a lease watcher of the removed commit worktree | 384 s (214 to 541) [358 s] | $0.40 [$0.38] |
| s2 Squeal, empty store (10) | 10 [10] | 10 [10]: `open.test.ts` (7), 38 `test/store` files (3, s2-03 also 6 more files that import `store/mark`) | full 0 [0]; partial, right 10 [10] (none with a wrong sentence [0]); honest 0 [0]; wrong 0 [0] | 9 [5] (9) | 10 (10) [10 (10)] | 0 [0] | 0 (0) [0 (0)] | 0 [0] | 10 of 10: the commit daemon (stopped by the harness); no process | 125 s (119 to 253) [132 s] | $0.53 [$0.53] |

Per session: `tasks/023-80/data/judgements.tsv` (with a column per fix: 023-76, 023-78, 023-77, 023-79, 023-81) and `data/<id>/`, with `runs.txt` for each side's runs in order.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `thread-scroll.e2e.ts: 1 of 1 queued at d8abcfe46, waiting for the browser group's slot, which the working tree's run of packages/web/e2e/thread-scroll.e2e.ts holds (running for 1 min 1 s)` with `Still to run, at d8abcfe46: 1 test file, time unknown: … it can start after that run ends` | s1b-01 | Read right ("the run at the parent is queued behind it. The two share one slot"), then stopped at 214 s, about 6 s before the working tree's run ended: "I can keep waiting on it if you want." The line gave no time: the file had no stored duration (AA3). |
| `thread-scroll.e2e.ts: 1 of 1 queued at d8abcfe46, waiting for the browser group's run of packages/web/e2e/thread-scroll.e2e.ts to end` with `Still to run …: not started, …; … runs on its own (about 2 min)` | s1b-03 (acted on: waited) | True as written, but the run it waited for was the commit side's own run of the same file, started at 243 s at a key the request no longer held. Its result did not count, and the file ran again from 407 s. The agent waited 4 more minutes and could not see why (AA1, AA4). |
| The first call's `6 test files: pass -> no result (running) (at d8abcfe46: run in the commit's worktree)` while the working tree re-ran files it had already run once | s1-03 | "The 6 files the change selects … passed in the working tree. In the parent's checkout they were still running or queued": the sides are swapped. Its own second call had counted them pass -> pass in "9 unchanged" (AA1). |
| `7 test files: pass -> no result (running)` at the end of the first call (the working tree's second run of the lint files) | s1b-02 | Read right ("their runs … were still going when I last checked, so I have no verdict yet"), and never asked again: 7 lint files not compared (AA1). |
| `94 test files: no result (queued) -> no result (queued)` beside 3 browser files with a parent result | s1-02 | "About 97 browser e2e specs … have no result yet at either commit", after naming the 3 with a parent result. Overstated, as round 10's s1-01. |

Read right this time: the slot-holder line (5 of 5 read it right, 4 acted on it); 023-73's "the file as it was at a5c9b7223" (10 of 10 restated it); the HEAD refusal (14 sessions, 15 calls; all went on with the parent); "time unknown … for the browser group" (no agent made up a browser time); "of N named test files; the change selects 110" (no narrowed answer read as the whole); "The rest of the queue, outside these paths"; "went from running to a result"; "124 test files not selected".

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| AA1 | **A test that lists a folder runs again right after its first run, in one daemon, with no edit and no restart.** The store copies show it in every session: the commit side's `lint-ast-grep-1/2` 25 to 42 s after their first run (8 of 8 sessions that ran them), 4 to 6 working-tree lint files 8 to 30 s after (8 of 8), 4 `test/ci` files in s2's working tree 10 to 20 s after (10 of 10), and one browser file in 4 of 10 s1 and s1b sessions. The worst: s1b-03's commit side ran the named `thread-scroll.e2e.ts` twice (134 s, then 126 s), so the agent waited 540 s. The same moves explain 023-79's two leftover lines (the key moved while the working tree's first run of the file ran) and the first calls' "running" lint files (8 of 8). 023-76 puts every name on disk in a listed folder's key; its notes expect such a move once, "at the next daemon start", and say that within one daemon `ran` covers the folder's only reader. Here several tests read the same folders, and the move came within the daemon. Round 10 had no store copy, so these data cannot show whether 0.1.611 re-ran the same files. | Row 023-81, widened: a name that appears in a listed folder while a run of one of its readers is going (ignored, not there when the key was made) must not move the key of the result that run writes, nor the keys of the folder's other readers whose results came from the same revision. The run's own writes must not make it run again. First a probe: on one commit worktree, record the names on disk of each folder `lint-ast-grep-1/2` and `thread-scroll.e2e.ts` list, before and after their first run, to name the files the runs write. Test: two tests list one folder; the first run writes an ignored name there; no second run follows, and `status --at` reads pass -> pass, with no "running", at the call's end. |
| AA2 | **The follow rule pairs the leader's latest file, and the leader runs 2 to 3 files before the other side asks for the slot.** In the 8 sessions with a wide `--run`, the commit side's first browser run started 56 to 84 s into the session, the working tree's 94 to 178 s. The working tree then followed the commit side's latest file (6 of 6), so the commit side's first file (`activity.e2e.ts`) got its pair at 136 to 272 s in s1-02, s1-04, s1-05 and s1b-02, and not within s1-03, and no s1 call showed a browser file on both sides (round 10: 3 sessions in the first call, by count). After the first pair, the sides still did not alternate: the working tree took 2 to 4 turns in a row in s1-01, s1-04, s1-05 and s1b-02 (in s1b-02 that delayed the named file at the commit by 15 s). The hook said in 5 of 10 sessions that the working tree's browser files were "waiting for capacity (whether the browser group's slot or the shared worker pool holds it is not known)", so the data cannot tell whether the working tree waited for the slot or for the pool, which 3 sessions under one OS user share. | Two changes. (1) The follower takes the leader's earliest file that its own request holds and has not run, not the latest, so pairs arrive in the request's order and the first file the leader ran is the first compared. (2) Record and publish what a lane waits for, slot or pool, so that the call and the next round can tell them apart (the hook's "not known" in 5 of 10 sessions). Test: as 023-78's late-partner case, with the partner arriving after the leader ran a and b: the partner runs a, then b. |
| AA3 | **The holder line gives no time in a fresh clone.** In 5 of 5 s1b sessions the line said "running for N s" and no time left, because the named file had no stored duration. 4 agents waited; s1b-01 stopped about 6 s before the holder's run ended. Once the working tree's run stored a duration, the commit side's calls gave a time ("about 3 min … runs on its own (about 93 s)"). | No product change yet. Next round, run s1b once with a store that already holds one run of the named file, so the line's "about N s left" path is used, and see whether every agent waits. |
| AA4 | **A named file queued behind its own side's stale run does not say that run will not count.** s1b-03 at 312 s: "1 of 1 queued at d8abcfe46, waiting for the browser group's run of packages/web/e2e/thread-scroll.e2e.ts to end" and "not started", while the commit side's run of the same file, at a key the request no longer held, ran from 243 s. | When the run a named file waits for is the same file's run at an older key on the same side, say so: "the commit worktree's run of thread-scroll.e2e.ts started before its inputs changed; its result will not count; the file runs again after it (about N s)". Test: a run at key K; the key moves to K′ during the run; the narrowed call reads that line. AA1 removes most of the cases. |
| V5, T3/V7 | **Unchanged.** Each commit daemon outlived `squeal stop` (20 of 20). squawk's e2e server and lease watcher outlived 10 of 10 s1 and s1b sessions, and the commit worktree's lease watcher 5 of 10. | As round 6 proposed (V5's cost line; T3/V7's process-group stop). |

Not product defects, recorded for the coordinator:

- **squawk's browser files run one at a time** (one slot for both sides), 74 to 159 s each for `thread-scroll.e2e.ts` under the round's load, so the 96 not named cannot compare in 1,200 s, whatever Squeal does.
- **The sessions share one OS user**, so `squeal ps`, the worker pool, the pending counts and the load the agents saw include other sessions' daemons and browsers. With 3 sessions at once, up to 6 daemons share one pool.
- **No session ran `proof`.** 12 answers mention it, as not run, for the new test file in s1 and s1b or for `open.test.ts` in s2.

### Open for a later round

- After AA1: s1 and s1b again, 5 sessions each. The question is whether folder-listing tests run once per side, whether the first call shows the lint files pass -> pass, and whether the named file's commit result comes in one run.
- AA3's warm-store s1b: does every agent wait once the holder line gives a time left?
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- Codex, Pi and OpenCode are still not exercised.

## Round 12 (023-87)

Row 023-87, wave 41, worker c1a9ce63, 2026-11-24 20:29Z to 21:24Z, on the lab VM, which the human allowed for this round (2026-11-24). Squeal 0.1.624 as released (tag `squeal--v0.1.624` at `377d4ae13`, hub entry `fdc7453`). It carries wave 40: 023-83 (a late partner on the shared group slot runs the leader's first file first; a lane that waits at the slot records why: "in use", "taken at its last try", or "its turn went to another worktree that waits for it") and 023-84 (a named file behind its own side's run at an older key says that run will not count). Strict slot alternation was dropped (row 023-88), 023-85 (first-run re-runs) was stopped, and 0.1.615 to 0.1.623 carry other specs' work (017, 018, 025, 026). Claude Code 2.1.327, `--model sonnet`. s1, s1b and s2 used round 11's prompts byte-equal. New in the harness: each session's browser runs of both sides in start order, the turns per side, and the first browser file with both sides (`tasks/023-87/data/<id>/runs.txt`, section "023-83"). The brief is `tasks/wave-41.md`; scripts, per-session data and judgements are in `tasks/023-87/`.

### Verdict

- **No wrong answer; the named browser file got both sides in 4 of 5 s1b sessions (round 11: 4 of 5).** 0 of 20 sessions answered the whole question; the other 96 browser files cannot run in 1,200 s. 19 gave a partial answer that was right for the files they compared (round 11: 19). 1 said honestly that it could not tell yet (s1b-04; round 11: 1). 0 were wrong. 4 of the 19 partial answers carry one swapped, unsupported, misquoted or overcounted sentence (round 11: 3).
- **023-83, order: the first file the leader ran is now the first file paired, in 9 of 9 sessions where the commit side led** (round 11: the follower took the leader's latest file, 6 of 6). In all 5 s1 sessions the commit side ran `activity.e2e.ts` first and the working tree's first browser run was `activity.e2e.ts`. In s1b the working tree ran the named file first when its request named it (s1b-01, 03, 05), then the leader's first file.
- **023-83, time: the first pair came inside the first call in 0 of 9 wide sessions, and later than in round 11.** In s1 the first browser file with both sides finished at 130, 155, 174, 178 and 179 s into the session (median 174 s; round 11, recomputed with the same rule: 118 to 214 s, median 134 s). The first call ended at 103 to 107 s. The pair is later because the first file is now `activity.e2e.ts`, which takes 29 to 47 s per side, where round 11's first pairs were mostly `agent-browser-tabs.e2e.ts` (6 to 13 s). The working tree cannot start a browser file before its own tests tier ends (102 to 149 s), so no ordering can bring the pair inside a 100 s first call here (`tasks/023-87/notes.md`). The pair existed before the agent's last call ended in 4 of 5 s1 sessions, but each last call was narrowed to the lint folder and did not show it (AB2).
- **023-83, turns: after the first pairs the sides took 1 to 3 turns in a row in 8 of 10 s1 and s1b sessions, but one side took 4 and 6 in a row in two s1b sessions while the other side's request waited (AB1).**
  - s1b-01: the commit side ran 4 files in a row (66 to 315 s). The working tree's narrowed request for the named file waited from 106 s; when the commit side's run of it ended at 254 s, the commit side took the slot twice more (`agent-browser-tabs`, `agents-dock`), and the working tree started it at 315 s, 61 s later.
  - s1b-04: the working tree ran 6 files in a row (149 to 417 s), 4 of them files the commit side had not run (`agents-dock` twice, `artifact-project-links`, `thread-scroll`). The commit side, with 94 browser files queued since 6 s and the named file requested again at 270 s, ran no file from 148 to 419 s. The agent's 150 s wait ended at 419 s with the named file "queued at d8abcfe46, waiting for the browser group's slot", and the agent stopped (the honest answer above).
  - This is review 0.1.621 S1's case, which row 023-88 holds.
- **023-83, the wait reasons were true each time.** No call or hook said "worker pool" or "not known" (round 11: the hook's "whether the browser group's slot or the shared worker pool holds it is not known" in 5 of 10). The hook said "(in use)" 3 times (s1-05 at 104 s, s1b-01 at 104 s, s1b-05 at 306 s), each while the other side's run held the slot. It said "(its turn went to another worktree that waits for it)" once (s1-03 at 182 s), true at that moment; the working tree itself ran the next file 3 s later. No line said "in use" for a free slot or "taken at its last try". The `--at` calls named the holder in 3 of 3 s1b sessions where one held the slot (s1b-01, 02, 03; "running for 1 min 36 s", "26 s", "1 min 1 s", each within 1 s of the store), and the agent waited each time. s1b-04's call at 419 s gave no holder and no reason, at the second between the working tree's run (ended 417 s) and the commit side's (started 419 s): true, but it carried none of 023-83's reasons, which `status --at` does not print (AB3).
- **023-84 works: one "will not count" line, true, and the agent waited for the counting run.** s1b-05 at 305 s: "waiting for the commit worktree's run of packages/web/e2e/thread-scroll.e2e.ts to end: that run started before its inputs changed (running for 35 s), so its result will not count, and the file runs again after it". The store shows that run from 270 to 419 s and a second from 434 to 560 s; only the second counted. The agent made 3 more calls and read pass -> pass at 562 s. The line's "runs on its own (about 75 s)" was short: the counting run took 126 s and the working tree's run 134 s. No other session had a named file behind a stale run.
- **The named file at the commit (s1b).** Both sides in s1b-01 at 450 s, s1b-02 at 373 s, s1b-03 at 434 s and s1b-05 at 560 s into the session (round 11: 367 to 396 s by the store); not in s1b-04 (AB1). The working tree ran it first in s1b-02 to 05; the commit side in s1b-01.
- **First-run re-runs on an empty store are paid in every session that ran folder-listing tests (row 023-81, unchanged).** No session restarted a daemon or edited a file.
  - s1 and s1b: on the commit side `lint-ast-grep-1/2` 35 to 55 s after their first run in 9 of 9 sessions that ran them; on the working tree 2 to 6 lint files 25 to 33 s after, in 9 of 9. s1b-05's commit side also ran 4 more lint files and `runner-closure.test.ts` twice.
  - Browser files: one in 4 of 10 s1 and s1b sessions (`activity` in s1-02's working tree, `agents-dock` in s1b-01's commit side and s1b-04's working tree, the named `thread-scroll` in s1b-05's commit side, the 023-84 case).
  - s2: 4 to 6 `test/ci` and other files on the working tree in 10 of 10, 12 to 59 s after their first run.
- **Kept from round 11.** 023-73's "the file as it was at a5c9b7223, without its changes since then" appeared in 10 of 10 s2 sessions, and all 10 agents restated it right. `test/store/open.test.ts` got its commit result inside the call that named it in 10 of 10, 110 to 174 s after the first call (median 115 s; round 11: 114 s). Every s1 and s1b first call gave the browser group "time unknown", and no agent made up a browser time. No hook said "N pending (<file>), waiting for `squeal run`" (round 11: 2).
- **Time:** s1 median 186 s (145 to 190; round 11: 161 s), s1b median 441 s (378 to 567; round 11: 384 s), s2 median 125 s (120 to 183; round 11: 125 s). No session reached the 1,200 s limit.
- **What sessions leave behind:**
  - Every commit daemon outlived `squeal stop` and was stopped by the harness with `squeal stop --at HEAD~1` (20 of 20; V5, by design, unchanged).
  - squawk's e2e server and its lease watcher outlived 10 of 10 s1 and s1b sessions (round 11: 10 of 10). A lease watcher of the removed commit worktree outlived 6 of 10 (round 11: 5 of 10) (T3, V7).
  - s2 left no process.

### Setup

| Item | Value |
|---|---|
| Machine | The lab VM, 12 CPUs. At 20:29Z the 1-minute load was 0.04, no other user job ran, and no throwaway user or AppArmor profile from an earlier round was left. Sessions started only while the 1-minute load was below 12, at most 3 at once (`bin/batch.mjs`). The 1-minute load at session start was 4.23 to 12.40, all of it from the throwaway user's daemons, e2e servers and browsers. |
| Isolation | Throwaway OS user `squeal-w41`, case root `~squeal-w41/runs/w41`, `env -i`, cwd `/`; `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` passed by name only, as round 11. |
| Squeal | The release's `install.sh` (`git show squeal--v0.1.624:install.sh`, `SQUEAL_VERSION=0.1.624`) with `SQUEAL_MARKETPLACE` at a clone of the hub at `fdc7453` ("squeal 0.1.624"). `squeal --version` and `claude plugin list` printed 0.1.624. |
| Browser | As rounds 8 to 11: squawk's own e2e environment downloaded `agent-browser` and Chrome for Testing into the user's home, and one AppArmor profile let only that Chrome path use user namespaces. No OS package was added (877 before and after). `pnpm run test:e2e thread-scroll.e2e.ts` as the user passed 18 of 18 tests in 98 s before s1 (`tasks/023-87/data/browser-proof.txt`). |
| s1b's file | `thread-scroll.e2e.ts`, as rounds 9 to 11. |
| Harness | Round 11's scripts with the changes in `tasks/023-87/notes.md`: names, versions, the 023-83 section of `runs.mjs`, and the round 12 lines (`lines12`, `hooks12`). The `dryat` check ran first with no model. |
| Repositories | As round 11: squawk at `8be977ad6` (s1, s1b), Squeal at `20f03a431` (s2), one fresh clone and install per session, empty store. |
| Order | s1-01 alone as a trial (145 s), then s1b, s2 and s1 interleaved in round 11's order, 3 at once, 20:39Z to 21:18Z. |
| Cost | 20 sessions, $1.28 (s1 $0.38, s1b $0.38, s2 $0.52). |
| Cleanup | Each clone was removed after its session, and each commit daemon was stopped with `squeal stop --at`. At the end: the AppArmor profile unloaded and deleted, the browser and `agent-browser` deleted, every process of the user ended, the user and its home removed, `/opt/squeal-w41` and the user's `/tmp` entries removed, and the work folder deleted, streams and transcripts included (21:24Z). No uid-1002 process or file left; the package list equal to the one before the round; the VM's load 0.26. |

### Per group

Round 11's counts are in brackets. Columns as round 11. "Both sides" counts sessions that got a result on both sides, in the agent's own calls, for at least one compared file.

| Group (n) | `--run` | Both sides | Answer | `--at` on HEAD (refused) | Still running (read right) | Joined | Past 120 s (moved) | Swaps | Left after the session | Wall median (range) | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 squawk, empty store (5) | 5 [5] | 5 [5]: lint folder call with 9 to 10 unchanged in s1-01, 02, 03, 05; 13 unchanged (lint and 4 more) in s1-04; no browser file in any call [0] | full 0 [0]; partial, right 5 [5] (s1-03 with one sentence that swaps the sides, s1-04 with one unsupported, s1-05 with one misquote); honest 0 [0]; wrong 0 [0] | 4 [2] (4) | 5 (4) [5 (4)] | 2 [2] | 0 (0) [0 (0)] | 0 [0] | 5 of 5: the commit daemon (stopped by the harness); 5 the e2e server and lease watcher; 2 also a lease watcher of the removed commit worktree | 186 s (145 to 190) [161 s] | $0.38 [$0.36] |
| s1b squawk, one browser file named (5) | 5 [5] | 5 [5]: `thread-scroll` in 4 [4] (s1b-01, 02, 03, 05); 15 unchanged with `activity` and `agent-browser-tabs` in s1b-04; 28 lint files in s1b-05 | full 0 [0]; partial, right 4 [4] (all 4 compared the named file; s1b-05 with one overcount); honest 1 [1] (s1b-04: stopped while the named file at the commit waited for the slot, AB1); wrong 0 [0] | 1 [3] (1), 1 call [4] | 5 (5) [5 (5)] | 4 [4] | 8 calls in 5 (0) [5 calls in 4 (0)] | 0 [0] | 5 of 5: the commit daemon (stopped by the harness); 5 the e2e server and lease watcher; 4 also a lease watcher of the removed commit worktree | 441 s (378 to 567) [384 s] | $0.38 [$0.40] |
| s2 Squeal, empty store (10) | 10 [10] | 10 [10]: `open.test.ts` (7), 38 `test/store` files (3) | full 0 [0]; partial, right 10 [10] (none with a wrong sentence [0]); honest 0 [0]; wrong 0 [0] | 7 [9] (7) | 10 (10) [10 (10)] | 0 [0] | 0 (0) [0 (0)] | 0 [0] | 10 of 10: the commit daemon (stopped by the harness); no process | 125 s (120 to 183) [125 s] | $0.52 [$0.53] |

Per session: `tasks/023-87/data/judgements.tsv` (with columns for 023-83, 023-84 and the first-run re-runs) and `data/<id>/`, with `runs.txt` for each side's runs in order.

### Squeal text read wrong or not acted on

| Text | Sessions | What the agent did |
|---|---|---|
| `thread-scroll.e2e.ts, …: 1 of 1 queued at d8abcfe46, waiting for the browser group's slot` with `Still to run, at d8abcfe46: 1 test file, time unknown: waiting for capacity (the browser group's slot)` at 419 s, after the working tree took the slot 4 times in a row | s1b-04 | Read right ("It was still waiting for the browser group's slot when I stopped"), then stopped at 425 s. The commit side's run started at 419 s and was cut by the harness's stop (AB1). |
| The first call's `.github/scripts/change-surface-readers.test.cjs: pass -> no result (running) (at d8abcfe46: run in the commit's worktree)` and 2 more | s1-03 | "Three files running at the parent … They passed before": the sides are swapped. The same slip as round 11's s1-03. |
| The lint call's 13 unchanged, with the two `.github/scripts` files cut by its own `tail` | s1-04 | Listed them among the 13 "passed both before and after", then said "Their reruns at the parent were still going … so I didn't confirm them": unsupported. |
| `packages/web/e2e/activity.e2e.ts: pass -> no result (queued)` | s1-05 | "Squeal reported `pass -> no result (running)`": misquoted, not wrong about any change. |
| `28 unchanged, 2 unknown, of 30 named test files` (29 lint files and the named file) | s1b-05 | "The 29 other test files under `packages/cezar/src/lint/`: all pass at both commits": overcounts by 1. |

Read right this time: the holder line (3 of 3 read it right and waited); 023-84's "so its result will not count, and the file runs again after it" (1 of 1; the agent kept waiting); 023-73's "the file as it was at a5c9b7223" (10 of 10 restated it); the HEAD refusal (12 sessions, 12 calls; all went on with the parent); "time unknown … for the browser group" (no agent made up a browser time); "of N named test files; the change selects 110" (no narrowed answer read as the whole); "The rest of the queue, outside these paths"; "went from running to a result"; "124 test files not selected".

### What went wrong, and the changes the evidence asks for

Proposals, not code. The coordinator numbers rows.

| # | Problem, with the evidence | Proposed change |
|---|---|---|
| AB1 | **One side keeps the shared slot for 4 to 6 turns while the other side's request waits.** s1b-04: the working tree ran 6 browser files in a row (149 to 417 s), 4 of them files the commit side had not run; the commit side, with 94 browser files queued and the named file requested, ran nothing for 271 s, and the agent stopped at 425 s without the named file's commit result. s1b-01: the commit side ran 4 in a row and the working tree's named file waited 61 s after the commit side's run of it ended. In the other 8 s1 and s1b sessions no side took more than 3 in a row. This is review 0.1.621 S1's case. | Row 023-88, with this round as its evidence, in a form that does not need strict alternation: a side whose request holds a file and has waited for the slot through one whole run of the other side gets the next turn, named files first. Test: two daemons, one slot; side A's request holds a, b, c; side B's holds x and waits; after A's run of a ends, B runs x before A runs b. |
| AB2 | **A pair that exists is not shown when the agent narrows to another folder.** In 4 of 5 s1 sessions `activity.e2e.ts` had both sides (130 to 179 s) before the agent's last call ended (138 to 184 s); each last call named only `packages/cezar/src/lint` and said "The rest of the queue, outside these paths: N more test files queued or running", so no s1 answer reports a browser comparison. | In a narrowed call, add one line for files outside its paths that the request holds and that now have both sides: "Outside these paths, 1 more test file compared: packages/web/e2e/activity.e2e.ts: pass -> pass". Test: a request with files a and b; a gets both sides; a call narrowed to b shows that line for a. |
| AB3 | **`status --at` does not carry 023-83's wait reasons.** The hook says "(in use)", "(its turn went to another worktree that waits for it)" or "(taken at its last try)"; the `--at` line says only "waiting for the browser group's slot" when no holder holds it (s1b-04 at 419 s), and `waitText` has no `why` (`tasks/023-87/notes.md`). | Add the published reason to the `--at` line when it names no holder, with the same words as the hook. Test: a lane publishes `slot: turn` with the slot free; the narrowed `--at` call reads "(its turn went to another worktree that waits for it)". |
| AB4 | **A narrowed `status --at` without `--run` keys in a temporary checkout while a commit daemon serves that commit.** s1b-04 at 108 s: `squeal status --at 8be977ad6~1 packages/web/e2e/thread-scroll.e2e.ts` printed "keying test files at d8abcfe46 in a temporary checkout" and took 58.7 s, while the same call's first command had just joined that commit's daemon. | Ask the live commit daemon for the keys when one serves the commit, as `--wait` does. Test: a commit daemon at C is live; `status --at C <path>` without `--run` makes no temporary checkout. |
| AB5 | **023-84's line gives a short time.** s1b-05: "runs on its own (about 75 s)"; the counting run took 126 s, the working tree's run of the same file 134 s. | Check which stored duration the line reads; prefer the file's latest completed run on either side. Test: the working tree stored 134 s for the file; the commit side's line says about 2 min. |
| 023-81, V5, T3/V7 | **Unchanged.** Folder-listing tests ran twice on an empty store in every session that ran them; one browser file ran twice in 4 of 10 s1 and s1b sessions. Each commit daemon outlived `squeal stop` (20 of 20). squawk's e2e server and lease watcher outlived 10 of 10 s1 and s1b sessions, and the commit worktree's lease watcher 6 of 10. | As before (row 023-81; round 6's V5 cost line and T3/V7 process-group stop). |

Not product defects, recorded for the coordinator:

- **squawk's browser files run one at a time** (one slot for both sides), 126 to 158 s each for `thread-scroll.e2e.ts` under the round's load, so the 96 not named cannot compare in 1,200 s, whatever Squeal does.
- **The sessions share one OS user**, so `squeal ps`, the worker pool, the pending counts and the load the agents saw include other sessions' daemons and browsers. With 3 sessions at once, up to 6 daemons share one pool.
- **No session ran `proof`.** 12 answers mention it, as not run, for the new test file in s1 and s1b or for `open.test.ts` in s2.

### Open for a later round

- After AB1 (row 023-88): s1b again, 5 sessions. The question is whether the named file gets both sides in every session, and whether any side takes more than 2 turns in a row while the other waits.
- AA3's warm-store s1b (a stored duration for the named file) is still not run.
- A `proof` prompt (a red proof of a real fix), to exercise D7.6's green side on the commit daemon.
- Codex, Pi and OpenCode are still not exercised.
