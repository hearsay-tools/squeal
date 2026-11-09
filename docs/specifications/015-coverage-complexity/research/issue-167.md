# Issue 167: one quality engine and gate

Treat #167 as a consolidation feature that needs an approved spec amendment.
The current command and no-loader gaps are confirmed. The proposed whole engine
and the external Cezarion failures were not reproduced.

Examined 2026-11-09: Squeal **0.1.420**, commit
`674ffbc690fc78775a7432e42aa5c5ca43d31546`, Node **v24.22.1**.
All source findings below refer to that commit. Issue and board states are the
snapshot read on that date. Work was bounded to 15 minutes.

## Questions and verdicts

| Question | Answer and evidence tag |
| --- | --- |
| 1. Is this a runtime regression? | **read in official docs**: #167 calls it a requested consolidation feature. Its earlier inspection was 0.1.419/0.1.420; it recorded no `code --json` snapshot. This triage confirms narrow gaps, not a failed implementation of the proposed engine. |
| 2. Does a supported one-shot quality gate exist? | **verified by experiment**: source CLI `quality --json` exits 2, `unknown command "quality"`. **read in source code**: the command dispatch/help has no shared CC/CRAP gate; `code` reads stored reports and returns 0 for an available answer, not a quality verdict. |
| 3. Are present scope and acceptance rules equivalent? | **read in source code** and **read in official docs**: no. Runner-listed tests are excluded; `--changed` and optional blocking use session history; child-only coverage is a non-goal. The issue requests changed JS/TS functions against the PR target, including test callbacks. |
| 4. What does no loader mean now? | **verified by experiment**: `fileCondition([], true)` is `ready`; without a listing it is `pending`. An empty coverage join gives `coverage: 0`, `ran: false`; CC 7 gives CRAP 56. The requested rule is unknown, with no numeric CRAP. |
| 5. Which existing parts can be shared? | **read in source code**: tree-sitter counter version 3, coverage provider version 3, own-line join, and score with the 95% cutoff exist. **inferred**: these are reusable inputs, but extracting them does not itself supply PR-base policy, trusted exceptions or a complete one-shot collector. |
| 6. Is this a duplicate, and what remains held? | **inferred** from the fetched issues and board: #125/#144/#149/#165 overlap parts, but none requests the common engine and evaluator. **read in official docs**: these rows remain proposed; #167 records owner acceptance of common rules but explicitly withholds final architecture approval and release authority. |

## Findings

### 1–2. Command gap and stored evidence

**verified by experiment, 0.1.420.** The throwaway
[probe](probes/issue-167/probe.mts) ran these source CLI commands, without a build:

```sh
pnpm exec tsx src/cli/index.ts code --help
pnpm exec tsx src/cli/index.ts quality --json
pnpm exec tsx src/cli/index.ts code src/core/code/crap/score.ts --json
```

Results were exit 0, exit 2, and exit 0 respectively. Help says `--changed`
keeps functions whose state changed “since this session registered”. The path
report was available, schema `v: 1`, and reported `crapScore`: CC 2, CRAP 2.032,
4 of 5 lines covered and 33 test files. This is a stored snapshot, not evidence
that this command ran those tests. Exact output is in
[results.json](probes/issue-167/results.json).

The first probe load was **3.46**, against **24 CPUs**. Each CLI invocation
checked load again; the maximum was **3.98**. No live probe was skipped.
The runner command was:

```sh
pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-167/probe.mts > docs/specifications/015-coverage-complexity/research/probes/issue-167/results.json
```

**read in source code, 0.1.420.** `src/cli/code.ts`, `answer`, reads the main
and code stores through `readCodeReport`. With pending paths and a live daemon,
it can request a sync and wait for its pass. It does not create a standalone
measurement engine. `print` returns 0 whenever a report exists. The CLI also
has `ci record`, but help describes running a Vitest command and writing parts,
not evaluating a common CC/CRAP acceptance policy (`src/cli/main.ts`).
`package.json` is private and declares no `exports` contract for quality.
This establishes the supported interface gap; it does not prove internal
functions cannot be called by another program.

### 3–5. Reuse needs explicit policy changes

**read in source code, 0.1.420**, unless a row says otherwise:

