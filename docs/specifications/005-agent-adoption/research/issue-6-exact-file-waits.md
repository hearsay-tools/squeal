# Issue 6: exact test-file waits

Recommend that a named path equal to a listed test file select that file alone, as D2 and the shipped `commands.md` already say, and keep closure lookup for every other path; the defect is one expression in `selectNamedFiles`.

Brief: `research/README.md` "Issue 6", 2026-10-16. Source examined at `a8ceaa80` (package 0.1.200); shipped plugin **0.1.199** (`~/.claude/plugins/cache/hearsay/squeal/0.1.199`); Node 24.21.0; Vitest from this commit's lockfile. Subject: [hearsay-tools/squeal#6](https://github.com/hearsay-tools/squeal/issues/6), labels `bug` and `friction` (filed from agent sessions), body and five comments, all from cezarion work on 0.1.199. Probes: [`probes/issue-6-exact-file-waits/`](probes/issue-6-exact-file-waits/README.md). No subject sessions; no suite of this repository run; no product file touched.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does an exact listed test path also select consumers when declared inputs overlap? Does a source path still select consumers? | Yes, it does, in current source and in shipped 0.1.199: `status --wait <ms> scripts/ledger.test.ts` selected `ledger` and `targets` when `inputs` maps `scripts/*.test.ts` to `scripts/**`, and only `ledger` in the control. A source path selects every consumer in both, as D2 wants. The waits settled in 0.5 s; no timeout was reproduced or is claimed. | verified by experiment (0.1.199 CLI with a real daemon; `selectNamedFiles` at `a8ceaa80`) |
| 2 | Which seam explains it, and what do the tests miss? | `src/cli/status-wait-paths.ts:66` selects a row when `row.testFile.path === rel` **or** its closure holds `rel`, for every path, so a test path also matches every test file whose closure holds it. Closures hold declared inputs (`assembleClosure`, `src/core/keys/closure.ts`), so a glob over a test directory makes sibling test files consumers. `test/cli/status-wait-paths.test.ts` never stores a closure that holds another test file's path. | read in source code (`a8ceaa80`, unchanged since `35e56838`, 2026-10-13; the same expression in the 0.1.199 bundle) |
| 3 | What is new beside 005-11 and the comments, and which queue-delay claims are unverified? | 005-11 (0.1.133) shipped D2 with the "selects itself" sentence; review wave-1 accepted "selects a test by its own path" without an overlap case. 006-55 graded selected files only. New: the overlap defect, and that cezarion's own `inputs` explains every reported selection. Unverified: why selected files stayed pending for 60 s (37 re-keyed, "0 running, 59 queued", the shared slow slot, dist rebuilds). | read in source code; read in the board and reviews; inferred for cezarion |

## 1. Reproduction

**Selector probe** (`run-selector.sh`, output `selector-output.txt`). The probe builds each closure with the product's `createDeclaredInputs` and `assembleClosure`, stores it as written by this worktree, and calls `selectNamedFiles`. *verified by experiment, `a8ceaa80`*

| Case | Named | D2 expects | Actual |
|---|---|---|---|
| `.github/scripts/*.test.cjs` → `.github/scripts/**` | `upstream-ledger.test.cjs` | ledger | ledger, **targets** |
| same inputs | `.github/scripts/lib.cjs` | ledger, targets | ledger, targets |
| `packages/web/e2e/*.e2e.ts` → `packages/web/src/**` | `packages/web/src/test/card-2-contrast.test.ts` | the unit test | the unit test, **`create-project.e2e.ts`** |
| same inputs | `packages/web/src/card.ts` | both | both |
| control: inputs `lib.cjs` only | ledger / `lib.cjs` | ledger / both | ledger / both |
| no inputs; `targets` imports `ledger` | ledger | ledger (D2 literal) | ledger, **targets** |

**End to end on 0.1.199** (`run-cli.sh`, output `cli-output-0.1.199.txt`): a two-file Vitest fixture in `/tmp`, scratch `HOME` and `XDG_RUNTIME_DIR`, a real daemon, `run --all --wait` first. *verified by experiment, 0.1.199*

```
inputs: { "inputs": { "scripts/*.test.ts": ["scripts/**"] } }
$ squeal status --json --wait 60000 scripts/ledger.test.ts
{"outcome":"settled","code":0,"testFiles":["scripts/ledger.test.ts","scripts/targets.test.ts"],"unmatched":[]}
$ squeal status --json --wait 60000 scripts/lib.ts
{"outcome":"settled","code":0,"testFiles":["scripts/ledger.test.ts","scripts/targets.test.ts"],"unmatched":[]}
(edited scripts/ledger.test.ts)
first line: Named test files at revision 1: no known failures; 2 test files, each with a current result, after 0.5 s
inputs: { "inputs": { "scripts/*.test.ts": ["scripts/lib.ts"] } }      # control
$ squeal status --json --wait 60000 scripts/ledger.test.ts
{"outcome":"settled","code":0,"testFiles":["scripts/ledger.test.ts"],"unmatched":[]}
```

The issue's acceptance criteria hold as stated: an exact test path should select only itself; a source path should keep selecting consumers (it does today).

## 2. The seam and the missing tests

