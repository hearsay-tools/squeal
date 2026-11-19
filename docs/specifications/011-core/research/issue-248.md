# Issue 248: type and comment edits select value importers

**Recommendation:** fold this evidence into proposed gh-137 and completed
research 011-149; any implementation needs a human decision on safe key
semantics. Do not use the issue's changed-line classifier as a skip rule.

**Verdict:** reproduced on a four-file fixture with installed Squeal **0.1.565**.
A type-only edit and a comment-only edit in a mixed type/value module re-keyed
its value importer, declared-input consumer and observed source reader. An
unrelated test retained its key and did not rerun. The incident's **0.1.563**,
143 value importers, 1,212 selected files and 226,000-run estimate were not
reproduced. This is documentation-only evidence and authorizes no product work.

Examined 2026-11-19, source checkout **6b490e0fa1d58cf4c889140a56be445401d6f49a**
(package 0.1.566), Node **26.13.0**, Vitest **5.0.3**, Vite **8.3.2**. The live
runtime was the installed 0.1.565 bundle, not a new build. Source comparisons
show no changes in the four explanation files below from 0.1.563 to 0.1.565
or from 0.1.565 to the examined checkout. This does not prove whole-version
equivalence.

## Questions answered

| Question | Answer and evidence tag |
|---|---|
| Do harmless type/comment edits select value importers? | Yes for both fixture edits: three changed keys and three selected files, including the importer. **verified by experiment**, 0.1.565. |
| Do raw-source dependencies survive? | Both the declared-input-only file and undeclared `readFileSync` reader re-keyed. The reader recorded the changed text. **verified by experiment**, 0.1.565. |
| Is the emitted code equal? | Vite's standalone oxc transform emitted identical code and mappings for these edits. Node stripping preserved the comment difference and the length difference of another type edit. **verified by experiment**, Vite 8.3.2 / Node 26.13.0. |
| How does this overlap existing work? | Same byte-key invalidation as #137; 011-149 already investigates type and comment keys, savings and correctness limits. The mixed-module type example and newer repository estimate add evidence. **read in source code**, cited retained reports; **inferred**, triage recommendation. |
| Does the line classifier establish savings or safe reuse? | No: the classifier implementation and history dataset were not supplied or rerun. The report measures commit-weighted selection, not observed executions or CPU/wall time. **read in official docs**, issue body; **inferred**, measurement limits. |

## Reproduction and controls

The isolated fixture has `lib.ts` with a type declaration and `value = 1`, plus
four one-test files: an importer of `value`; a declared-input-only consumer of
`lib.ts`; a source reader with no declared input or value import; and an
unrelated control. Only this tiny fixture ran. No suite, install or build ran
in the project. It uses a separate store and runtime directory, then stops its
daemon and deletes the fixture.

**verified by experiment, 0.1.565:** the initial preflight load was **9.13/24**;
the first attempt started at **11.27/24**. The retained successful run started
at **10.00/24** at 09:22:02Z and ended at **9.92/24**, about nine seconds later.
The script repeats the load guard before startup. This cheap fixture required
neither a quiet-host benchmark nor a heavy VM run. No live run started above
the CPU count.

| Edit after baseline | Changed keys / selected files | Executed result |
|---|---|---|
| `Shape.x: number` → `string` | importer, declared consumer, reader; 3/3 | All pass; importer reads 1; reader sees `string` |
| `// original note` → `// changed note` | same 3/3 | All pass; importer reads 1; reader sees changed comment |
| `value = 1` → `value = 2` | same 3/3 | Importer fails and automatic retry also reads 2; two controls pass |

The unrelated file kept its baseline key at all three revisions and never
executed after baseline. Each final source-path status lists exactly those
three selected files, all current, zero pending. The behavior control reports
one known current failure and status exit 1. The probe and cleanup exit 0.
The source reader establishes continued invalidation and visibility of the
new bytes; it does not itself assert that the original bytes stay unchanged.

