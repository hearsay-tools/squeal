# Hook levers

Recommend keeping interception off until Squeal can return a bounded, truthful command result; use an explicit checkpoint policy for projects that accept cached evidence.

Board 005-03, 2026-10-09. Squeal **0.1.67, `9848df0`**, Claude Code **2.1.295 / claude-sonnet-5-5**, Codex **0.160.1 / default gpt-6.1-sol**, Node **24.21.0**, Vitest **5.0.3**. Tags below apply at these versions. [Probes, setup limitations and cost](probes/hook-levers/README.md); [fetched source excerpts](probes/hook-levers/sources.md).

## Questions answered

| # | Answer | Evidence tag |
|---|---|---|
| 1 | Claude rewrites Bash with `updatedInput` alone. `allow` removes the normal approval requirement; deny rules still match the replacement. `ask` prevents unattended execution. Handler `if` avoids unmatched launches, but is too broad for takeover safety. | **verified by experiment**; permission/filter contract **read in official docs** |
| 2 | Codex rewrites only with **both** `updatedInput` and `permissionDecision: "allow"`. Missing `allow` or using `ask` fails the hook open: the original command executes. | **verified by experiment**, **read in source code** |
| 3 | Today's `run --all --wait` is not a drop-in Vitest replacement: cached results need not run, and even a failed test yields exit 0 when its checkpoint completes. `--force` restores execution, not the exit contract. Per-file checkpoint/wait does not exist. | **verified by experiment**, **read in source code** |
| 4 | Context notes do not prevent the selected run; deny stops it but commonly leaves the request unmet. Stop asks the agent to request a checkpoint; it does not queue one itself or enforce a permanent completion barrier. | **verified by experiment**, **read in source code** |
| 5 | Successful substitutions were disclosed by both models, but Claude repeatedly distrusted the cached checkpoint's “0 test files”. No denial subject tried a variant. Stop added a Squeal run after the direct run. These constrained prompts do not establish adoption during editing. | **verified by experiment**; editing behavior **not determined, because** this matrix requested a specific test command |

## 1. Claude permissions, visibility and filtering

**Verified by experiment.** `claude-rewrite-3` changed the command without a permission decision. `claude-allow-1/9` did so with `allow`. With an empty allow-list (`allow-unlisted-14`), the replacement still ran. `ask-4` yielded a permission denial in `-p`; neither command ran. With `deny: ["Bash(npx vitest *)"]`, the replacement ran (`deny-original-15`); with `deny: ["Bash(printf *)"]`, its first command was denied (`deny-rewritten-16`). This is evaluation against the replacement, not a general ability to override denies. An interceptor can nevertheless route around a rule attached to the original command.

**Verified by experiment.** Claude's recorded assistant tool call retains the original `npx vitest run`; the tool result contains the replacement's output. Permission-denial metadata records the replacement. Our replacement printed an explicit substitution banner. Every successful rewrite subject said the original did not run. Do not depend on invisible hook mechanics to explain what executed.

**Verified by experiment.** In three sessions of eight separate `pwd` calls plus one `npx vitest --version`, baseline plugin hooks launched 9 PreToolUse handlers; adding an `if: "Bash(npx vitest *)"` handler made 10; an unconditional D9 shell gate made 18. Thus `if` avoided eight additional process launches. A separate 100-spawn measurement in a non-Squeal fixture gave shell gate p50/p95 **4.4/9.4 ms**, empty shell **3.2/8.2 ms**, Node **101.7/200.4 ms** on this loaded host. Exact in-harness incremental latency is **not determined, because** concurrent hook timings and variable host load confound subtraction.

**Read in official docs.** `if` analyzes compound commands, strips leading assignments, and conservatively runs on uncertain expansions. It is only a launch filter. Keep a stricter handler matcher before changing input. Attended approval UI behavior is **not determined, because** all subjects were unattended; the docs say `ask` shows the modified input.

## 2. Codex differs

**Read in source code.** `hooks/src/engine/output_parser.rs:438` rejects input changes without `allow`, `ask`, and `allow` without input. `events/pre_tool_use.rs` marks invalid output failed without blocking. `core/src/tools/registry.rs` and `handlers/unified_exec/exec_command.rs` apply accepted changes to the invocation, then continue normal tool execution. `allow` here is not a bypass of the ordinary tool permission path.

**Verified by experiment.** `codex-rewrite-clean1` and `ask-clean2` ran real Vitest despite the hook's proposed replacement; `allow-clean3` executed the replacement, with no Vitest output. The public `command_execution.command` showed the rewritten shell command. The model described its originally submitted command and the substitution correctly. An invalid rewrite is especially quiet: these models reported no intervention when the original command ran. Non-bypass Codex approval interaction is **not determined, because** subjects used the host's working full-access mode; sandbox/permission conclusions above are source-only.

## 3. What an honest substitute needs

