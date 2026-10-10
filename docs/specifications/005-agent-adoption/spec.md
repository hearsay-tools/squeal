# 005 Agent adoption

Stage: approved 2026-10-09 by the human; dispatch waits for the human's go. Amendments: `status.md`. Research: `research/adoption-baseline.md` (Opus, the dogfooding record and 330 Cezar sessions, no new sessions), `research/instruction-surfaces.md` (Opus, 40 controlled sessions), `research/hook-levers.md` (Astra, 40 controlled sessions), `research/cli-distribution.md` (Opus, probes in a scratch home, no sessions), all at Claude Code 2.1.295 and Codex 0.160.1. Specs 001 to 004 hold unless a section here says otherwise.

## Problem

Squeal has no value if agents ignore it (the human, 2026-10-09). They mostly do. In this repository 210 of 226 editing sessions ran tests themselves: 2,440 runs, 1,506 minutes. In cezar it was 37 of 61. The research says why, ranked by test runs explained:

- **Checking their own change** (55% of runs). The agent runs the file about 10 s after its edit (p50). In 78% of the store-checked runs Squeal had not yet finished a run of at least one file the agent's run covered: under load its result takes minutes. `status --wait` waits for everything pending, not for the agent's files, and timed out at 60 s in 002-19 and 003-19. Since then 001-186, 001-191 and 001-196 (0.1.87) end the wait once the files the agent's edits re-keyed are current, and 001-184 keeps an edit's tier to files of comparable speed. The one agent asked said it did not trust the timing.
- **A repository gate** (17% of runs, 39% of test wall time). This repository's `CLAUDE.md`, `AGENTS.md` and worker, reviewer and coordinator skills demanded pasted `npx vitest run` output. A gate decides. In controlled sessions a gate demanding Vitest gave a full run in 5 of 5. The same gate reworded to `squeal run --all --wait` gave none in 5 of 5, and the agents pasted Squeal's output instead.
- **Squeal's checkpoint is not a verdict yet.** `run --all --wait` exits 0 with failing tests, whether it reused results or ran them, and has no deadline. Its output says "1 test files" for queued work. "Affected checks: 14 passed" was read as "14 tests" in 3 of 5 gate sessions.

Two levers had no measured effect next to the plugin. An instruction block added nothing to the primer: 0 agent runs in 22 sessions with or without it, on a warm daemon and a 3 s suite. It did work as the fallback where the plugin was absent. Hooks that take over a test command work in both harnesses, but at a cost. Claude Code checks permission rules against the replacement, so a deny rule on the original no longer applies. Codex rewrites only together with `allow`. And with today's checkpoint, the substitute would report a pass on failing tests.

Setting a repository up is a command the user must type, `squeal init`, from a plugin whose CLI is not on their PATH (board, Later), and the plugin itself is installed from inside a harness. The human: the CLI should be there before the agent, through an install script, then `squeal setup` per repository with a warm-up run, and a skill for a user who starts inside a harness. The CLI stays a single copy. When `research/cli-distribution.md` measured it, Squeal's version was part of every result's key, so a CLI one version off from the plugin's hooks re-ran every test file (question 2). 001-199 (0.1.89) has since replaced the version with a key-format version. A version gap still means two daemons of different versions taking turns over one store, and every release still re-keys once.

A first look by the human at a repository nobody had set up (a fresh cezar worktree, Claude Code 2.1.296, 2026-10-10; `status.md`) showed the same gaps from the user's side:

- cezar had no committed `squeal.config.json`. The worktree ran on defaults: no slow marking (one batch of 4 server test files took 536 s in the normal queue) and no node:test projects.
- The worktree reused no result and started cold with 651 test files. Its baseline ran during the session at load 35, and after 38 minutes 291 files had never run.
- Status hid the baseline that was running. The human concluded none had started and requested one, which replaced it.
- The agent took silence after 148 passing files for broken delivery, and concluded the session's failures were gone by elimination, because nothing said its edits' files were current.

