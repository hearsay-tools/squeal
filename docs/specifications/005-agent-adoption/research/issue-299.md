# Issue 299: repeated plugin-version advisory

Attach this evidence to the existing advisory investigation and preserve
`gh-131`'s human hold. Normal repetition did not reproduce; the exact warning is
already on stderr and deduplicates when its marker persists.

Research date: 2026-11-27. Checkout `9a55a53a4ae5c976702c1a0957c2354537db3e62`,
package 0.1.655. Launcher format 10, SHA-256
`e66af28c2df9b6f34c4027a6ac613769281025f2157199d2af7a45e4dfa33ecd`.
Release `squeal--v0.1.654` has identical launcher bytes. Node 26.13.0, Linux,
16 CPUs. Initial host load was 1.91; probe load was 1.44 before all six calls.
No tests, full suite, build, daemon, actual status/lint runtime or live update ran.

## Questions and findings

| Question | Answer | Tag and examined version |
| --- | --- | --- |
| Does #299's exact warning repeat in one stable Claude Code session? | With writable state, only the first of three calls warns; subsequent `lint` and `status --json` calls are silent. | **verified by experiment**, format 10, 0.1.654/0.1.655 identical launcher |
| Is the advisory on stdout? | No: the exact advisory is on stderr, with only the stub CLI's JSON on stdout. | **verified by experiment**, same launcher |
| Can failed persistence cause repetition? | Yes: a directory in place of the marker produces the exact warning on all three calls. | **verified by experiment**, same launcher |
| Is this a separate warning from #131/#85? | #299 names the cross-harness variant of the same `notice()` function; closed #85 added its deduplication. #131 concerns the pinned-session variant, whose cause remains unknown. | **read in source code**, same launcher; issue records fetched 2026-11-27 |
| What caused the reporting incident? | Not determined: no resolved launcher/hash, separated streams, effective session identity or marker state was supplied. | **inferred**, #299 report and bounded probe |

### 1. Exact three-version warning and streams

**verified by experiment, 0.1.654/0.1.655 launcher.** An isolated fixture supplied
Claude Code 0.1.654, Codex 0.1.647 and Antigravity 0.1.640, with a fixed
`CLAUDE_CODE_SESSION_ID=issue-299-session`. It ran these commands as separate
processes, in this order, once with writable state and once with blocked state:

```text
/bin/sh <fixture>/bin/squeal status --wait 60000 .github/scripts/baseline-growth.test.cjs
/bin/sh <fixture>/bin/squeal lint
/bin/sh <fixture>/bin/squeal status --json
```

First stderr, verbatim:

```text
squeal: this command runs squeal 0.1.654; plugins: Claude Code 0.1.654, Codex 0.1.647 and Antigravity 0.1.640. Run squeal update to bring the plugins to one version.
```

First stdout, verbatim:

```json
{"syntheticRuntime":"0.1.654","args":["status","--wait","60000",".github/scripts/baseline-growth.test.cjs"]}
```

| Marker state | `status --wait` stderr | `lint` stderr | `status --json` stderr |
| --- | --- | --- | --- |
| Initially absent, writable | Exact advisory | Empty | Empty |
| Directory blocking file rename | Exact advisory | Exact advisory | Exact advisory |

All six exited 0, selected synthetic 0.1.654 and preserved the arguments. The
writable marker at `<fixture>/state/squeal/launcher-notices.json` became an array
containing the synthetic session ID and exact warning line, then stayed unchanged.
The blocked marker stayed a directory. Separate stdout remained parseable JSON
in every call. Full commands, streams, load and before/after marker state are in
[`output.jsonl`](probes/issue-299/output.jsonl).

### 2. The existing contract already owns this case

**read in source code, format 10.**
`plugins/claude-code/bin/squeal-launcher` reads the first nonempty session ID from
Claude Code, Codex, OpenCode, Pi and Antigravity, falling back to an empty machine
scope. `notice()` compares scope plus exact line, keeps the latest 64 scopes,
writes a temporary file and renames it to `launcher-notices.json`. It suppresses
an existing matching pair. Failed persistence is caught, then
`process.stderr.write(line)` emits the warning. Cross-harness skew and a Codex
pin behind the newest version call this same function. No command-specific
`status`/`lint` warning owner exists at this seam.

