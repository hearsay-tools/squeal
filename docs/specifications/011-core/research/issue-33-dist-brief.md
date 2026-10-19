# Research brief: issue 33, does a `dist` rewrite drop runs that loaded the same bytes?

Use /researcher. Shape: research, read-only on the product. Decided by the human on 2026-10-20 (triage row gh-33, "one researcher"). Run only when the one-minute load is below the CPU count.

Read first: [issue #33](https://github.com/hearsay-tools/squeal/issues/33) and its comment of 2026-10-18 15:02Z, the reporter's evidence: on 0.1.199 every root `npm run typecheck` in cezarion (whose `packages/web` `pretypecheck` runs `tsc` in `packages/cezar`) flipped 63 to 194 checks in 4 test files to UNKNOWN, each reason `vitest adapter: packages/cezar/dist/...` (`.js`, `.js.map`, `.d.ts`); `tsc --noEmit` stopped it. Then `issue-33.md`, its probe `probes/issue-33/`, 013 V5 and V7, 011 C4 and C12, and 011-06's row (a withheld run is re-queued since 0.1.205).

Questions, each tagged:

1. Does `tsc` rewrite `packages/cezar/dist` with the same bytes when no source changed? Build twice in a throwaway `git worktree` of `/home/agent/projects/cezar` at a SHA, `node_modules` symlinked read-only, and compare hashes and mtimes.
2. Which of cezarion's test files load `packages/cezar/dist` through Vite, and are they the reported 4?
3. What does `src/runners/vitest/sources.ts` compare for "changed on disk after this run loaded it": mtime, size or content? On current main, does a same-bytes rewrite of a loaded file drop the run, and is the file now re-queued or left UNKNOWN?
4. Verdict: a key defect (same bytes invalidate, or files that never loaded `dist` are tainted) or a correct invalidation that needs a hint. Reproduce on current source with the existing fixture when cheap.

Own only `research/issue-33-dist.md` and throwaway probes under `research/probes/issue-33-dist/`. Edit no board, spec, status or product file, and nothing in the cezar checkout. Done when the findings answer the four questions with tags and limits, committed. Budget: about twenty minutes; then write what you have.
