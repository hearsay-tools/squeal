# Keep a notice owed while its receipt is unknown

Row 011-288, wave 63 R3. Examined 2026-10-31 at Squeal `ecf1d10b4` (0.1.384).
**Recommendation: deliver again at the next eligible boundary when receipt is
unknown.** All four adapters can lose a notice after committing its delivery.
Accept possible duplicates rather than silently retiring an unreceived transition.
This is a rule for the coordinator's spec, not an implementation design.

Versions: probes use Node 24.22.1 and Vitest 5.0.3; Pi host source is installed
`@earendil-works/pi-coding-agent` 1.0.4; Codex host source is fetched tag
`rust-v0.160.1` (`d27764b`, the version named by spec 002's research); Claude Code
and Codex official hook docs are unversioned pages fetched 2026-10-31. No live
Claude Code, Codex or Pi session was started. The prior OpenCode experiment used
OpenCode 1.18.35 and Squeal `33cdf29a1`; its relevant delivery/adapter sources are
unchanged at this research commit.

## Questions answered

| Harness / question | Gap from committed delivery to agent text | Evidence and deadline exposure |
| --- | --- | --- |
| Claude Code | Core commit → format/close store → hook JSON on stdout → hook completion and host parsing → model context. Idle waiter instead writes stderr and exits 2 → `asyncRewake` system reminder. | **read in source code**, Squeal `ecf1d10b4`; **read in official docs**, fetched 2026-10-31: a timed-out hook's output is discarded. Normal hooks have 2 s; slow Stop 630 s; waiter 3,600 s. A kill can fall after commit on any path. |
| Codex | Core commit → format/close store → JSON stdout → process/pipe completion → host context or Stop continuation. No idle wake. | **read in source code**, Squeal `ecf1d10b4`, Codex 0.160.1: the 2 s bound covers stdin and `wait_with_output`; timeout gives empty stdout and process-group kill. **read in official docs**, fetched 2026-10-31: timeout is seconds. Slow Stop is 630 s. |
| Pi | Core commit in worker → format/close store → worker `postMessage` → host pending-call resolution → extension result or `sendMessage` → Pi queues/appends the entry → model request. | **verified by experiment**, Squeal `ecf1d10b4`: real `DeliveryHost` drops the answer and terminates the worker at 2 s after commit. **read in source code**, same Squeal and Pi 1.0.4: a canceled idle wait drops a pending answer even without this deadline; queued text is not proof of model receipt. |
| OpenCode | Core commit → bridge stdout/exit → plugin parses answer → tool result/text part, or `promptAsync` acceptance → model request. | **verified by experiment**, prior OpenCode 1.18.35 probe at `33cdf29a1`: default idle 500 ms expires after commit, before stdout; next prompt lacks the transition. **read in source code**, `ecf1d10b4`: tool/prompt bridge bound 2 s; idle `stop.waitMs + 500 ms`; canceled waiter kills bridge. |
| Smallest common rule | Receipt unknown means report still owed; try at the next eligible boundary. Only confirmed acceptance can retire it. | **inferred**, from all four paths above. Merely moving the write after stdout does not establish acceptance. |
| Duplicate cost | A repeated SQUEAL report, possibly a second denial or continuation, depending on delivery path. | **inferred**, from the output contracts below at the examined versions. No duplicate-replay repair was implemented or tested. |

## What the evidence establishes

**read in source code**, Squeal `ecf1d10b4`. `delivery.ts:260` writes the
consumer view inside the transaction, before returning its delta. The same rule
covers `onToolBoundary`, `startTurn`, regression `peek`, and idle `waitForDelta`.
Registration also seeds the view before returning the header. Liveness, holds,
revision, counts, edit notes and code/lint acknowledgements have similar local
"told" effects. Therefore a transition-only repair would not establish receipt
for every part of a report. The store transaction prevents competing deliveries
from consuming the same transition; it is not a transaction with the harness.

**verified by experiment**, Squeal `ecf1d10b4`, Node 24.22.1. The [six-case
probe](probes/delivery-receipt/README.md) used real stores and handlers. A private
marker proves that each failing view committed and its report contained
`PASS -> FAIL` before a 3 s asynchronous pause. Claude/Codex used a modeled 2 s
host kill; Pi used the real Squeal host deadline. These are transport probes,
not live-harness observations.

| Case | Normal control | Held after commit | Next boundary after held case |
| --- | --- | --- | --- |
| Claude Code handler | Report received, 72 ms | No stdout, killed at 2,008 ms | No transition; view already `fail` |
| Codex handler | Report received, 67 ms | No stdout, killed at 2,012 ms | No transition; view already `fail` |
| Pi handler + DeliveryHost | Report received, 75 ms | Null answer at 2,003 ms | No transition; view already `fail` |

**read in official docs**, Claude Code hooks, fetched 2026-10-31: “Claude Code
cancels a `command`, `http`, or `mcp_tool` hook that reaches its `timeout`,
discarding the hook's output”. This makes even a successful stdout write weaker
than host acceptance. **read in source code**, fetched Codex 0.160.1
`command_runner.rs:279–340`: timeout wraps output collection, returns empty
stdout, and drops a guard that kills the process group. Both hooks' own wrappers
also turn a post-commit exception into silence. No successful write callback is
an acknowledgement from either model context.

**read in source code**, Squeal `ecf1d10b4`, Pi 1.0.4. Pi's `host.ts` resolves a
canceled wait as null immediately and removes its pending id. A later worker
message cannot restore it. `extension.ts` also drops an answer after shutdown or
a replaced wait. Its idle `sendMessage` catch says “the news waits for the next
prompt”, but the already-committed view cannot provide that guarantee. Pi's
`sendCustomMessage` queues `nextTurn` text in memory; boundary entries are appended
after handlers return. A worker reply or queue insertion is still earlier than
model receipt. These additional cancel/shutdown paths were read, not exercised.

**read in source code**, Squeal `ecf1d10b4`. OpenCode already holds an unsuccessful
`promptAsync` report in `turn.held` for another prompt/tool boundary and recognizes
its own late-arriving message. That helps only after the bridge returned the
text; it cannot recover the report lost before stdout. Its held array is also
in-process state. The earlier [OpenCode report](ci-opencode-continued.md), sections
2–3, proves the missing bridge handoff with a real harness; this task did not
repeat that expensive experiment.

## Likelihood, duplicates and the deciding tradeoff

**inferred**, from the examined budgets and source paths. OpenCode's default idle
path has the least time: 500 ms includes process startup and continuation work.
Claude/Codex/Pi normally have 2 s; Pi reuses its worker. Stop can spend up to
1,500 ms waiting, reducing that slack. Pi's actual settle bound is a fixed 2 s
(`SETTLE_DEADLINE_MS`), despite spec 009 D4's older wording of wait plus 500 ms.
Claude's waiter stops waiting at 3,540 s, 60 s before its host timeout; this reduces
ordinary expiry overlap but cannot exclude a kill or a long scheduling delay
between commit and exit. No production loss rate, post-commit duration distribution,
or measured ranking among the three 2 s paths is determined. The forced pauses
prove possibility, not frequency. No CPU load was generated.

**inferred**, from Squeal's output mappings at `ecf1d10b4` and Pi 1.0.4. A duplicate
would repeat the same revision/check/transition facts, not mean another test run:

- Claude Code: another `additionalContext` report; an idle system reminder; at
  Stop, possibly another continuation. A retried regression `peek` could deny
  the reissued edit again if receipt remains unknown.
- Codex: another hook context report (capped at 8,000 characters), or a repeated
  Stop `reason` continuation; a retried `peek` can repeat the denied tool reason.
- Pi: another displayed `custom_message` of type `squeal`, converted to user text
  for the model; an idle follow-up or settle continuation can cost another turn.
- OpenCode: another SQUEAL text part/tool-result suffix, or user-text
  continuation/wake. Its current `held` fallback already accepts some duplicate
  risk when a request was accepted but its response was lost.

**inferred recommendation**, based on these proofs. Preserve the owed report
until acceptance is known; where it is unknown, deliver again at the next eligible
boundary. Keep its original provenance. Accept duplicate evidence as the cost of
preventing silent loss. “Print, then mark delivered” only moves the gap: a host can
discard printed output. Acknowledging a worker/bridge reply closes that one hop,
not the later host-to-context gap. A plain next tool call is also not proof that
the earlier hook succeeded: timeout permits that tool flow to continue.

Current hook contracts expose no common durable context receipt. Thus exact-once
model delivery, bounded repeats and arbitrary-crash survival cannot all be promised
from those contracts. A single unconditional replay followed by retirement still
loses a report if that replay fails. The coordinator must define what counts as
acceptance and the duplicate policy; this report selects the rule, not a storage
schema, new protocol or receipt mechanism. The guarantee needs a later reachable
boundary and a retained consumer/report; it cannot make a dead session read text.

## Open questions and verification

Not determined: production incidence; current installed Codex host internals
beyond the fetched 0.160.1 source and current official contract; Claude's internal
context persistence; which host evidence can confirm acceptance on each delivery
path. None of those unknowns changes the proven commit-before-transport gap.
The exact cause of the original OpenCode CI miss remains undetermined.

Probe command: `env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run --config
docs/specifications/011-core/research/probes/delivery-receipt/vitest.config.ts
--silent=false`: **6/6 passed, 8.45 s**, one run. No full suite, live harness,
product edit, timeout change, retry or repository build. The probe's source and
output are committed with this report. `squeal status --wait 60000` on the report
and both probe sources returned exit 3: no test closure holds those files; known
failures 0, all 1,347 test files current. That is no affected verdict for this
research, not a new suite run. Lint and typecheck exclude `docs/`; the explicit
probe run verifies the research code. `git diff --check` passed.

## Sources

- [Claude Code hooks](https://code.claude.com/docs/en/hooks.md), timeout/output and
  `asyncRewake`; [Codex hooks](https://developers.openai.com/codex/hooks), timeout
  and context contracts. Fetched excerpts and hashes: [sources.txt](probes/delivery-receipt/sources.txt).
- [Codex 0.160.1 command runner](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/hooks/src/engine/command_runner.rs), fetched raw source; especially lines 269–340.
- [Pi source repository](https://github.com/earendil-works/pi), installed package
  1.0.4: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
  (`_applyBoundaryDrafts`, `sendCustomMessage`) and `dist/core/messages.js`
  (`convertToLlm`, custom-to-user conversion).
- Squeal at `ecf1d10b4`: `src/core/delivery/delivery.ts`; `src/harness/shared/{deliver,stop,waiter,hook}.ts`;
  `src/harness/claude-code/{main,run}.ts`, `hooks/{stop,waiter}.ts`;
  `src/harness/codex/{main,run,output,handlers}.ts`;
  `src/harness/pi/{host,worker,extension,run}.ts`;
  `src/harness/opencode/{bridge-client,bridge,turns,hooks}.ts`;
  both process plugins' `hooks/hooks.json`.
- Contracts: [011 C8](../spec.md), [002 D3–D4](../../002-codex-adapter/spec.md),
  [008 D3–D5](../../008-opencode-adapter/spec.md), [009 D3–D5](../../009-pi-adapter/spec.md),
  [012 CC2](../../012-claude-code-adapter/spec.md), and their amendment logs.