| Area | Existing behavior | Difference requested by #167 |
| --- | --- | --- |
| Counted files | `pass/listed.ts` tracks successful runner listings; `pass/plan.ts` supplies their tests to `pass/included.ts`, whose `never` set excludes them. | Include changed test functions and callbacks. A nested function already has its own count under D3; file exclusion is a separate limit. |
| Comparison | CLI `scopeLines` names session registration. **read in official docs**, D5/D6/D7: transitions compare last known states; optional Stop blocking counts checks that went to fail since registration and exempts those already failing then. | Compare functions with the PR target; keep unchanged debt outside the gate and evaluate inherited refactors or approved growth. `code --changed` is not that selection. |
| No loaders | **verified by experiment**: empty loaders after listing are ready; empty join means zero coverage. `crapScore(7, 0) = 56`, `crapScore(7, 0.95) = 7`. | No mapping means unknown, not numeric CRAP from assumed zero. Probe verifies the primitives, not a new end-to-end fixture. |
| Coverage unit | `crap/join.ts` counts each function's own lines, excluding lines strictly inside nested functions. D9 agrees. `score.ts` still calls them “statements” in its comment. | Reuse own-line semantics and the 95% cutoff; do not infer statement coverage from that comment. |
| Coverage scope | **read in official docs**, Non-goals and D8/D9: child-only execution is unmeasured; excluded suites add no unknown state because their closures are not read. D9 permits certain proven passes before all records arrive. | Collect supported child evidence and define required evidence for a gate. A passing function state alone cannot prove the issue's required evidence is complete. |
| Versions/distribution | `count/index.ts`: `COUNTER_VERSION = 3`; `coverage/record.ts`: `COVERAGE_PROVIDER_VERSION = 3`. Codex runtime manifest code verifies schema and SHA-256 file entries. | Define the public report, policy/approval versions, tested tree and trusted import contract. Existing digest verification alone does not prove semantic evidence validity. |

**inferred, 0.1.420.** The deciding tradeoff is reuse without treating the
current daemon's narrower measurement scope and session policy as the requested
PR gate. Adding a command around `code` would retain the policy differences.
No new calculator is justified by this evidence.

### 6. Related issues and holds

**read in official docs**, fetched issue bodies and current board:

| Issue | Boundary with #167 |
| --- | --- |
| [#125](https://github.com/hearsay-tools/squeal/issues/125) | Bounded foreground execution of complete named test files and safe handoff. Its row remains proposed, explicitly separate from 011-273. Scheduling overlap, not a quality evaluator. |
| [#144](https://github.com/hearsay-tools/squeal/issues/144) | Child-only coverage and honest report scope. Collection part overlaps directly; the current child-coverage non-goal still stands. |
| [#149](https://github.com/hearsay-tools/squeal/issues/149) | Standalone fixture inputs reported untested. Its row favors explicit fixture exclusions and folds child-scope evidence into #144. It does not supply common gate policy. |
| [#165](https://github.com/hearsay-tools/squeal/issues/165) | No-loader/unmeasured Python coverage versus numeric zero-coverage CRAP. Shared uncertainty concern, but #167's gate is JS/TS; Python scope must not be silently absorbed. |

**inferred.** Keep #167 as the consolidation owner and link those narrower
issues. Do not close them as exact duplicates on this evidence.

**read in official docs.** #167 records accepted rules: CC ≤20, CRAP ≤30,
changed functions against the PR target, failed tests block, incomplete required
evidence cannot pass, a default total budget of 600 seconds, and verified debt
exceptions that preserve measurements. It calls the architecture and command
name proposals, not an approved spec or release authorization. Spec 015 D1/D6/D7/
D8/D9 and its non-goals need reconciliation through the repository's design
process. The child-coverage and line-level-selection non-goals remain in force.
The proposed related rows authorize no implementation. This triage changes no
baseline policy, source scope, runtime, spec, board or external gate.

## Recommendation and open questions

**inferred, 0.1.420:** proceed to a coordinator-owned spec amendment for one
shared engine and evaluator, preserving the issue's accepted common rules.
The coordinator must settle how PR-target policy coexists with session delivery,
test-file coverage, trusted approval evidence, imported evidence completeness,
and child-process fidelity before implementation. Preserve Cezarion's current
gates until the replacement is available, as #167 requires.

Not determined, because outside this bounded triage: exact reproduction of
Cezarion's TypeScript, mixed-runner, timeout, import-resolution, malformed child
record and source-map limitations; full daemon/local/CI parity; cost; public API
shape; and the validity of any real debt approval. No full suite, build, runtime
restart, product edit or external repository edit was performed. Verification
was the assertion probe and CLI reads above, not a product test-suite pass.

## Sources

- [Issue #167](https://github.com/hearsay-tools/squeal/issues/167), fetched with
  `gh issue view 167 --repo hearsay-tools/squeal --json number,title,body,state,comments,url`.
  Related issues used the same command without `comments`.
- [Examined repository commit](https://github.com/hearsay-tools/squeal/tree/674ffbc690fc78775a7432e42aa5c5ca43d31546):
  `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/board.md`;
  spec 015 `spec.md` D1–D9/Non-goals and `status.md`.
- At that commit: `src/cli/{main,code}.ts`, `package.json`,
  `src/core/code/pass/{listed,plan,included}.ts`, `src/core/code/count/index.ts`,
  `src/core/code/crap/{file,join,score}.ts`, `src/core/code/coverage/record.ts`,
  `src/harness/codex/adapter/manifest.ts` and `runtime-release/manifest.ts`.
- [Probe README](probes/issue-167/README.md) and saved results above.