**Verified by experiment**, `logs/substitute.json`: a deliberately failing test appended an external execution marker. A cached checkpoint added **0 executions**, exited **0**, and printed **Known failures: 1**. A forced checkpoint added **1 execution** and still exited **0**. Direct `npx vitest run` added **1 execution** and exited **1**. A per-file `run probe.test.js --wait` exited **2** (unsupported). With the daemon stopped, `run --all --wait` exited **1** and asked for a daemon.

**Read in source code.** `src/cli/run.ts` treats “completed” as exit 0 regardless of failures; `--wait` has no deadline. D5 reuses current keys, and the checkpoint's file count counts queued work, so “0 test files” can coexist with full current coverage. Squeal's file-level check also makes its two passing checks differ from this fixture's one Vitest test. `--all` includes other configured adapters and slow files, which is broader than Vitest alone.

**Inferred recommendation.** Reuse is equivalent only to a project-approved current-evidence gate, never a promise of a fresh execution or literal Vitest output. A usable substitute needs explicit requested/executed scope, current revision, reused versus executed counts, failure-aware exit status, and a deadline inside the tool's remaining timeout. It must distinguish failure from unavailable evidence. `--force` is appropriate for a requested independent fresh check, but saves no execution and still needs that result contract. A per-file substitute needs unambiguous file resolution plus a checkpoint/wait tied to that exact set and revision; today's status wait is neither.

**Inferred recommendation.** Begin with the exact single command `npx vitest run`, in the configured root with unchanged environment and a project-approved reuse gate. Decline snapshot updates (`-u`), coverage, name filters (`-t`), reporters/output files, watch mode, config/project flags, shell expansions, assignments, pipes, redirects, chains and scripts that do more than Vitest. Do not infer `npm test` equivalence from its name. Preserve the original when installation, daemon reachability, scope or current evidence cannot be established. Unknown results after a bounded wait must not become a pass. Reserve time for a fallback or leave the original untouched; an expired Bash timeout is not a successful checkpoint. Never hide a genuine failing result by treating it as infrastructure fallback.

## 4–5. Softer levers and model reactions

**Verified by experiment.** Same prompt within each matrix: run exactly `npx vitest run`, no edits, report what actually ran. Warm one-file fixture except Stop's deliberate `lookup-only` setup. These counts exclude the failed Codex binary-copy pilot and permission/filter probes. The two pre/post subjects per harness and earlier Codex allow/deny subjects had the setup caveat documented in the probe README.

| Lever | Claude observations | Codex observations | Measured cost/limit |
|---|---|---|---|
| Rewrite + disclosure | 3/3 standard rewrite/allow subjects avoided direct Vitest; all questioned “0 test files” | 2/2 valid allow subjects avoided direct Vitest and disclosed cached evidence | Claude standard sessions 9.7–15.4 s; Codex 24.8–25.1 s; no fresh test execution |
| Deny + current status | 2/2 stopped; no variant or Squeal pull | 3/3 stopped; no alternate test run | Clear non-execution, but requested run remained unmet |
| PreToolUse context | 2/2 ran Vitest | 2/2 ran Vitest | Context accompanies the tool result; cannot undo the selected call |
| PostToolUse note | 2/2 ran Vitest | 2/2 ran Vitest | Explained redundancy after spending it; future behavior unmeasured |
| Stop `requireFullSuite` | 2/2 direct runs followed by blocked `squeal run --all` approval | 2 usable subjects ran direct Vitest, then Squeal checkpoint and wait | Added work; Claude needs a reachable, allowed CLI; one further Codex subject excluded for live-CLI use |

**Read in source code.** Stop never enqueues a checkpoint, and `stop_hook_active` suppresses another policy block. Both Claude sessions ended with the checkpoint unmet. This is a prompt to complete the gate, not proof that completion cannot escape. A “final gate Squeal runs instead” would require a different mechanism.

## Recommendation and remaining uncertainty

**Inferred.** Rank mechanical prevention as rewrite ≈ deny, then context notes (no prevention). Rank usefulness here as transparent checkpoint reuse **after fixing the result contract**, project-approved explicit checkpoint instructions/Stop, then optional contextual advice; deny is last because it blocked without completing verification. Suggested opt-in key for a later spec: `testCommand.reuseResults: false`. Keep rewriting, test-command denial and repetitive pre/post notes off by default; retain explicit fresh-run and repository-gate escapes. Existing `stop.requireFullSuite` remains a separate project choice, not an automatic takeover switch.

**Not determined, because** this small, exact-command fixture did not test editing tasks, adoption over subsequent turns, realistic long-suite timeout recovery, interactive prompts, adversarial command parsing, or semantic equivalence of arbitrary Vitest configurations. The prior dogfooding's independent runs caught false Squeal state; do not remove that cross-check by default.

Sources: [official URLs and source locations](probes/hook-levers/sources.md); [session evidence and meters](probes/hook-levers/logs/sessions.json); [direct substitute evidence](probes/hook-levers/logs/substitute.json). Verification output and the two full-suite failures are in [the probe README](probes/hook-levers/README.md).
