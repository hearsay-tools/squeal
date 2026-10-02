# Squeal product vision

> **That's what tests said.**

Squeal is a continuous validation layer for coding agents. It watches the codebase, runs the smallest useful set of checks in the background, and tells the agent when the known state changes.

The agent keeps working. Validation follows behind it. When a test starts failing, Squeal speaks. When that same test recovers, Squeal speaks again. When nothing has changed, Squeal stays quiet.

Squeal is part of the Hearsay product family.

## Why Squeal exists

Coding agents still treat validation as a synchronous chore:

1. make a change;
2. decide whether to run tests;
3. wait;
4. read the output;
5. resume.

Both ways of doing this are bad. Run checks after every edit and the agent spends half its turns waiting. Run them rarely and mistakes compound. In practice agents forget to validate, pick an incomplete command, miss a failure that was already there, or reach the end of a task and only then discover that the second edit broke something the tenth one built on.

Humans solved this years ago. Wallaby, `tsc --watch`, IDE test runners that re-run on save. None of them work for agents, because agents don't look at a sidebar. An agent needs the same loop in a form its harness can consume: event-driven, machine-readable, revision-aware, short, and not tied to any one model or test framework.

Squeal turns tests and other checks into a sensor the agent's workspace is always wearing.

## The product promise

**Keep coding. Squeal will tell you when validation has something new to say.**

Squeal gives an agent:

- notice the moment a check goes from passing to failing;
- closure when a failing check passes again;
- current status on demand;
- enough provenance to know which version of the code produced a result;
- fast feedback without blocking on the full suite every time.

The core interaction model:

> **Push transitions. Pull state.**

Squeal pushes only state changes that matter. The agent pulls the full current state whenever it needs context or has to decide whether a task is done.

## Who it is for

- developers building agent harnesses and coding-agent products;
- teams running long-lived or remotely hosted agents;
- autonomous development systems coordinating several workers;
- individual developers who want their agent to get test feedback without babysitting every run.

The primary consumer is another machine. Human-readable output matters, but stable semantics, structured events and trustworthy state matter more. If we ever have to choose, the machine wins.

## Product principles

### 1. Silence is a feature

Passing tests are not news. Neither is a failure that is still failing. Squeal speaks when information becomes newly actionable, and at no other time.

- `PASS -> FAIL`: notify;
- `FAIL -> PASS`: notify;
- `FAIL -> FAIL`: quiet, unless the failure itself changed;
- `PASS -> PASS`: quiet;
- first observation of a failure: notify;
- first observation of a pass: record it, don't notify by default.

Squeal groups events from one change for a short window. A broken import that takes down forty tests is one update, not forty interruptions.

### 2. Results are tied to code state

An old result never gets to pose as the current truth. Squeal tags every change, every run and every emitted event with a specific workspace revision or generation.

At any moment Squeal can tell apart:

- what it has validated for the current revision;
- what is still running or queued;
- what it last knew on an older revision;
- what it has never checked.

It says "no known failures", not "everything passes", unless it has actually run everything.

### 3. Feedback arrives without blocking work

Validation runs beside the agent, not inside every edit loop. The harness delivers pending Squeal events at the next safe point to steer or resume the agent.

Squeal never injects text into a model mid-generation. It hooks into the boundaries agent execution already has: tool results, model turns, resumptions, checkpoints, task completion.

### 4. Fast, relevant checks come first

Squeal returns the most useful evidence first. It orders checks by what changed and what has failed before. A sensible default:

1. checks that were failing;
2. syntax and parsing;
3. checks that directly cover changed code;
4. affected lint and type checks;
5. affected unit tests;
6. transitive and integration tests;
7. the full suite, at an explicit checkpoint or on policy.

Every ecosystem already ships most of the machinery for this. Watch modes, dependency graphs, coverage data, affected-test selection. Squeal uses those before it invents anything.

### 5. The harness orchestrates; existing tools validate

Squeal does not replace pytest, Vitest, Jest, Playwright, linters, type checkers or CI. They stay the source of truth for results.

Squeal is the layer around them that was missing:

- observing workspace changes;
- selecting and scheduling checks;
- keeping workers warm where the runner allows it;
- tracking state across runs;
- rejecting or qualifying stale results;
- emitting normalized state transitions;
- exposing current validation state to agents.

### 6. Integrations are model- and harness-independent

Squeal works with Codex, Claude Code, Pi, OpenCode, Cursor and whatever comes next, and none of them sits at the centre of its architecture.

The integration is deliberately small: an event stream for push, a status interface for pull, and optional commands for requesting broader validation. Three things. If a harness needs a fourth, that's a sign we're coupling too tightly.

### 7. The agent gets evidence, not a bare verdict

A failure event carries enough to act on:

- check identity;
- previous and current state;
- the revision;
- concise failure output;
- source location when available;
- whether the result is current, stale, or awaiting confirmation.

Full logs stay retrievable. They do not land in the agent's context unasked.

### 8. Autonomy has explicit boundaries

Squeal runs local validation on its own because the blast radius is small and reversible. Anything expensive, destructive, externally visible or production-facing needs explicit policy.