- `selectNamedFiles` (`src/cli/status-wait-paths.ts:50-71`) has one predicate for both kinds of path: `rows.filter((row) => row.testFile.path === rel || closures.get(row)?.has(rel) === true)`. Its doc comment quotes D2's two sentences ("A test-file path selects itself. Any other path …"), but the code never decides first whether `rel` is a listed test file. *read in source code*
- The closure holds declared inputs and observed reads by design (001 D3 as amended by 001-132): `assembleClosure` adds `declaredInputs` and `observed` beside the runner's imports. So an exact test path also matches through a sibling's glob, an E2E spec's source-tree glob, an import of the test file, or a run observed reading it. *read in source code*
- `validClosures` keeps a stored closure only when this worktree wrote it or the writer's key matches. Which consumers an exact path drags in therefore varies with who last wrote each closure. That fits the issue body (36 files before the source edit, 2 after) and comments 3 and 5 (one of 77 E2E specs selected), but no store was read. *inferred from source*
- Tests: `test/cli/status-wait-paths.test.ts` "selects a test file by its own path" stores no closures, so the closure branch never fires; the source-path cases store closures that hold only `src/*.ts` sources. The fixture's `closure()` helper could express the overlap (put `A` in `B`'s closure) but no case does. Spec 005's Testing line names "selection by test path, by source path, and by a path that selects nothing", not overlap. *read in source code and spec*

## 3. Against the board and the comments

- **Cezarion's policy explains every report.** `squeal.config.json` in the host's cezarion checkout (`82f97570c`, 2026-10-16) maps `.github/scripts/*.test.cjs` to `.github/scripts/**` (36 such test files, the issue body's "selects 36"), and `packages/web/e2e/*.e2e.ts` to `packages/cezar/src/**`, `packages/web/src/**` and `packages/web/e2e/**` (77 specs: comment 4's "about 80"; comments 2, 3 and 5's `create-project.e2e.ts`). Comment 1's `cockpit-test-sequencer.test.cjs` sits under `.github/scripts/**`. *read in that checkout; selection inferred from §1's mechanism*
- **Existing rows.** 005-11 (done, 0.1.133) and the human's 2026-10-13 decision cover a named wait with no reordering; nothing records the overlap. Review wave-1 line 140 lists "selects a test by its own path" as covered. 006-55 credits selected files only and is unaffected by which files those are. No row names this defect. *read in `docs/board.md`, `reviews/wave-1.md`, `status.md`*
- **Unverified queue claims.** Each comment exited 3 at 60 s. Selection explains why slow or unrelated files entered the wait; it does not explain why they stayed pending. Not reproduced here: comment 1's 37 re-keyed files and "zero checks running and 59 queued" with no reason shown (adjacent rows 001-217, 001-376's per-user permit pool, 001-422's busy shared store); comment 4's dependence on the shared slow slot (cezarion's `slow` lane holds the E2E specs at `maxParallel` 1, so plausible); comment 5's typecheck `dist` output keeping files pending (`packages/cezar/dist/**` is a declared input of `packages/cezar/test/e2e/*.test.ts`). The probe isolated `XDG_RUNTIME_DIR`, so it says nothing about the shared slot or pool. *not determined, because no cezarion store or daemon log of those sessions was read*
- An exact-only selection decouples the wait, not the work: an edit to a test file still re-keys every test file whose closure holds it (001 D3), so those still queue and run. *read in source code*

## Recommendation for Squeal

Make the test-path rule of D2 hold: when a named path is a listed test file, it selects that file and no closure lookup applies; other paths keep today's closure rule. Add the probe's overlap cases (sibling glob, source-tree glob, an imported test file) to `status-wait-paths.test.ts`. This needs no spec change: D2 and `commands.md` ("A test file's path selects that test file") already state it. Vision: it makes a red/green check faster and more relevant (decision filter 1) and removes waiting on unrelated slow work (2), while the source-path form keeps reporting consumers honestly. Whether the queue delays need their own row is a separate question, below.

## Open questions

1. A test file that imports another test file (case 6): D2's literal reading selects the named file only; the coordinator should confirm that reading, since such an import makes the importer depend on the named file.
2. Should a named wait say why its files are still pending at the deadline (queued behind a slot, a permit, a busy store)? Comments 1 and 4 ask for it; it is a 001 question and was not probed.
3. Whether the selection's dependence on who wrote each closure (§2, third point) should be pinned down. Inferred only.

## Sources

- https://github.com/hearsay-tools/squeal/issues/6, read 2026-10-16 with `gh issue view 6 --comments` (read-only).
- `src/cli/status-wait-paths.ts` (`selectNamedFiles`, `validClosures`), `src/core/keys/closure.ts` (`createDeclaredInputs`, `assembleClosure`), `test/cli/status-wait-paths.test.ts`, at `a8ceaa80`; `git log` of the selector file: `9048e3d2` (005-11), `35e56838` (005-22).
- `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`: `row.testFile.path === rel2 || closures.get(row)?.has(rel2) === true`.
- `plugins/claude-code/skills/squeal/references/commands.md:37`; spec 005 D2 and Testing; `status.md` 2026-10-10 and 2026-10-13; `docs/board.md` rows 005-11, 006-55, 001-217, 001-376, 001-422; `reviews/wave-1.md` line 140.
- `/home/agent/projects/cezar/squeal.config.json` at `82f97570c` (hearsay-tools/cezarion), read only.
- Probe outputs: `probes/issue-6-exact-file-waits/selector-output.txt`, `cli-output-0.1.199.txt`.
