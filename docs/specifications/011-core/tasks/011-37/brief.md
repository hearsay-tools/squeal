# 011-37 brief: design, a key format version that moves only when stored results change

Approved by the human on 2026-10-20 from 011-35's findings (`research/key-format-guard.md`): the mechanism as recommended, formats 13 to 17 read as one in the design, a change of stored wording re-keying nothing. The human's reason: real users must not re-run everything for a minor improvement. Spec text now; code rows after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-37/design.md`, which the human can accept as an amendment to 011 C3's "Key format version" bullet (tasks 001-199, 001-203).

Read: the board's 011-37 row; 011 C3, C4, C7 and C14; `research/key-format-guard.md` with `research/probes/key-format-guard/`; `test/keys/key-format.test.ts`, `test/keys/key-sources.ts`, `src/core/keys/`.

Answer, each with a recommendation:

1. **The rule** in spec words, decision 1 of the findings, with the label decision: stored wording that differs re-keys nothing, an old row keeps its wording until the file's next run.
2. **The alarm**: what is hashed (the validity path's emitted code), which entry points, how pinned; the per-adapter pins under each adapter's version.
3. **The decision**: the cross-release fixture comparison in CI (keys, rows, accept decisions), how the last release's code is obtained (the findings' open question), how CI proves the fixtures execute the changed lines, and how a new case joins the corpus.
4. **Reading formats 13 to 17**: how a lookup finds a row stored under an equivalent format, its cost against C4's catch-up budget, and which closure-assembly evidence settles the inferred 12 to 13 verdict before shipping. Whether the bundled release of 013-02 and 001-365, which raises the key under today's guard, joins the equivalence.
5. **The refactors**: the accept rule out of `Ledger`, `recordTier`'s store decision out of `tiers.ts`, scheduling hints out of the adapters, with what each moves.
6. **Code rows**, in order, with seams, owners and the regression each lands, and the residual risks of the findings' Q4 each with its test.

Include spec text as drafts and the rejected options. Owns `tasks/011-37/` only, probes under `tasks/011-37/probes/`. Leave alone: spec, status, board, product code. Probes run in a throwaway `git worktree` under `/tmp` at a SHA, with `HOME` and `XDG_*` there, only while the one-minute load is below the CPU count; no full suite, no build. Done when design.md is committed. Stop: the human's dated acceptance.