Resource limits, allowed commands, timeouts, concurrency, filesystem scope, environment access and secret handling are all visible and enforceable. A test runner is still code execution. Convenience does not get to erase that.

## The desired experience

An agent edits several files while Squeal validates in parallel. Most runs produce nothing. Then one test changes state:

```text
SQUEAL · 2 checks changed at revision 184

FAIL  tests/auth/test_login.py::test_expired_token
      PASS -> FAIL
      expected 401, received 500

PASS  tests/auth/test_logout.py::test_revoked_session
      FAIL -> PASS
```

The agent fixes the implementation. While the test keeps failing, Squeal says nothing. When it passes, one more event closes the loop.

At any point the agent can ask for status and get an honest snapshot:

```text
Revision: 187
Known failures: 0
Affected checks: 47 passed, 3 running, 12 queued
Last full suite: passed at revision 170
Current revision has not completed a full-suite run
```

Before declaring a task complete, the harness or agent reads that status and checks it against the project's completion policy. "Known failures: 0" plus "full suite not run on this revision" is a real answer, and a different one from "done".

## Core product capabilities

Squeal grows around a small set of durable capabilities.

**Continuous observation.** Detect relevant workspace changes and assign a monotonic generation to each validation state.

**Impact-aware scheduling.** Choose checks using static dependencies, test-runner intelligence, historical failures, runtime coverage or ecosystem plugins. Start simple. Improve precision without changing the external semantics.

**Stateful result tracking.** Keep the current known state for every observed check: last transition, revision, duration, diagnostic fingerprint.

**Transition events.** Emit normalized, deduplicated, revision-aware events when check states change. Batch related transitions. Put actionable failures first.

**Queryable status.** Expose current failures, running and queued work, validation coverage, last full-suite result, and what is unknown. Status is a snapshot, not an optimistic summary.

**Policy-driven checkpoints.** Let projects define what validation is required during work, before commit, before task completion, before merge. Squeal reports whether the policy is met. It does not quietly redefine "done".

**Adapter ecosystem.** Support test frameworks, languages, check types and agent harnesses through adapters on a stable core protocol.

## What Squeal is not

- a new test framework;
- a CI/CD platform;
- an autonomous bug-fixing agent;
- a replacement for the project's own test configuration;
- a guarantee that unexecuted tests pass;
- a dashboard that reports every green run;
- tied to one editor, language, model provider or harness.

Squeal may prompt an agent to look at a regression. It does not own the coding task. It gives timely, trustworthy feedback so the agent that does own the task can decide better.

## Boundaries and trade-offs

When forced to choose, Squeal picks:

- trustworthy state over optimistic claims;
- few transitions over exhaustive notifications;
- fast affected checks over re-running everything;
- adapters around proven tools over rebuilding their internals;
- stated uncertainty over false confidence;
- a small stable protocol over deep coupling to one harness;
- current actionable evidence over keeping every event in model context;
- project-defined policy over unrestricted autonomy.

Speed matters, but a fast stale result is worse than a slower one with correct provenance. Precision matters, but the system has to be useful before impact analysis is perfect. Those two are the trade-offs we expect to argue about most.

## Success looks like

- agents learn about regressions within a turn or two of introducing them, without running tests themselves;
- agents get recovery events without polling after every fix;
- duplicate notifications are rare;
- stale results do not mislead agents;
- agents can state accurately what has and has not been validated;
- teams swap models, harnesses or test frameworks without redesigning the feedback loop;
- background validation cuts total task time and late rework;
- projects define completion policies and agents actually follow them;
- nobody has to watch routine test runs.

Metrics: transition-to-delivery latency, duplicate-event rate, stale-result escape rate, affected-test precision and recall, validation cost per code change, regressions caught before task completion.

## Initial direction

The first version has to prove the interaction model. It is not a Wallaby clone.

It ships:

- a filesystem watcher;
- revision or generation tracking;
- one mature test ecosystem integration;
- affected-test execution using existing tooling where it exists;
- a persistent map of check states;
- `PASS -> FAIL` and `FAIL -> PASS` events;
- debounced event batching;
- a machine-readable status command or API;
- one reference adapter that injects pending events at safe agent-turn boundaries;
- explicit reporting of incomplete and stale validation.

Deeper dependency analysis, distributed workers, dashboards, more check types and broad harness support come after the core loop earns them.

## Long-term direction

Tests are the first check type, not the last. The same transition model fits type errors, lint violations, build failures, visual regressions, browser checks, performance budgets, security findings, runtime errors and dev-environment health. Each is a signal that flips between states, tied to a revision, worth reporting only on change.

The idea underneath all of it:

> Continuously observe the evidence around a changing codebase, maintain an honest current state, and interrupt the agent only when that state meaningfully changes.

If Squeal works, validation stops being a command an agent has to remember. It becomes part of the environment the agent works in.

## Decision filter

For any proposed feature:

1. Does it make validation feedback faster, more relevant, or more trustworthy?
2. Does it reduce noise or unnecessary blocking for the agent?
3. Does it preserve provenance and uncertainty?
4. Does it work across harnesses, or strengthen a clean adapter boundary?
5. Can project policy govern it?
6. Does it reinforce **push transitions, pull state**?

Mostly no? It doesn't belong in Squeal.