## Goals

1. `squeal run --all --wait` gives a verdict a gate can use. It exits 0 only when the checkpoint completed with every test file current and no known failures at a revision the worktree is still at, and 1 with known failures. It exits 3 when Squeal cannot say: no daemon, abandoned, deadline reached, unknown results, or the worktree changed during the checkpoint. Its first line names the outcome and the revision, and how many test files it reused and how many it ran. Every count it prints names tests and file-level checks apart.
2. An agent can wait on files it names, such as a test it suspects is flaky. `squeal status --wait <ms> <path>...` returns when every test file the paths select has a result for its current key, and exits as in goal 1 for those files. It adds no priority: an edit's files already run first (001 D5), and the wait already covers them (001-186).
3. A user sets Squeal up from the terminal before starting an agent: one install command per machine, then `squeal setup` per repository. Setup inits each harness, trusts Codex's hooks, proposes which tests are slow and what build output each slow group tests (D3, "Slow tests and their inputs"), and offers a warm-up whose results the first session finds current. `squeal update` keeps every harness's plugin at one version. A user who installed the plugin inside a harness gets the same setup by asking their agent (`/squeal:setup`). Nothing is written without a yes, nothing is committed, and no second copy of the CLI is installed.
4. Setup can write a managed instruction block into the file each harness reads, between versioned markers. It replaces the block on upgrade and `squeal remove` takes it out. Two files that resolve to one file get one block.
5. Setup finds instruction lines that run the test command and offers each a rewording to Squeal's checkpoint, shown as a diff, written only on its own yes.
6. Adoption is measured. On a cold, slow fixture in both harnesses, controlled sessions under the reworded gate run the full suite through Squeal and not Vitest, and every final claim about the tests is true, also for sessions that end red. In this repository, agent-run Vitest outside a gate falls to at most half the baseline of 9.0 runs per editing session, and workers' full-suite Vitest runs to near zero. The targets were set by the human, 2026-10-09, as the coordinator proposed.
7. Opt-in, an agent's own test command whose every test file Squeal validates and holds a current result for is answered once with those results instead of running (D8). A command Squeal cannot resolve completely always runs, and the deny never names a test file the command would not run or one Squeal does not run.

## Non-goals

