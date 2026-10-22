---
name: setup
description: Use when the user asks to set Squeal up in this repository, or to upgrade or change its setup (/squeal:setup in Claude Code, $squeal:setup in Codex). Runs squeal setup's plan, asks its questions, applies the answers and shows the diff.
---

# Squeal setup

`squeal setup` decides what to ask and writes every file: the harnesses, the Squeal block in the instruction files, the gate lines that run tests, the slow test files, the suites that test a build output, Codex trust. You ask the user its questions and pass the answers back as flags.

In Claude Code `squeal` is on the Bash tool's PATH; if not, run `"${CLAUDE_PLUGIN_ROOT}/bin/squeal"`. In Codex it is not: run `node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`, the plugin root being the directory that holds `skills/setup/`. Below, `squeal` means that command.

## Steps

1. **Read the plan.** Run `squeal setup --plan --json` for the ids the flags take, then `squeal setup < /dev/null` for the questions: with no terminal it prints each question with its choices, the default first, writes nothing and exits 1. Done when you have each question and the flag that answers it (table below).
2. **Ask.** Do not ask again what the user already said ("take the defaults", "no block"). Ask the warm-up question with step 4's note on where it runs, and add one for the launcher (step 5). When the plan's `squealMentions` names a line, that file already holds Squeal instructions outside the block: show the user that line with the block question, since a block would repeat them. Show the user the plan's `not run:` and `run twice:` lines, each with its fix: no question or flag covers them. With `AskUserQuestion` (an interactive Claude Code session), ask the rest at most four questions a round, the default first and marked so; it takes four choices, so name any further ones in the question for a typed answer. Without it (`claude -p`, `codex exec`, Codex), print the plan's summary and each question with its numbered choices, say the user can reply with answers or "defaults", and end the turn without writing anything. Done when every question has an answer.
3. **Apply** with `squeal setup --yes --no-warmup` and one flag per answer:

   | Question | Flag |
   |---|---|
   | Set up a harness here? | `--harness claude-code`, `--harness codex`: each one chosen; `--harness none` when none |
   | Write or upgrade the Squeal block? | `--block <file>` for each file written; `--block none` when none |
   | Gate line `<id>` | `--gate <id>=reword` or `--gate <id>=keep` |
   | Leave a group's tests to CI and to runs after a build? | `--exclude <glob>` for each group answered yes, the glob as the question shows it; a group answered no is then asked whether it is slow |
   | Run a group in the slow tier? | `--slow <glob>` for each group answered slow, the glob ending in `/**` as the question shows it; `--slow none` when none |
   | Codex trust | `--no-trust` when declined |

   Setup asks no input question: Squeal covers no test of a build output, which goes in the runner's `exclude` instead; show the user the evidence the question names, and that Squeal never builds. Give `--input <glob>=<path>` only for a committed file the user says a slow group reads at runtime, and `--input <glob>=none` when none; never a file the suite's own bootstrap rewrites on each run (an environment descriptor, a log, a PID file): declared, every boot re-runs the group. `--slow`, `--input` and `--exclude` answer every slow group together, so once you give one, give them for each group. Setup refuses a glob that selects no test file. Then show the user the `Changes:` part of the output: the diff stat, each instruction file's diff and the files to commit. Never commit or stage. Done when the command exited 0 and the user has seen the diff, or you said which step failed and what its output says.
4. **Warm up**, when the user chose it: `squeal warmup` runs every test file once, so the results carry over to the repository's other worktrees. From here it runs on this session's daemon, which exits 3 s after the last session ends, so it stops with the session; in Claude Code give the Bash tool a 600000 ms timeout, and in Codex poll the running command. Say that `squeal warmup` from a terminal runs it on a daemon of its own, for the rest or for later worktrees. Done when it printed its verdict, or the user has that command.
5. **The launcher**, when the user wants `squeal` in a terminal: copy `<plugin root>/bin/squeal-launcher` to `${SQUEAL_BIN_DIR:-$HOME/.local/bin}/squeal` with `mkdir -p`, `cp` and `chmod 755`, as `install.sh` does. A file already there without the line `# squeal-launcher format` is not Squeal's: leave it and say so. When that directory is not on the PATH, give the line for the shell's profile: `export PATH="$HOME/.local/bin:$PATH"`. Done when `squeal --version` runs from that path, or the user declined.
