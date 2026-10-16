# Issue 4 triage: the slow tier runs an edit's likely-affected specs in no relevant order

Researcher, 2026-10-16, Opus 5.5. Brief: triage hearsay-tools/squeal#4 and its comment, find duplicate rows and new information, and reproduce the missing relevance order with a cheap probe. No design. Squeal at `e0ff15a3` (main, 0.1.199). Cezarion at `d88c8c1d3`, read through `git show` from the local clone. Probe and logs: `probes/issue-4-ranking/`.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Does a board row, spec section or issue already cover this? | No. No row, spec section or issue ranks slow files by an edit's relevance. Five rows and one human decision touch it (finding 1). | read in source code (board, specs at `e0ff15a3`; `gh issue list`) |
| 2 | How does the slow tier order its queue today? | Recent first, then failing, direct, transitive, never-run, then shortest stored duration (unknown last), then queue order, project and path. Which source changed is not an input. | read in source code, verified by experiment |
| 3 | Does the cezarion shape reproduce the missing order? | Yes. After a `markdown.tsx` edit, `artifact-project-links` ran 66th of 77 with durations known and 4th with none known (alphabetical). An edit to a diff component gives the same order. | verified by experiment |
| 4 | Can the original incident be reproduced? | No. Its session's worktree is not in cezarion's store. The 77-browser run was out of scope (finding 4). | read in source code (store, read only) |
| 5 | Are the issue comment's expected sets right at `d88c8c1d3`? | The markdown set holds (6 specs). The diff set holds only with exact tokens and the specs' own helper imports, and that adds `repo-git` (9 specs, not 8). | read in source code |

## Findings

### 1. Duplicates and related work

No duplicate. Searched `docs/board.md`, spec 004 `spec.md` and `status.md`, spec 001 D5, and hearsay-tools/squeal issues #1 to #4.

- **001-42** (done): set today's classes and the shortest-first rule inside each class (001 D5 step 4 as amended, `spec.md:103`).
- **004-54** (done): keeps "shortest-first order" across a restart. It is the only 004 row about slow order.
- **005-11** (done): "reads only, no reordering, the human 2026-10-13: not for now". That decision was about `status --wait <path>` raising priority. It is the closest earlier call on reordering, and the coordinator should ask whether it still holds.
- **004-61** (done): came from cezar feedback that `run --all` queued 88 e2e files when the agent wanted one fast file. Same friction, different lever.
- **001-128 / 001-132** (done): the runtime-input recorder. It is the nearest existing machinery to the issue's coverage candidate, but it records Node reads (finding 6).
- **Issue #3** is a separate request: skip a tier when its precondition fails. It shares only the source session. Issues #1 and #2 are unrelated.
- Spec 004 D2 runs slow files "in D5's order". 004's non-goals rule out marking by duration or per-test tags, not ordering. Vision principle 4 ("orders checks by what changed", with runtime coverage named as machinery) and decision filter 1 support the ask.

### 2. Today's order (read in source code, `e0ff15a3`)

`RunQueue.orderedSlow` (`src/core/scheduler/queue.ts`) sorts the slow entries the same way as the fast ones, by these keys in order: `recent`, then `priority` (`failing` 0, `direct` 1, `transitive` 2, `neverRun` 3, from `priorityOf`), then shortest `durationOf` (unknown is +∞), then `seq`, project and path. `Ledger.orderedSlow` (`src/core/scheduler/ledger.ts:135`) supplies `FileState.durationMs`, the sum of the stored results' durations (`files.ts:149`).

The changed paths reach the order only in two places. `priorityOf` puts a file in `direct` when the test file itself changed or the runner names it a direct importer. `recentOf` marks a file recent when its closure, which includes declared inputs, holds a changed path. In cezarion every web spec declares `packages/web/src/**`, and no spec imports the components it tests. So for any source edit all 77 files land in the same recency and class, and only duration, queue order and path separate them. `src/core/slow/` (classify, guard, inherit, slot, state, stop-wait) has no ordering code. The seam is `queue.ts`'s `sorted()` and the inputs `Ledger` passes it.

### 3. Reproduction (verified by experiment)

Command: `npx vitest run --config $P/vitest.config.ts --root $P`, with `P` set to the probe directory. It drives the real `Scheduler` and a real Vitest adapter (`test/scheduler/helpers.ts`) over a scratch repository shaped like cezarion's web specs: 77 files with cezarion's names, CI durations ÷ 100, declared inputs `packages/web/src/**`, `slow.maxWorkers` 1, `slow.maxParallel` 1, `lookup-only`. Node 24.21.0, Vitest 5.0.3. Two runs, 88 s and 93 s, host load 38.9 then 12.1 on 24 CPUs. Both runs gave the same positions for every row in this table.

| Pass | Edit | Expected first (issue) | Observed position of `artifact-project-links` | Observed first three | Order equals "shortest stored first, then path" |
| --- | --- | --- | --- | --- | --- |
| 1 | `markdown.tsx`, no durations | `artifact-project-links` | 4 of 77 (alphabetical: `agent-browser-tabs`, `agents-dock`, `application-update` ran first) | `agent-browser-tabs`, `agents-dock`, `application-update` | yes, both runs |
| 2 | `diff-file.tsx`, durations known | the diff-slot specs | n/a. Diff specs at 13 to 49 (`commit-list` 13, `quick-list` 75) | `inbox`, `tools-menu`, then `skills-update` (run 1) or `sidebar-ellipsis-click` (run 2) | yes, both runs |
| 3 | `markdown.tsx`, durations known | `artifact-project-links` | **66 of 77** | `inbox`, `tools-menu`, `command-palette` | yes, both runs |

