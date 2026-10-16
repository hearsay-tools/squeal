# Research: issue 11, subcommand `--help`

Brief: `research/issue-11-brief.md`, 2026-10-16. [GitHub issue #11](https://github.com/hearsay-tools/squeal/issues/11) (label `friction`, filed during hearsay-tools/cezarion#1142) says Squeal 0.1.199 rejects `node <plugin>/dist/cli/squeal.mjs run --help` as an unknown argument with exit 2. It asks that subcommands accept `--help`, print their flags, exit 0 and start no work. This report reproduces the issue and does not fix it.

Examined: the installed 0.1.199 bundles in Claude Code (`~/.claude/plugins/cache/hearsay/squeal/0.1.199`) and Codex (`~/.codex/plugins/cache/hearsay/squeal/0.1.199`). Both files have sha256 `6869478e…5ae31f`. Also examined: this checkout's bundle `plugins/claude-code/dist/cli/squeal.mjs` at HEAD `113613d0`, which reports `0.1.200` (unreleased), sha256 `a51e3509…6f14`, last built at `30ec91a2`. The source is `src/cli/` at the same HEAD. Tag `squeal--v0.1.199` is `e36fea56`. `git diff squeal--v0.1.199 HEAD` over `main.ts`, `run.ts`, `run-slow.ts`, `run-lanes.ts` and `wait-arg.ts` is empty. Node 24.21.0, Linux.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `run --help` exit 2 as reported? | Yes. 0.1.199 and the checkout bundle give the same result: `squeal run: unknown argument "--help"`, then the 2-line `run` usage, all on stderr. Stdout is empty and the exit code is 2. | verified by experiment |
| 2 | Is root `--help` the working control? | Yes. It exits 0 and prints the 71-line help on stdout, with nothing on stderr. That help lists `run --all\|--fast\|--slow` and their flags. | verified by experiment |
| 3 | Does `run --help` start any work? | No. The parser rejects the flag before it resolves the worktree or contacts the daemon. The temporary directory held only the two redirect files afterwards. | read in source code; verified by experiment |
| 4 | Is the rejection specific to `run`? | No, by reading. Every subcommand's parser rejects `--help` with exit 2 before doing any work. None of the other subcommands was executed. | read in source code |

## 1. Reproduction

Each command ran from a fresh `mktemp -d` directory (`$T`). `$B` was set to each of the three bundles in turn. All three printed identical stdout and stderr, apart from `--version`.

```
cd "$T"; node "$B" <args> >out 2>err; echo "exit=$?"
```

| args | exit | stdout | stderr |
|---|---|---|---|
| `--version` | 0 | `0.1.199` (the checkout prints `0.1.200`) | empty |
| `--help` (control) | 0 | the 71-line root help | empty |
| `run --help` | **2** | empty | the 3 lines below |
| `run -h` | 2 | empty | the same, with `unknown argument "-h"` |
| `run --all --help` | 2 | empty | the same as `run --help` |
| `help run` | 0 | the root help (`run` is ignored) | empty |

```
squeal run: unknown argument "--help"
usage: squeal run --all|--fast [--force] [--wait [<ms>]]
       squeal run --slow [--wait <ms>]
```

This text matches the issue's "unknown argument, followed by three usage lines and exit 2", except that the issue counts three usage lines where there are two. *verified by experiment*

## 2. Parser evidence

- `src/cli/main.ts:122` treats `--help`, `-h` and `help` as help only in the first position (`first === …`). Everything after a command name goes to that command's parser unchanged (`main.ts:126-138`). `help run` therefore prints the root help and drops `run`. *read in source code*
- `src/cli/run.ts:64-87` (`runCommand`) takes the lanes from the flag set and strips `--wait`. Any remaining argument other than `--force` or a lane flag is `unknown argument "<arg>"`, which prints `USAGE` (`run.ts:32-33`) to stderr and returns 2. `worktreeRoot` (`run.ts:88`) and `askDaemon` (`run.ts:100`) come after that return. `run --slow --help` goes to `runSlowCommand` (`src/cli/run-slow.ts:22-35`), which rejects it the same way (`unknown argument "--help" with --slow`, exit 2) before it resolves the worktree. That variant was not executed. *read in source code*
- The other subcommands reject `--help` before doing any work. None was executed:
  - `status`, `why`: `parseArgs` (`main.ts:194-205`) gives `unknown option`, followed by the full root help.
  - `failures`: `unexpected argument` (`failures.ts`).
  - `retry`: `unknown option` (`retry.ts:111`).
  - `init`: `parseInitArgs` gives `unknown argument` (`init.ts:97`).
  - `setup`: `unknown argument` (`setup/command.ts:75,101`).
  - `warmup`: takes no arguments (`warmup.ts:73`).
  - `start`, `stop`: a first argument starting with `-` is a usage error (`start.ts:16`, `stop.ts:38`).
  - `daemon`: a root starting with `-` is a usage error (`daemon.ts:21`).
  - `remove`: only `--config` is accepted (`remove.ts:50`).
  - `update`: takes no arguments (`update.ts:61`).

  Each of these exits 2. `status` and `why` print the full root help after the problem line. The others print their own one-line usage. *read in source code*
- The usage texts are spread out. The root `HELP` (`main.ts:23-94`), `run.ts`'s `USAGE`, `WARMUP_USAGE`, `INIT_USAGE` and `SETUP_USAGE` are separate strings, and `start`, `stop`, `remove` and `update` print their usage inline. Any per-command help would read from these existing strings. *read in source code*

## Recommendation for Squeal

The issue reproduces exactly as filed, on the released 0.1.199 and on HEAD. It is a usage-error exit for a request that does no harm. It does not fail validation: no work starts and nothing is mutated.

The case for a fix rests mostly on vision filter 2, less noise for the agent. An agent that probes `--help` reads exit 2 as a failure, although stderr already gives it the `run` flags. On the other side, spec 005 D6 records that no agent ran `squeal --help` in 40 sessions (005-02), so this entry point is rarely reached. Weighing that cost is the coordinator's call. If a fix is made, the parser evidence above supports one rule in `main.ts`: a `--help` or `-h` anywhere after the command name prints that command's usage to stdout and exits 0, before the command's parser runs. That covers every subcommand at once and is cheaper than one rule per command. The issue also asks for a regression test.

## Open questions and limits

- **What the reporter wanted is not something help can show.** The reporter wanted to know whether a focused run can be prioritized. Squeal has no such flag. Spec 005 D2 chose a path-form `status --wait <ms> <path>…` with "no daemon request and no new priority", and the human confirmed on 2026-10-13 (`status.md`) that a named-file wait does not move the file forward in the queue. Subcommand help would have said so faster, but it would not have given the reporter what they wanted. *read in docs (spec 005 D2, status.md)*
- **No harness session was reproduced.** The commands ran directly under Node, not from an agent's tool call in Claude Code or Codex. The launcher `~/.local/bin/squeal` was not run.
- **Only the `run` parser was executed.** The claims about the other subcommands come from reading the source only.
- **No validation ran and nothing was installed.**