**read in official docs, repository specs at the checkout above.** 005 D3
requires once per unchanged version pair/session, or machine outside a session,
and explicitly says “a mark it cannot write prints at every call, as before.”
Its 005-84 amendment records the 64-scope limit, A/B/A repetition and concurrent
calls that can both print. 005 D6 owns wording. 002 D7–D9 constrain runtime
identity and require preserving active Codex pins. This probe does not test
concurrency, eviction, changed scope/version states or pinned Codex sessions.

**read in source code, 0.1.655.** Claude Code's separate
`plugins/claude-code/bin/squeal` directly launches its adjacent CLI and contains
no cross-harness notice logic. The issue's `squeal` spelling alone does not
identify which installed launcher ran. This is why the resolved executable is
material incident evidence.

### 3. Relationship to #131 and closed #85

**read in official docs, issue records fetched 2026-11-27.** #85 is closed and
its release comment names row 005-84 in 0.1.339. #131 remains open with a human
evidence hold on `gh-131`: no change until the repeated warning, launcher path,
runtime versions and marker state arrive. Its 2026-11-20 comment adds reported
skew on every call at 0.1.568/0.1.565, without establishing that state. Prior
[`issue-131.md`](issue-131.md) found ordinary pinned-session deduplication working
and repeated warnings only when persistence was blocked.

**inferred from that evidence.** #299 supplies an exact warning and versions for
a different incident and harness, strengthening the same advisory investigation.
It does not prove a distinct implementation defect or explain #131's incident.
Keep both issue references, the shared owner and the existing hold; do not infer
permission to implement or close either report from this reproduction.

## Recommendation, limits and sources

**inferred from the experiment and source, 0.1.654/0.1.655.** Request two
separately captured stderr/stdout occurrences from the affected session, its
resolved executable path and launcher format/hash, stable effective scope, and
the selected marker's location, contents and write/rename accessibility. The
unchanged advisory is already stderr-only. The issue's combined display cannot
establish stdout contamination. Whether its wrapper merged streams is unknown.
The tradeoff is reliable notice delivery when persistence fails versus repeated
noise; changing that documented policy requires a human decision. No second
deduplication mechanism is justified by this bounded probe.

The experiment is a launcher-seam reproduction, with synthetic manifests and
echo-only CLIs. It validates selection, argument forwarding and notice behavior;
it makes no claim about status/lint results, the actual reporting host's marker,
or installed launcher freshness. Probe invocation exited 0. `git diff --check`
was clean. No product files, specs, statuses, skills, board or real plugin state
were changed by this research.

- [#299](https://github.com/hearsay-tools/squeal/issues/299), [#131](https://github.com/hearsay-tools/squeal/issues/131), [#85](https://github.com/hearsay-tools/squeal/issues/85), fetched with `gh issue view --repo hearsay-tools/squeal --json body,title,comments,state,url` (field selection varied).
- [005 D3/D6](../spec.md), [005 amendment log](../status.md), [002 D7–D9](../../002-codex-adapter/spec.md), and `docs/board.md` row `gh-131`.
- [Launcher at 0.1.654](https://github.com/hearsay-tools/squeal/blob/squeal--v0.1.654/plugins/claude-code/bin/squeal-launcher), compared via `git show squeal--v0.1.654:plugins/claude-code/bin/squeal-launcher | sha256sum` with `sha256sum plugins/claude-code/bin/squeal-launcher`.
- [Probe and command](probes/issue-299/README.md), [script](probes/issue-299/probe.py), [captured output](probes/issue-299/output.jsonl).

## Coordinator verification

`git diff --check` passed. The session CLI command
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/board.md docs/specifications/005-agent-adoption/research/issue-299.md docs/specifications/005-agent-adoption/research/probes/issue-299/probe.py`
exited 3: no test closure holds these paths. It reported zero known failures
and 11 of 2326 test files not current (one running, ten unknown). This is no
affected-test verdict or suite pass. The launcher printed a version-skew note
on this one coordinator check; one call does not establish repetition. No
repository suite was run for this documentation change.
