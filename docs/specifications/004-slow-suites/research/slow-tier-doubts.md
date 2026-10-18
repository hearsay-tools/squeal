# The human's doubts about the slow tier (open, 2026-10-18)

After `slow-tier-role.md` (004-74) and `slow-tier-advisory.md` (004-75), the human chose "keep, wording only for now" and recorded these doubts for a separate session. Nothing here is decided; no row acts on them yet.

1. **One concept or two.** Should build-output suites (this repository's `test/e2e`, cezarion's `test:package`) and suites that are only slow (cezarion's browser specs, which build their own bundle from the sources) be the same concept? They differ in what keys them (D5: declared artifact against sources), in what a rebuild invalidates (004-74 finding 3) and in whether a precondition applies (D8).
2. **The pause run overlaps CI.** In most repositories the agent pauses when it pushes and waits for CI, so running the slow tier at the pause runs it at the same time CI does. 004-75's #1234 case is exactly that: the idle drain ran `review-gate.e2e.ts` while the agent waited for CI, and CI's result settled it. The value over CI is not shown.
3. **Why Squeal and not the repository.** If CI does not run the slow suites, why should Squeal run them, instead of the repository's agent instructions saying so or its CI being set up to? 004-75 found that cezarion's own AGENTS.md, which says the final gate belongs in CI, outweighed Squeal's before-done directive in 97 of 98 sessions.

What the evidence so far says, for that session: `slow-tier-advisory.md` 6 (the options table and what each deletes of D1 to D10), `slow-tier-role.md` 5. Held meanwhile: 004-73 (token ranking).