- **Hooks that rewrite or annotate an agent's test command, and any test-command deny by default** (`research/hook-levers.md`). A rewrite routes around the user's permission rules in Claude Code and needs `allow` in Codex. Context before or after the run changed nothing in 8 of 8 sessions. A deny that could not answer stopped the run and left the check undone. The one exception is D8's opt-in deny, which fires only when it carries the answer (the human, 2026-10-10).
- **Removing the independent run.** The agent's own runs caught Squeal wrong 5 times, each through an input outside the key. Reviewers, the coordinator's landing check and CI keep `npx vitest run`, and every text keeps "when you doubt a Squeal result".
- **Editing an instruction file, a gate or a skill without the human's yes**, and committing anything.
- **A second full copy of the CLI** (an npm package, a single binary, Homebrew) and publishing to npm (`research/cli-distribution.md` 2). An npm package holding only the launcher and setup could come later; publishing is the human's call.
- **Installing Node or a harness.** The install script checks for them and stops with what is missing.
- **An unprompted offer to set Squeal up.** In a repository without Squeal every hook is silent (001 D9), and stays so.
- **`squeal why` with a test's console output.** It would cover investigation runs (9%) and red steps; it is 001-173's (`squeal why` names the run log holding a check's console output).

## Design

### D1. The checkpoint's verdict

Amends 001 D5 and D7. `squeal run --all --wait [<ms>]`, where `<ms>` bounds the wait. Without it, the command waits until the checkpoint ends, as today. Exit codes:

- `0`: the checkpoint completed. Every test file it covers has a current result at its revision, there are no known failures, and the worktree is still at that revision.
- `1`: it completed with known failures, as `npx vitest run` exits on a failure.
- `2`: a usage error, as today.
- `3`: Squeal has no verdict. That covers no daemon, a checkpoint abandoned (the install wait, a daemon exit), the deadline reached with files pending (the checkpoint goes on in the daemon), a covered file `unknown` at the end, or a revision recorded after the checkpoint's. The first line says which.

The first line is the verdict, factual as 001 D6 asks: `Checkpoint 12 completed at revision 9: no known failures; 290 test files, 284 with a current result, 6 run now`, or `Checkpoint 12 has no verdict: the deadline passed with 3 test files pending at revision 9`. The status snapshot follows as today. Every count of checks a checkpoint, `status` or a header prints names its tests and file-level checks apart (001 D4: one file-level check per test file), for example `14 checks: 10 tests, 4 test files loaded`. The checkpoint's start line counts files to run and files already current, never queued work alone. `run --all` without `--wait` keeps its exit codes. A slow file the checkpoint covers counts like any other (004 D2 (c)).

### D2. A wait on named files

Reconciled 2026-10-10 with the 001 coordinator (`status.md`). 001-186, 001-191 and 001-196 (0.1.87) end `status --wait` once the files the agent's own edits re-keyed have results under their new keys, 001-184 keeps an edit's tier to files of comparable speed, and an edit's files already go first (001 D5). What is left is waiting on a file the agent did not edit.

Amends 001 D7. `squeal status --wait <ms> <path>...` restricts the wait's file set. A test-file path selects itself. Any other path selects the test files whose closure holds it, using the stored closure only when it is valid for the file's current key (001 D6's rule). A path that selects nothing exits 3 with `no test file's closure holds <path>`. There is no daemon request and no new priority: a reordering request would fight the edit-first rule and 001-201's cross-worktree claims. If reordering is ever wanted, 001 owns it in the scheduler and 005 adds only the CLI over a 001 request. The wait returns when every selected file has a result for its current key at the current revision, or at the deadline. It prints the selected files' failures in full, then their counts in D1's units, then the snapshot header, and exits as D1 for those files only. Without paths, `status --wait` keeps 001 D7's contract as 001-186 to 001-196 amended it.

### D3. Install and setup

Rewritten 2026-10-09 after `research/cli-distribution.md` (005-05), on the human's direction: the terminal comes first and the skill is the second way in. The plugin stays the only full copy of Squeal. Its CLI, hooks and daemon share a version. When 005-05 measured it, a daemon one version apart re-ran every file, because a result's key held the Squeal version (question 2). Since 001-199 (0.1.89) a key holds a key-format version instead. One copy still keeps one daemon version per store, and it is the simpler thing to install and update. Everything the terminal gains is a launcher into the installed plugin.

**`install.sh`**, once per machine: `curl -fsSL <url>/install.sh | sh`. Its URL and where it is hosted, this repository at a release tag or the hub, are a wave-0 check (005-04); either way it is pinned to a release. It is POSIX `sh` and idempotent, needs no sudo, asks nothing (under a pipe, stdin is the script), and prints each command before running it. Steps:

1. Check for Node 22.13 or later, which the hooks need anyway. Without it, stop and say so.
2. For each of `claude` and `codex` on the PATH (none found: stop and say so), add the hub marketplace and install `squeal@hearsay` at user scope with that harness's own CLI: `claude plugin marketplace add hearsay-tools/marketplace` and `claude plugin install squeal@hearsay`; `codex plugin marketplace add` and `codex plugin add squeal@hearsay`. It writes nothing under `~/.claude` or `~/.codex` itself (002 D1).
3. Copy the launcher from the installed plugin to `~/.local/bin/squeal` (`SQUEAL_BIN_DIR` overrides). When that directory is not on the PATH, say how to add it.
4. Print the next step: `squeal setup` in a repository.

`install.sh --uninstall` removes the launcher and uninstalls the plugin through each harness. The README shows the download, read and run steps beside the pipe.

**The launcher**, `bin/squeal-launcher` in both plugins. At each call it finds the installed plugin's `dist/cli/squeal.mjs`, through Claude Code's `installed_plugins.json` (a project-scope entry for the working directory first, then user scope) and the Codex plugin cache, and runs it with Node: about 85 ms more per call than the CLI alone (005-05, question 1). A plugin update needs no launcher update. When the harnesses hold different versions, it runs one of them, which one being a wave-0 check, and prints one line naming both versions and `squeal update`. With no plugin found, it prints the install command and exits 1. Inside Claude Code's Bash tool the plugin's own `bin/squeal` stays first on the PATH.

**`squeal setup`**, once per repository, from the terminal:

1. Find the harnesses and whether each has the plugin installed. For one that does not, print its install commands.
2. Plan: `squeal setup --plan [--json]`, read-only. It reports the harnesses, runners (Vitest; node:test projects from `src/cli/node-test-seed.ts`), slow candidates (004 D1), the instruction file each harness reads (D4), gate lines (D5), an existing block and its version, the existing `squeal.config.json` and whether git tracks it, Codex trust, and the size of a warm-up (the test files without a current result). A config that is missing, untracked, or only in the main checkout reaches no other worktree: cezar's was untracked in its main checkout, so its worktrees ran on defaults (`status.md`, 2026-10-10). Setup writes the config in the worktree it runs in and says to commit it.
3. Ask one question per open choice, the plan's default first: harnesses, the block (D4), each gate line (D5), slow groups and their inputs (below), Codex trust when not yet given (it is once per user and survives upgrades, 005-05 question 1), and the warm-up.
4. Apply. `squeal init` for each harness, which gains one flag per choice (`--block <file|none>`, `--gate <id>=<reword|keep>`, `--slow <glob>`, `--input <test glob>=<input glob>`) and with no new flag behaves as today. Then Codex trust. Then the warm-up: `squeal start`, then `squeal run --all --wait`, never `status --wait`, which returned with no results (005-05 question 3). It runs on the terminal's own daemon, which a session's end does not stop (001 D10): a checkpoint on a session's daemon was abandoned when the session ended, with 291 of 651 files never run (`status.md`, 2026-10-10; 001-219 keeps an explicit checkpoint past the session's end). It says beforehand how many test files the first run covers, prints how many of them are done as it goes, and afterwards says that the results carry over to the repository's other worktrees.
5. Show `git diff --stat` and the diff of every instruction file, and say what to commit. Never commit.

For scripts: `--yes` and one flag per choice. Without a terminal and without `--yes`, it prints the plan and the questions and writes nothing, as `init --trust` does today. On a repository already set up, the plan names what is outdated (the block's version, keys 002 to 005 added) and setup offers the upgrade. `--check` exits 1 when anything is outdated, or when a slow group's declared inputs hold no artifact (below). `squeal remove` takes the block out.

**Slow tests and their inputs.** Added 2026-10-10 (`status.md`). Slow suites test a build output (`plugins/*/dist` here, `packages/cezar/dist` in cezarion, 004 D5), and 001 D4 leaves ignored paths and paths outside the worktree to `inputs`: Squeal's observation never sees the artifact. Without a declared input, a rebuild or an edit to the tested code leaves the slow result current, the result is never inherited by another worktree (004 D6), and the only warning is 004 D5's note in `squeal status`, which no human reads. This repository's own `squeal.config.json` declares e2e inputs but no `slow` key. So setup finds both from evidence and asks:

1. Slow candidates: test files under a directory named `e2e`, files named `*.e2e.*`, the files an npm script named `test:e2e`, `e2e`, `test:integration` or `test:package` runs, and node:test projects (`src/cli/node-test-seed.ts`), grouped by directory. After the warm-up, fast files whose run exceeded 30 s (004 D1's note) join them. In the cezar session, unmarked server tests such as `workflows/monitoring-turn.test.ts` and `workflows/pi-teardown.test.ts` held a batch of 4 files for 536 s.
2. Artifact candidates for each group, each with its evidence: a directory named by the nearest `package.json`'s `bin`, `main`, `module`, `exports` or `files`; the output directory of a build script (`tsc` with its tsconfig's `outDir`, `--outDir`, `--outdir`, `-o`); and a gitignored directory that exists and that the group's test files name in a string. The setup warm-up also reports the ignored project paths each slow file read or spawned, through a 001 row in `src/runners/observe` (open question 6): never keyed and never a reason to re-run, a separate list per test file with `node_modules`, `.git` and Squeal's temp directories left out and the count capped, stored only for an explicit setup warm-up. Setup shows them as suggestions with the path read, and says they are unkeyed until the human declares them, so a candidate never looks like coverage.
3. One question per group, showing the evidence: `test/e2e/** spawns plugins/claude-code/dist/cli/squeal.mjs (3 files). Re-run these tests when plugins/** changes?` The default is the broader directory, because an input too narrow leaves a result current after a change it misses, the costliest failure. The choices are that directory, a narrower one the evidence names, or none. The question states the trade-off: with the input, each rebuild re-runs the group and its results can be shared across worktrees; without it, the group stays current after a rebuild until its own files change, and every worktree runs it itself. It also says that Squeal never builds (004 goal 8), so keeping the artifact built stays the user's or the agent's job.
4. Apply writes `slow.include` and the `inputs` map (001 D11, 004 D1, D5). When the warm-up finds a candidate the static evidence missed, setup asks once more after it. A changed `squeal.config.json` reloads the policy and re-keys only what the new inputs touch (001 D11), so those slow files run once more.

Nothing is declared without a yes. `--check` names every slow group whose declared inputs hold no artifact, so 004 D5's warning reaches a human.

**`squeal update`** updates the plugin in every harness that has it: `claude plugin marketplace update hearsay` and `claude plugin update squeal@hearsay`; `codex plugin marketplace upgrade`. Then it re-copies the launcher when the plugin's copy is newer. Codex upgrades at each session start by itself. Claude Code's CLI has no switch for auto-update (`claude plugin marketplace --help`, 2.1.295), so without this command the two drift apart, and their daemons of different versions take turns over one store. A running session keeps the version it loaded until it restarts, or until `/reload-plugins` in Claude Code.

**The skill**, `skills/setup/SKILL.md` in both plugins, `/squeal:setup` (the Codex form is a wave-0 check). It is for a user who installed the plugin inside a harness. Steps first, like `skills/squeal`:

1. Find the CLI: `squeal` through the plugin's `bin/` in Claude Code; in Codex, from the skill's own path (wave-0 check).
2. Run `squeal setup --plan --json`.
3. Interview through the harness's question tool, in one round where it allows (Claude Code's takes four questions). In a session that cannot ask (`claude -p`, `codex exec`), print the plan and the questions and end the turn without writing.
4. Apply with `squeal setup --yes` and one flag per answer. Show the diffs and never commit.
5. Offer the launcher, copied as `install.sh` step 3 does.

A warm-up started from the skill runs on the session's daemon, which exits 3 s after the last session ends (001 D10, the tier in flight finishing first). The skill says so and gives the terminal command for the rest.

The READMEs lead with `install.sh` and `squeal setup`, and give the plugin-first path second. This replaces the board's Later entry for `squeal` not being on a user's PATH.

### D4. The instruction block

Text: `research/instruction-surfaces.md` wording `b2` (322 bytes), verified as the fallback in both harnesses, plus one sentence that defers to the file's own verification steps:

```markdown
<!-- squeal:begin v1 (managed by Squeal setup; edits inside are replaced) -->
## Tests

Squeal runs the Vitest tests after each edit. Before you say the work is done, run `squeal status --wait 60000` (or the command the SQUEAL messages name) and report its known failures and pending checks instead of running Vitest. If you have seen no SQUEAL message in this session, run `npx vitest run` instead. Where this file's verification steps name a test command, they take precedence.
<!-- squeal:end -->
```

The runner names follow the policy, as the primer's do. Which file:

- **Codex**: `AGENTS.md`.
- **Claude Code**: `AGENTS.md` when Claude Code reads it, that is with no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` at the root or above, or with an `@AGENTS.md` import. Otherwise `CLAUDE.md`.

Paths are resolved through symlinks, and files that resolve to one file get one block (this repository: `AGENTS.md -> CLAUDE.md`). Writing replaces what lies between the markers, or appends the block. A begin marker without its end is refused and reported. Claude Code strips the comments before the model sees them; Codex passes them through (005-02). `squeal remove` deletes the block and lists it under "Still there" when it cannot. The plan names the block outdated when its version is older than the CLI's.

### D5. Gate rewording

A gate line is a line of a committed instruction file that runs the test command: `vitest run`, `npx vitest`, `npm test`, `npm run test`, and `node --test` with `nodeTest` projects. The plan lists each with an id and the proposed rewording. The test command becomes `squeal run --all --wait <ms>`, its output pasted as the gate asked, with one sentence for the cases Squeal cannot answer: exit 3, `squeal` unavailable, or a doubted result, where `npx vitest run` runs instead. `<ms>` stays under the harness's longest tool timeout (wave-0 check). Each line is written only on its own yes. Mentions of the test command in other files, such as skills, are listed for the human and never offered as edits. This repository's reworded gate (`97144d9`) is the first instance: it drops its "exits 0 even when tests fail" caveat once D1 ships.

### D6. Texts

- The `skills/squeal` references name D2's path form, for a test the agent did not edit. The primer does not change for it: the wait already covers the edit's own files (001-186), and 001-174 put the red/green workflow in the skill.
- The checkpoint and status units follow D1.
- The primer says that passing results are silent and a message means a check changed. After its first edit's 148 test files all passed, an agent with only the primer said "either the push messages aren't reaching me" (`status.md`, 2026-10-10). The skill says it, but Claude Code agents did not load the skill (005-02: 0 of 19).
- The skill says a new failure is re-run once by Squeal (001-171), so the agent waits for that re-run instead of running the test itself. In the cezar session the agent proposed re-running a timeout itself, and Squeal's re-run answered 54 s later as a flake.
- Reassurance is event-driven, never on a timer (the human, 2026-10-10). A periodic status would push non-news every interval, against vision principle 1, and a dead daemon is already said at the next delivery after an edit (001 D6, `notValidatedLine`), so silence without that line means a live daemon. What the cezar agent lacked was knowing its edit had been seen and when it was settled. So, besides the primer sentence above and (a) below: (c) once per session, the first delivery after the consumer's first edit says, in one line: "Squeal saw your edit and queued N test files; results arrive with later tool calls, and passing ones stay silent." A session that never edits never sees it. Built by 001 as row 001-224, with the 001 coordinator's wording.
- Accepted by 001, whose headers and status these are (001 D6, D7), 2026-10-10. (a), row 001-223: A header says when every test file the consumer's edits re-keyed is current, the set 001-186 already computes, so an agent that never waits still learns it is settled; in the cezar session it concluded "0 failures" by elimination. (b), within row 001-217 (status names a checkpoint in progress, and a `run --all` joins an equivalent running checkpoint instead of abandoning it): when a checkpoint is running, the quiet line of `status --wait` names it and `run --all --wait`; after `run --all` it returned "on quiet" in 0.8 s with 651 files pending.
- The primer stays the main surface: it reached main agents and subagents in both harnesses and came back after compaction (005-02).
- Every text change keeps the 10,000-character cap and is measured in the proof sessions, not assumed.

### D7. Measurement

`research/probes/adoption-baseline/metric.mjs` is the proof's instrument. Per session it counts:

- own runs by scope and position;
- redundant runs, against a store copy;
- Squeal pulls and waits;
- test wall time;
- false final claims. Controlled sessions end with a fixed last line, `TESTS: pass | fail | unknown, evidence: ...`, and a Vitest run after the session.

Dogfooding copies a worktree's store before the worktree is removed, since pruning lost the named record's rows.

### D8. A one-time deny of a test run Squeal has already answered

Opt-in, decided by the human 2026-10-10. Amends 001 D9 and 002 D2, where `Bash` is never denied: it still never is by default. Policy key `testCommand.denyWhenCurrent` (001 D11), default `false`. The deny lives in the `PreToolUse` entries both plugins already run on every tool call behind the `sh` gate (001 D9, 002 D2), so it starts no new process. It reads the `Bash` tool's command, which the entries' input parsers do not read today.

The rule is resolve or fall through. Anything the hook cannot resolve completely runs as normal.

1. **Recognize the command, narrowly.** `vitest run` or `npx vitest run`, with test paths or filename filters and only flags that change output (`--silent`, `--reporter`). `npm test` or `npm run <script>` only when that script in the root `package.json` is exactly one such Vitest command. `node --test ...` only when it is a configured `nodeTest` project's own command (003 D1; `src/cli/node-test-seed.ts` derives those from scripts), optionally narrowed to that project's files. Everything else falls through: chains, pipes, redirects, subshells, leading assignments, a working directory other than the worktree root, workspace flags, other runners, and flags that change what runs (`--project`, `--config`, `-t`, `--changed`, `--related`, `--coverage`, `-u`, `--watch`, `--outputFile`).
2. **Resolve the test files it would run** from Squeal's own listing of the project's configuration, with Vitest's filter rule (a filter matches the test files whose path contains it). A filter that matches no listed file falls through.
3. **Deny only when every one of those files is a file Squeal validates and has a current result at the current revision** (001 D5, as `squeal status` counts it). One file pending, stale, unknown, unlisted or outside Squeal's runners, and the command runs.
4. **At most once per consumer.** After one deny, every test command of that session or subagent runs, so a repository gate that needs the real output is met by running it again, and the agent's own run stays the independent check that caught Squeal wrong 5 times (005-01).

The reason is factual, as 001 D6 asks, with one sentence saying the command did not run and will run if issued again. It names what it covers and nothing more: the number of test files the command runs and their names (grouped by directory past ten), the revision, every known failure among them in full, and how many of the results are inherited and from where. Then what it does not cover: typecheck, build, and suites Squeal does not run. Example: `The command did not run. Squeal holds current results at revision 12 for the 3 test files it runs (src/git-refs.test.ts, ...): 41 checks passed, no known failures, none inherited. Squeal does not cover typecheck, build, or test suites it is not configured for. Run the command again to run it anyway; it will not be stopped again this session.`

Its reach today is small: 22% of store-checked runs were redundant at start (005-01), and a warm-up (D3) raises it. Whether agents accept the answer, rerun at once, or distrust it during real editing is not measured (005-03 tested only sessions told to run one exact command); the proof measures it.

## Testing

- **Unit**:
  - D1: every exit code, including a revision recorded during the checkpoint and the deadline; the unit wording.
  - D2: selection by test path, by source path, and by a path that selects nothing; the queue order unchanged by a wait.
  - The plan's JSON, `--check`, and `init` with no new flag behaving as today.
  - Slow detection: candidates by directory, file name, npm script and duration; artifact candidates from `package.json`, build scripts and gitignored directories named by tests; the default is the broader directory; `--check` on a slow group with no artifact.
  - The launcher's resolution: a project-scope entry first, Codex only, a version skew line, no plugin found.
  - D4: block insert, upgrade, removal, symlinked files and broken markers.
  - D5: gate detection and rewording.
  - Both plugins' skill copies identical, as the existing skill test does.
  - D8: each recognized form and each fall-through case; the resolved file set against Vitest's own file listing for the same arguments on fixtures; no deny with one file pending, stale, unknown or outside Squeal's runners; once per consumer; off by default; the reason names only the command's files.
- **Integration**: a real daemon on a Vitest fixture. A failing checkpoint exits 1. A deadline exits 3 and names the pending count. A wait on a named file that is current returns at once, and one on a pending file returns when that file's result lands, not when the rest of a running backlog ends.
- **End to end**, on fresh fixtures shaped like this repository and like cezarion:
  - `install.sh` in a scratch `HOME` and `CODEX_HOME` with both harnesses and with each alone: plugins installed, the launcher on the PATH, a second run changing nothing, `--uninstall` leaving nothing.
  - The launcher across a plugin update in both harnesses, and `squeal update` bringing two different versions to one.
  - `squeal setup` on the two fixture shapes proposes `plugins/**` for this repository's `test/e2e` and `packages/cezar/dist/**` for cezarion's e2e, each with its evidence.
  - `squeal setup --yes` with every choice: the files written match the plan, the warm-up leaves every test file current, a first session runs nothing more, and a second setup reports nothing outdated.
  - The setup skill in `claude -p` and `codex exec` with the answers given in the prompt.
- **Proof**: dogfooding, `lessons.md`, at calm load: no other coordinator's waves running, with the load average recorded per session.
  - Controlled sessions on a cold, slow fixture, in both harnesses and within a 40-session budget, covering what 005-02 could not: Squeal slower than the agent, and sessions that end red. Conditions: the plugin alone, the reworded gate, and `testCommand.denyWhenCurrent` on: how often it fires, whether the agent accepts the answer or reruns at once, and whether any claim after a deny is false.
  - One fresh worktree of a large repository set up with `squeal setup`, against the cezar session of 2026-10-10 that had no setup: time until every test file is current, results reused, and the agent's claims about silence and about being done.
  - The metric over this repository's sessions since `97144d9` and since the release.

## Open questions

1. How a Codex user invokes a plugin skill, how Codex names it, and whether a skill finds its plugin's CLI in a repository without Squeal, in both harnesses. Also whether Claude Code's question tool is available inside a skill. Owner: wave-0 checks (005-04).
2. Codex's shell tool timeout, which bounds D5's `<ms>`. Owner: 005-04.
3. Resolved 2026-10-10 by the 001 coordinator: no reordering request; D2 restricts the wait's file set only.
4. `install.sh`: where it is hosted (this repository at a release tag, or the hub; the human, 2026-10-09: decide in 005-04), and how it behaves under `curl | sh`. Owner: 005-04.
5. Whether a user-scope install satisfies a repository that enables Squeal in its project settings; which version a Claude Code session loads when user and project scope differ (005-05 open question 1); which version the launcher should run when the harnesses differ. Owner: 005-04.
6. Resolved 2026-10-10 by the 001 coordinator: the recorder may report ignored paths under D3's conditions, owned by 001. The 001 coordinator files the row when 005 resumes, and 005-12 consumes it.
7. How precise the static slow-input rules are: run against this repository and a cezarion copy, do they propose what was declared by hand (this repository's `test/e2e` inputs; `packages/cezar/dist/**` in 004's dogfooding)? Owner: 005-04.
8. Resolved 2026-10-10 by the 001 coordinator: D6's (a), (b) and (c) are 001 rows 001-223, 001-217 and 001-224, planned for 001's next wave.
9. D8 adds a test-command deny to the `PreToolUse` entries 001 and 002 own. Owner: the 001 coordinator, told before 005-20 dispatches.

## References

- Research: `research/README.md` and the four findings files above; board rows 005-01 to 005-03 and 005-05.
- Specs 001 (D4 to D7, D9, D11), 002 (D1 to D3), 003 (D1), 004 (D1 to D3, D8).
- `status.md`: the human's two proposals, the gate rewording (`97144d9`) and the baseline it is measured against.
- Prior art: beads `bd setup` and Nx `configure-ai-agents` (versioned markers, `--check`, `--remove`, a file per harness), in `research/adoption-baseline.md` 4; beads, Nx and Serena's CLI distribution and version checks, in `research/cli-distribution.md` 4.
