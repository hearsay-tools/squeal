# 004-82 worker notes: slow files ranked by evidence

Brief: `../wave-13.md`, section 004-82. Baseline: `ad5dd720` (0.1.220, `KEY_FORMAT_VERSION` 13). No
guarded source changed, so 13 is not re-pinned; no version bump; no `npm run build`.

## Seam map

- **Rules** (`src/core/slow/rank-tokens.ts`): `offeredTokens` is the changed side (`data-*` values,
  `[data-*=…]` selectors, `aria-label`s, CSS `.class-name`s, hyphenated `class`/`className`
  names of 8+ characters that are not utility classes). `matchSide` is the slow side: words
  (`[A-Za-z0-9-]+`) inside string literals, and literals with a space for several-word labels.
  `localSpecifiers` reads `./` and `../` imports (changed side) or `./` alone (a slow file's helpers).
- **Ranker** (`src/core/slow/rank.ts`): `SlowRanker.evidence(changed, slowPaths)` reads each changed
  file and its local imports once, builds or reuses one `TokenRecord` per slow file and per helper,
  drops tokens that no slow file or more than `COMMON_TOKEN_FILES` (20) match, and returns the kept
  tokens per slow path. A record is keyed by its path's hash from the key stat cache
  (`context.keys.cache.hashOf`); a path the cache does not know is read and hashed with sha1.
- **Store** (`src/core/slow/rank-store.ts`): shared `meta` rows `slow-tokens:<path>` hold the
  `TokenRecord` (hash, words, phrases, helpers); the per-worktree row `slow-evidence:<worktreeId>`
  holds each ranked slow file's tokens with the key it was queued for, for `why`.
- **Queue** (`src/core/scheduler/queue.ts`): `Entry.evidence`, `addEvidence`, `evidenceOf`;
  `orderedSlow(durationOf, ranked)` sorts by group, promotion, class, then **evidence**, then duration.
  Fast `ordered` passes no `ranked`, so its order is unchanged.
- **Ledger** (`src/core/scheduler/ledger.ts`): `settle` ends with `#rank(changed, misses)`. A revision
  with changed paths adds evidence to the slow misses it queued, and publishes the `why` row.
  `orderedSlow()` passes `policy.slow.rank !== "duration"`, read at every call, so a reload applies.
- **why** (`src/core/status/why-rank.ts`, `why.ts`, `format-why.ts`): `rankedBy` on a check's report
  (its test file) and on a no-match whose query is a test file path or its end. The line is
  `Slow order: <file> runs ahead by evidence: it selects <tokens>, tokens of the files edited`.
  `src/cli/main.ts` needed no change: `why` already passes any query to `readWhy`.

## Done-when, as tests

| Done-when | Test |
| --- | --- |
| E1 ranks its spec 1st of 76 (64th by duration) | `test/slow/rank-replay.test.ts` E1 |
| E5's specs in the top 4 (53rd by duration) | same, E5: `good-css` 3rd, `task-thread` 4th |
| A build-script edit changes no order | same, E4: offers no token, order equal to the duration order |
| Every invalidated slow file still runs | same (all specs in the order) and `test/scheduler/slow-rank.test.ts` (all three run) |
| `slow.rank: "duration"` restores the duration order | `slow-rank.test.ts`, and `test/policy/slow.test.ts` for the key |
| A helper's hash change rebuilds its token set | `slow-rank.test.ts` third case: the helper's row loses `panel-body`, the spec falls back to last |
| `why` names the tokens | `test/status/why-ranked.test.ts` |

The replay fixture `test/fixtures/slow-rank/replay.json` is built by `replay-fixture.mjs` from
cezarion (public) at the research's revisions: each changed file and its local imports, and each
spec and its `./` helpers, cut to the lines carrying a token the research probe's extractor finds,
plus import lines. The product extractor runs on those lines, so the fixture leaves lines out but
does not decide the ranking.

Replay evidence (product code):

- E1 `markdown.tsx`: `artifact-project-links` matches `link-safety-dialog`, `link-safety-url`, `link`;
  10 others match `link` alone. 1st of 76.
- E5 `accessibility.css`: 12 specs with evidence; `touch-targets` (4 tokens), `workflows` (3),
  `good-css` (3), `task-thread` (2) lead. The research's b2 had the same 3rd and 4th.
- E4 `build-e2e.sh`: no token; order unchanged.

## Cost per edit on cezarion (77 slow web specs, `82f97570c`, a `git archive` copy in /tmp)

`cost.ts`, 30 iterations per cell, Node 24.21.0, 24 CPUs. Raw output in `logs/cost-*.json`. "Cold":
a new ranker, nothing stored, every spec and helper read and tokenised. "Stored": a new ranker reading
the records from the store (a successor daemon). "Warm": the same daemon's next edit, records in memory;
the changed side is read every time. Medians, p90 in brackets, ms.

| Load (1-min, before → after) | Edit | Specs with evidence | Cold | Stored | Warm |
| --- | --- | --- | --- | --- | --- |
| 22.6 → 21.2 (ambient) | `markdown.tsx` | 15 | 35.0 (41.6) | 5.6 (12.9) | 0.38 (0.43) |
| | `diff.tsx` | 11 | 28.7 (30.1) | 7.8 (9.4) | 0.83 (1.24) |
| | `accessibility.css` | 13 | 29.8 (37.6) | 7.1 (9.1) | 0.27 (0.42) |
| | `build-e2e.sh` | 0 | 0.04 | 0.03 | 0.03 |
| 18.9 → 19.3 (+12 busy loops) | `markdown.tsx` | 15 | 49.8 (62.4) | 8.6 (16.0) | 0.59 (0.72) |
| | `diff.tsx` | 11 | 35.8 (47.1) | 8.3 (9.4) | 0.88 (0.94) |
| | `accessibility.css` | 13 | 40.3 (58.3) | 9.5 (10.3) | 0.34 (0.53) |
| | `build-e2e.sh` | 0 | 0.02 | 0.02 | 0.02 |
| 31.3 → 32.6 (+24 busy loops) | `markdown.tsx` | 15 | 59.7 (78.4) | 6.5 (24.0) | 0.37 (0.59) |
| | `diff.tsx` | 11 | 44.7 (54.6) | 10.4 (12.0) | 0.91 (1.03) |
| | `accessibility.css` | 13 | 37.7 (58.7) | 5.9 (6.6) | 0.24 (0.27) |
| | `build-e2e.sh` | 0 | 0.02 | 0.03 | 0.03 |

- The host's own load moved between runs (other coordinators), so the "+12" run sat at a lower
  load average than the ambient one; the three cells are three loads, 19, 22 and 32, not three
  steps of one.
- Warm cost is under 1 ms an edit, against the research probe's 7 to 35 ms: the probe compiled
  a regex per token and scanned 6.8 MB; the product matches against word sets built once.
- Cold is 29 to 60 ms median (p90 at most 78 ms), once per daemon with an empty store. The store
  holds 96 records (77 specs and 19 helpers), 434 KB of JSON.
- An edit that offers no token reads no spec side at all.
- The cost lands synchronously in `settle`. A daemon's first ranked revision on cezarion blocks
  for about one cold pass; later ones block for well under a millisecond.

## Decisions the spec did not settle

1. **Slow side is string literals only.** Words in identifiers and comments are not matched: a
   selector names its token in a string. Effect on E1: `link`, which 30 specs match as a word
   anywhere (research), is matched by 11 in literals, so it is kept as weak evidence instead of
   dropped. The wanted spec still leads with 3 tokens to 1.
2. **Several-word `aria-label` tokens** match a literal that contains them whole (bounded as the
   probe's `has`). Single-word tokens match a word exactly.
3. **Class expressions.** `className={on ? "a-b" : "c-d"}` offers its literals' classes (the probe
   missed `thread-markdown` there, research finding 1). E1 still ranks 1st.
4. **Evidence accumulates per queued entry** until the file leaves the queue: an edit that re-keys
   a slow file again without tokens does not erase what an earlier edit found, since the earlier
   edit is still unverified. A file that ran starts with none.
5. **Bounds.** A revision with more than 100 changed paths (`MAX_CHANGED_PATHS`, a checkout or an
   install) offers no evidence; a changed file or import above 1 MiB (`MAX_READ_BYTES`) is not read.
   Changed-side imports are one hop, `./` and `../`; a slow file's helpers are one hop, `./` only,
   inside the worktree. `./x.js` also resolves to `x.ts` or `x.tsx`.
6. **Which slow files count for the 20 bound:** every slow file the ledger lists, queued or not.
7. **Token records per path, not per slow file.** A slow file's set is its record joined with its
   helpers' records, each at its own hash, so a helper shared by many specs is stored once and a
   helper's hash change rebuilds that helper's record only. This is D2's "one token set per slow
   file, keyed by the hashes of the file and its helpers", stored by part.
8. **The `why` row** is written when a revision adds evidence; entries whose file key moved are
   pruned then. `why` shows tokens only while the row's key equals the file's current key, also
   after the file ran at that key.
9. **Stale shared rows.** A `slow-tokens:` row of a path that no longer exists stays until it is
   overwritten; rows are bounded by the paths ever ranked. Not pruned (no store change here).

## Agreement (coordinator 8f17c7ea, 2026-10-19, request 5f55e130)

Approved: (1) `WORKTREE_META_ROWS.slowEvidence` (`slow-evidence:`, owner as built `slow/rank-store`,
the request said `slow/rank`) in `src/core/types/store.ts`; (2) the shared row
`slowTokensMetaKey(path)` listed in `SHARED_KEY_FUNCTIONS` of `test/store/worktree-meta.test.ts`.
No new table, no schema change, `KEY_FORMAT_VERSION` stays 13. Commit `fa47c8f2`.

## Type changes (all additive)

- `SlowPolicy.rank: "tokens" | "duration"`, default `"tokens"` (`src/core/types/policy.ts`, its own
  lines in `DEFAULT_POLICY.slow`, validated by `oneOf` in `src/core/daemon/policy.ts`). 004-80 adds
  `trigger` and `quietMs` beside it: the coordinator joins the two blocks, and `test/policy/slow.test.ts`
  and `test/daemon/policy.test.ts` (both edited here for `rank`) will need both keys.
- `WhyRankedBy` and optional `rankedBy` on `WhyReport` and `WhyNoMatch` (`src/core/types/status.ts`).
- `WORKTREE_META_ROWS.slowEvidence` (above).

## For the next worker

- README's slow section is 004-80's: it should name `slow.rank` (`"tokens"` default, `"duration"`
  off) when the blocks are joined.
- The ranking runs in `settle`; under 004-80's continuous lane the slow tier selects with
  `ledger.orderedSlow()` as before, so no trigger code changed.

## Key format

The ranking sources are guarded, so `KEY_FORMAT_VERSION` 13 is re-pinned in place (commit
`9b76349e`, hash `68b8e1d3…`), not raised. 004-80's guarded changes need another re-pin when the
coordinator joins them.

## Verification

- `npm run lint`: `Checked 1446 files in 409ms. No fixes applied.`
- `npm run typecheck`: `tsc --noEmit`, exit 0.
- `squeal run --all --wait` (Squeal 0.1.199, the installed plugin: it exits 0 with a verdict, so the
  `Known failures` line is the verdict), at revision 34, HEAD `2df253e2` plus this file:

```
Checkpoint 1a7dd91f-dc31-41ea-ac3a-676761c6c570 completed at revision 34: 6 known failures: 6 tests; 726 test files, 724 already current, 2 run now
Checkpoint 1a7dd91f-dc31-41ea-ac3a-676761c6c570 started at revision 34: 2 test files to run, 724 already current

Revision: 34 · 9b76349e + 1, dirty
Known failures: 6 (6 tests)
  FAIL  test/harness/codex/plugin.test.ts > committed Codex plugin > has the bundles exactly as `npm run build:plugin` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 33, current
        recorded 21 min ago in this worktree at revision 33, load 0.67 per CPU when it ran; no retry asked at these inputs
  FAIL  test/harness/opencode/package.test.ts > the OpenCode package > has the bundles exactly as `npm run build:plugin` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 33, current
        recorded 21 min ago in this worktree at revision 33, load 0.67 per CPU when it ran; no retry asked at these inputs
  FAIL  test/harness/pi/package.test.ts > the Pi package > has the bundles exactly as `npm run build:plugin` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 33, current
        recorded 21 min ago in this worktree at revision 33, load 0.67 per CPU when it ran; no retry asked at these inputs
  FAIL  test/harness/plugin.test.ts > bundles > are committed exactly as `npm run build` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 33, current
        recorded 21 min ago in this worktree at revision 33, load 0.67 per CPU when it ran; no retry asked at these inputs
  FAIL  test/runners/node-test/run-reads-fidelity.test.ts > a node:test warm-up's recorder a test cannot tell is there (task 001-390) > names the recorder in a failure with its signature while it is in NODE_OPTIONS
        expected [ [ 'fail', undefined ] ] to deeply equal [ [ 'pass', undefined ] ]; diff (- Expected, + Received): - "pass", | + "fail",
        at test/runners/node-test/run-reads-fidelity.test.ts:116:30, observed at revision 34, current
        recorded just now in this worktree at revision 34, load 0.18 per CPU when it ran; retry asked (load) at these inputs: it failed again
  FAIL  test/runners/vitest/observe-fidelity.test.ts > vitest adapter: a recorder a test cannot tell is there (task 001-390) > names the recorder in a failure with its signature, and only under it
        expected [ [ 'fail', undefined, false ], …(1) ] to deeply equal [ [ 'pass', undefined, false ], …(1) ]; diff (- Expected, + Received): - "pass", | + "fail",
        at test/runners/vitest/observe-fidelity.test.ts:119:37, observed at revision 34, current
        recorded just now in this worktree at revision 34, load 0.18 per CPU when it ran; retry asked (load) at these inputs: it failed again
Affected checks: 6911 passed (6185 tests, 726 test files loaded), 0 running, 0 queued, 9 skipped (9 tests)
Full-suite checkpoint: completed at revision 34

```

The 6 known failures, none from this row:

- 4 bundle checks (`cli/squeal.mjs differs from the build`): expected drift, since this row does not
  run `npm run build` (the brief); the coordinator rebuilds at integration.
- `test/runners/node-test/run-reads-fidelity.test.ts` and `test/runners/vitest/observe-fidelity.test.ts`
  (task 001-390's "recorder a test cannot tell is there"): they fail under the Squeal daemon and pass
  alone under `npx vitest run` (5 of 5, twice, at loads about 21 and 4.5). A `squeal retry --reason load`
  at load 0.18 per CPU failed again, so the cause is not load: `squeal why` shows the check failing under
  the daemon in every worktree since 2026-10-17 (6a627ff7, 9e2c5309, 9920d411, 6470300b), on the baseline
  too. An environment failure of running these tests inside Squeal 0.1.199, not of this change.

Earlier in the run, before fixes: `test/types.test.ts` (the policy defaults lacked `rank`; fixed in
`2df253e2`) and `test/keys/key-format.test.ts` (re-pinned in `9b76349e`).

Targeted runs during the work (`npx vitest run`, scoped to the diff): `test/slow/rank-replay.test.ts`
4 passed; `test/scheduler/slow-rank.test.ts` 3 passed; `test/status/why-ranked.test.ts` with
`why-queued` and `why` 12 passed; `test/policy/slow.test.ts` and `test/daemon/policy.test.ts`
41 passed; `test/store/worktree-meta.test.ts` 6 passed; `test/keys/key-format.test.ts` 29 passed.