- Each pass ran every one of the 77 files, one per run, with no request needed. The idle trigger ran them.
- In pass 3 the other markdown-token specs ran at 18 (`chat-code-fence`), 21 or 22 (`assistant-line-breaks`), 32 or 33 (`composer`), 44 or 46 (`task-files`) and 73 (`task-thread`).
- Passes 2 and 3 differ only by re-measured durations: 42 of 77 files at the same position, at most 5 or 6 places apart. Both match the duration prediction exactly.
- Pass 3 is within 3 places of the shortest-first order of the CI durations, where `artifact-project-links` is 66th. With known durations the spec that broke runs after 65 of 77 files (84%). By CI durations it starts 12.5 minutes into a 27.7-minute serial tier, because the files before it are short (`ci-durations.json` sums to 1,661 s).

### 4. Original incident: limitations (read in source code)

- The PR's CI run 38795107753 failed `artifact-project-links.e2e.ts:86:11` in shard 2/4 ("retains identical publication Markdown in the owner project thread"). PR #1076 merged as `979d96c91` at 21:09 UTC.
- Cezarion's store (`~/projects/cezar/.git/squeal/store.sqlite`, opened `readOnly`) has 26 worktree rows. None is the `feat/markdown-preview-in-changes` session. In the whole store, one revision names `markdown.tsx`: the main checkout's r84 at 21:43 UTC, a merge pull (head `27253cab` to `83817eea`) with many changes. The main checkout ran no web spec after r84 until r89 (`logs/store-main-r80-90.txt`). The incident's local order is therefore unknown. So is whether Squeal ran the slow tier in that session at all.
- The main checkout's r83 interval revision ran 34 web specs one at a time, 21:18 to 21:35 UTC (`logs/store-runs.txt`). That is the real lane at width 1, as configured.
- Not run: the 77-browser suite (out of scope), the production bundle, and the agent session. The probe's durations are CI's, not this host's. That is why pass 3's 66 is a proxy for the real position. Pass 1 shows that with no stored durations the position is alphabetical luck.

### 5. The comment's expected sets (read in source code, `d88c8c1d3`)

- **Markdown.** The AGENTS.md grep `link-safety|data-streamdown|thread-markdown` matches the 6 specs the comment lists. `artifact-project-links.e2e.ts:81` and `:86-87` select the hooks rendered by `task-link.tsx` and `link-safety-dialog.tsx`, which `markdown.tsx` imports (lines 11 and 13), and `markdown.tsx:209` sets `thread-markdown`. Confirmed.
- **Diff.** A prefix grep `data-slot="diff-` matches 9 spec files: it adds `quick-list` and `repo-git` and misses `repo-git-diff`.
  - `diff-stat` comes from `components/diff-stat.tsx`, not `components/diff/`.
  - `diff-mode-toggle` comes from `routes/task-git/diff-controls.tsx`.
  - `repo-git-diff` selects nothing itself. It reaches `diff-files`, `diff-totals` and `diff-file` through its helper `repo-diff-coverage.ts`.
  - Matching exact tokens that `components/diff/**` renders, across each spec and its local `./` imports, gives the comment's 8 plus `repo-git`, which imports the same helper (`logs/tokens-diff-d88c8c1d3.txt`).
  - So token evidence needs exact tokens and the spec's own import closure, not prefixes. The spec side of that closure is already in Squeal's static closure.

### 6. The coverage candidate and the recorder (inferred)

001-132's recorder sees the files a test process reads or spawns. A browser spec's process reads the built bundle and the browser executes it, so the recorder would see `.ai/qa/build/cezar` files, not `markdown.tsx`. The comment says the same: a coverage closure needs the build's source maps. Not tested.

## Recommendation for Squeal

Treat #4 as new work, not a duplicate. The current order is fully explained by 001 D5's sort, and the probe is a ready regression case for the issue's first two acceptance criteria. "Today's order" for criterion 2 means shortest stored duration first, unknown last, then path. Where it lives (a 004 D2 amendment or a new spec) and whether the human's 2026-10-13 "not for now" on reordering (005-11) still holds are the coordinator's calls. If the token candidate is chosen, finding 5 is the input: exact tokens, plus the spec's own imports.

## Open questions

1. Does a real cezarion worktree usually have stored durations for its web specs? That decides whether today's order is pass 1 (alphabetical) or pass 3 (shortest first). Not determined: the store was not surveyed per worktree.
2. Did Squeal run the slow tier at all in the #1076 session? Not determined: that worktree is not in the store (finding 4).
3. Does 005-11's "not for now" cover the slow lane? The human's to answer.

## Sources

- hearsay-tools/squeal#4 and its comment; #1 to #3 (`gh`, 2026-10-16).
- hearsay-tools/cezarion `d88c8c1d3`: `squeal.config.json`, `packages/web/e2e/*.e2e.ts`, `repo-diff-coverage.ts`, `packages/web/src/routes/task-thread/markdown.tsx`, `packages/web/src/components/diff/**`. PR #1076 (`979d96c91`), issues #1096, #1019, #1097. CI run https://github.com/hearsay-tools/cezarion/actions/runs/38795107753, jobs 116630315349, 116630315481, 116630315565, 116630315669.
- Squeal `e0ff15a3`: `src/core/scheduler/queue.ts`, `ledger.ts`, `files.ts`, `src/core/keys/key-index.ts`, `reverse-index.ts`, `src/core/slow/*`; `docs/board.md`; specs 001 D5 and 004; `docs/vision.md` principle 4.
- Probe: `probes/issue-4-ranking/` (README, `probe.test.ts`, `ci-durations.json`, `tokens.sh`, `store-*.mjs`, `logs/`).
