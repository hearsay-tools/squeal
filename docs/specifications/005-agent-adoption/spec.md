# 005 Agent adoption

Stage: approved 2026-10-09 by the human; dispatch waits for the human's go. Amendments: `status.md`. Research: `research/adoption-baseline.md` (Opus, the dogfooding record and 330 Cezar sessions, no new sessions), `research/instruction-surfaces.md` (Opus, 40 controlled sessions), `research/hook-levers.md` (Astra, 40 controlled sessions), all at Claude Code 2.1.295 and Codex 0.160.1. Specs 001 to 004 hold unless a section here says otherwise.

## Problem

Squeal has no value if agents ignore it (the human, 2026-10-09). They mostly do. In this repository 210 of 226 editing sessions ran tests themselves: 2,440 runs, 1,506 minutes. In cezar it was 37 of 61. The research says why, ranked by test runs explained:

- **Checking their own change** (55% of runs). The agent runs the file about 10 s after its edit (p50). In 78% of the store-checked runs Squeal had not yet finished a run of at least one file the agent's run covered: under load its result takes minutes. `status --wait` waits for everything pending, not for the agent's files, and timed out at 60 s in 002-19 and 003-19. The one agent asked said it did not trust the timing.
- **A repository gate** (17% of runs, 39% of test wall time). This repository's `CLAUDE.md`, `AGENTS.md` and worker, reviewer and coordinator skills demanded pasted `npx vitest run` output. A gate decides. In controlled sessions a gate demanding Vitest gave a full run in 5 of 5. The same gate reworded to `squeal run --all --wait` gave none in 5 of 5, and the agents pasted Squeal's output instead.
- **Squeal's checkpoint is not a verdict yet.** `run --all --wait` exits 0 with failing tests, whether it reused results or ran them, and has no deadline. Its output says "1 test files" for queued work. "Affected checks: 14 passed" was read as "14 tests" in 3 of 5 gate sessions.

Two levers had no measured effect next to the plugin. An instruction block added nothing to the primer: 0 agent runs in 22 sessions with or without it, on a warm daemon and a 3 s suite. It did work as the fallback where the plugin was absent. Hooks that take over a test command work in both harnesses, but at a cost. Claude Code checks permission rules against the replacement, so a deny rule on the original no longer applies. Codex rewrites only together with `allow`. And with today's checkpoint, the substitute would report a pass on failing tests.

Setting a repository up is a command the user must type, `squeal init`, from a plugin whose CLI is not on their PATH (board, Later). The human: setup should be a skill shipped with the plugin that interviews the user and runs the command for them.

## Goals

1. `squeal run --all --wait` gives a verdict a gate can use. It exits 0 only when the checkpoint completed with every test file current and no known failures at a revision the worktree is still at, and 1 with known failures. It exits 3 when Squeal cannot say: no daemon, abandoned, deadline reached, unknown results, or the worktree changed during the checkpoint. Its first line names the outcome and the revision, and how many test files it reused and how many it ran. Every count it prints names tests and file-level checks apart.
2. An agent can wait for its own files. `squeal status --wait <ms> <path>...` returns when every test file the paths select has a result for its current key, and exits as in goal 1 for those files. The selected files run in the next fast tier.
3. A user with only the plugin installed sets a repository up by asking their agent, in Claude Code and in Codex. The agent interviews them, runs `squeal init` with the answers, and shows every change. Nothing is written without a yes, and nothing is committed.
4. Setup can write a managed instruction block into the file each harness reads, between versioned markers. It replaces the block on upgrade and `squeal remove` takes it out. Two files that resolve to one file get one block.
5. Setup finds instruction lines that run the test command and offers each a rewording to Squeal's checkpoint, shown as a diff, written only on its own yes.
6. Adoption is measured. On a cold, slow fixture in both harnesses, controlled sessions under the reworded gate run the full suite through Squeal and not Vitest, and every final claim about the tests is true, also for sessions that end red. In this repository, agent-run Vitest outside a gate falls to at most half the baseline of 9.0 runs per editing session, and workers' full-suite Vitest runs to near zero. The targets were set by the human, 2026-10-09, as the coordinator proposed.

## Non-goals

- **Hooks that take over, deny or annotate an agent's test command** (`research/hook-levers.md`). A rewrite routes around the user's permission rules in Claude Code and needs `allow` in Codex. Context before or after the run changed nothing in 8 of 8 sessions. A deny stopped the run and left the check undone. Revisit with this spec's proof data once goals 1 and 2 hold; the researcher's proposed key is `testCommand.reuseResults`.
- **Removing the independent run.** The agent's own runs caught Squeal wrong 5 times, each through an input outside the key. Reviewers, the coordinator's landing check and CI keep `npx vitest run`, and every text keeps "when you doubt a Squeal result".
- **Editing an instruction file, a gate or a skill without the human's yes**, and committing anything.
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

### D2. A wait for the agent's own files