The first attempt wrongly waited for the declared-only test to run naturally
within 45 seconds. It remained catch-up while the importer and reader ran.
The corrected probe first captures all three changed keys and pending states,
then uses a named `status --wait 10000` to promote the three files. This does
not force keys or manufacture the selection. The initial timeout is retained;
no natural scheduling-latency claim is made.

## Mechanism and classifier limits

**read in source code, unchanged across 0.1.563/0.1.565/examined checkout:**
`src/core/hash/blob.ts:19` hashes every byte. `src/core/keys/closure.ts:180`
merges runner paths, declared inputs and observed paths into a sorted set.
`src/core/keys/key-index.ts:206` recomputes reverse references of changed paths.
`src/core/scheduler/edit-cut.ts:92` distinguishes immediate edit work from
catch-up, explaining the declared-only file's initial queue. These follow
011 C2's byte-based revisions, C3's input keys, C4's current/pending rules and
C12's runtime-read evidence. This is existing conservative behavior, not
proof of a regression in 0.1.563.

**verified by experiment, Vite 8.3.2 / Node 26.13.0:** for this fixture the
comment precedes a removed type declaration, so oxc drops it and emits the
same `export const value = 1;`. An internal function comment survives oxc and
changes emitted code. Changing the type to the longer `unknown` keeps oxc
code and mappings equal but changes Node's whitespace-preserving strip output.
Thus “type-stripped” must name the actual transform and options. This probe
checks the standalone transform, not arbitrary project plugins.

**read in source code, prior 011-149 / #137 fixtures:** source reads, `?raw`
imports and tests invoking typecheck can change outcomes despite equal emitted
JavaScript. Removing surviving comments loses `Function.prototype.toString`
changes. Source maps, decorators with metadata, transformation options and
tool directives add other observable differences. Raw bytes must remain for
relevant source reads, declared inputs and test source. Do not apply equality
at the watcher level and erase changes before those consumers see them.

**inferred from those experiments and the issue body:** a classifier that
only recognizes changed lines inside type declarations, `import type`, comments
or blanks does not prove equality under the runner's transform or prove that
no test observes the source. It also does not establish observed run counts:
commits are not watcher revisions, selection can overlap, cache reuse can avoid
execution, and edit/catch-up scheduling changes timing. The reported 6.4% has
a different denominator and date window from 011-149's measured 72-hour savings
(about 1.0% of Squeal's and 0.5% of Cezar's stored work for equal emitted code).
Neither figure replaces the other. No new aggregate saving is established.

## Decision, limits and sources

The deciding tradeoff is avoiding unnecessary importer work while preserving
current-result truth for raw-source and transform-sensitive consumers. #137
already supplies the slow-feedback consequence; this run adds no slow-tier
measurement. Human approval is still needed before a design or implementation.
The original classifier, transform configuration, 90-day corpus and actual
execution durations remain unverified. No original incident checkout or large
corpus was run.

- [Fetched issue 248](probes/issue-248/issue.json), [GitHub issue](https://github.com/hearsay-tools/squeal/issues/248): `gh issue view 248 --repo hearsay-tools/squeal --json title,body,url`.
- [Probe commands and isolation](probes/issue-248/README.md), [live results](probes/issue-248/result.jsonl), [transform results](probes/issue-248/transforms.jsonl), [initial timeout](probes/issue-248/initial-attempt.txt).
- [011-149 research](type-only-edits.md), [#137 research](issue-137.md), [011 C2/C3/C4/C12](../spec.md), [amendment log](../status.md). Prior findings are read evidence, not rerun experiments.
- Source comparison command, each produced no diff: `git diff --stat squeal--v0.1.563 squeal--v0.1.565 -- src/core/hash/blob.ts src/core/keys/closure.ts src/core/keys/key-index.ts src/core/scheduler/edit-cut.ts`; repeated with `squeal--v0.1.565 HEAD`.

Verification: both scripts pass `node --check`; both retained probe commands
exit 0, with the expected fixture failure noted above. `git diff --check`
passes. No repository tests, lint, typecheck or build were run for these
research-only additions.