Amends 001 D5 and D7. `squeal status --wait <ms> <path>...`. A test-file path selects itself. Any other path selects the test files whose closure holds it, using the stored closure only when it is valid for the file's current key (001 D6's rule). A path that selects nothing exits 3 with `no test file's closure holds <path>`. The wait sends the daemon a `focus` request: the selected files' pending work goes to the front of the next fast tier, behind the tier in flight, which is never cancelled (001 D5). A selected slow file goes to the front of the slow lane, under its slot and guard (004 D2, D3). The wait returns when every selected file has a result for its current key at the current revision, or at the deadline. It prints the selected files' failures in full, then their counts in D1's units, then the snapshot header, and exits as D1 for those files only. Without paths, `status --wait` keeps 001 D7's contract and exit codes. Before wave 1 this section is reconciled with 001-172's latency measurements and 001-174's skill text (`status.md`, 2026-10-09).

### D3. The setup skill

Reopened 2026-10-09 (`status.md`): setup offers the warm-up, a terminal `squeal setup` is the human's direction, and the CLI's distribution waits for `research/cli-distribution.md` (005-05). The text below stands until then.

A second skill in both plugins, `skills/setup/SKILL.md`, invoked by the user (`/squeal:setup` in Claude Code; the Codex form is a wave-0 check) or by its description ("set up Squeal", "add Squeal to this repository", "update or remove Squeal's setup"). The READMEs tell a user to install the plugin and ask their agent. `squeal init` stays as the engine the skill runs, documented in the skill's references, not in the READMEs. Its body, steps first, like `skills/squeal`:

1. **Find the CLI.** In Claude Code, `squeal` is on the Bash PATH through the plugin's `bin/`. In Codex it is the plugin's `dist/cli/squeal.mjs`, found from the skill's own path (wave-0 check). This replaces the board's Later fix for `squeal init` not being on the PATH.
2. **Plan.** Run `squeal init --plan --json`, which is read-only. It reports what is there and what each choice would write: harnesses (detected from `.claude/`, `.codex/`, the instruction files and the running plugin), runners (Vitest; node:test projects from `src/cli/node-test-seed.ts`), slow candidates (004 D1), the instruction file each harness reads (D4), gate lines (D5), an existing block and its version, and the existing `squeal.config.json`.
3. **Interview.** One question per open choice, with the plan's default first. The questions are asked in one round where the harness's question tool allows it (Claude Code's takes four). In a session that cannot ask (`claude -p`, `codex exec`), the skill prints the plan and the questions and ends the turn without writing.
4. **Apply.** Run `squeal init --yes` with one flag per answer. Show `git diff --stat` and the diff of every instruction file. Say what to commit. Never commit.
5. **Again.** On a repository already set up, the plan reports what is outdated (the block's version, keys 002 to 005 added) and offers an upgrade. "Remove Squeal" runs `squeal remove`, which takes the block out.

`squeal init` gains `--plan [--json]` and one flag per choice (`--block <file|none>`, `--gate <id>=<reword|keep>`, `--slow <glob>`, `--harness claude-code,codex`, Codex `--trust`). It asks no questions of its own: without `--yes` and a terminal it writes only what it writes today. With no new flags it behaves as today, so existing scripts keep working.

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

- The primer (001 D9, 004 D8) gains the per-file wait: to check specific files now, `squeal status --wait 60000 <file>`. The `skills/squeal` steps and references follow.
- The checkpoint and status units follow D1.
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

## Testing

- **Unit**:
  - D1: every exit code, including a revision recorded during the checkpoint and the deadline; the unit wording.
  - D2: selection by test path, by source path, and by a path that selects nothing; `focus` ordering behind a tier in flight.
  - The plan's JSON.
  - D4: block insert, upgrade, removal, symlinked files and broken markers.
  - D5: gate detection and rewording.
  - Both plugins' skill copies identical, as the existing skill test does.
- **Integration**: a real daemon on a Vitest fixture. A failing checkpoint exits 1. A deadline exits 3 and names the pending count. A per-file wait returns before a running backlog finishes.
- **End to end**: the setup skill in `claude -p` and `codex exec` on fresh fixtures shaped like this repository and like cezarion, with the answers given in the prompt. The files written match the plan, and a second run reports nothing outdated.
- **Proof**: dogfooding, `lessons.md`, at calm load: no other coordinator's waves running, with the load average recorded per session.
  - Controlled sessions on a cold, slow fixture, in both harnesses and within a 40-session budget, covering what 005-02 could not: Squeal slower than the agent, and sessions that end red. Conditions: the plugin alone, the reworded gate, and the per-file wait in the primer.
  - The metric over this repository's sessions since `97144d9` and since the release.

## Open questions

1. How a Codex user invokes a plugin skill, how Codex names it, and whether a skill finds its plugin's CLI in a repository without Squeal, in both harnesses. Also whether Claude Code's question tool is available inside a skill. Owner: wave-0 checks (005-04).
2. Codex's shell tool timeout, which bounds D5's `<ms>`. Owner: 005-04.
3. `focus` reorders the scheduler's queue, which is 001's. Owner: the 001 coordinator, asked before wave 1 dispatches.

## References

- Research: `research/README.md` and the three findings files above; board rows 005-01 to 005-03.
- Specs 001 (D4 to D7, D9, D11), 002 (D1 to D3), 004 (D1 to D3, D8).
- `status.md`: the human's two proposals, the gate rewording (`97144d9`) and the baseline it is measured against.
- Prior art: beads `bd setup` and Nx `configure-ai-agents` (versioned markers, `--check`, `--remove`, a file per harness), in `research/adoption-baseline.md` 4.
