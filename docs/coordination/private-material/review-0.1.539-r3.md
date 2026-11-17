PASS f40719a3e274a0414cfd929cddeed8de4ba994f1 — 0 blockers, 1 nonblocking note.

Narrow round-3 re-review, authorized by the human on 2026-11-17 after round 2. Candidate `cand/0.1.539`, based on main `e3ed397fb`. HEAD matched the pinned SHA above. Scope: B4, regressions in its repair, the rebase conflict and the new styleguide line. Earlier settled findings were not reopened. No product code was changed for this review.

## Verification

- `pnpm run lint`: exit 0, `Checked 3602 files in 1593ms. No fixes applied.`
- `pnpm run typecheck`: exit 0.
- `pnpm run build`: exit 0. `git status --short` remained empty after the build.
- `squeal status --wait 60000 test/harness/check-private.test.ts test/harness/primer-wait.test.ts`: exit 0 at revision 10, `Named test files at revision 10: no known failures; 2 test files, each with a current result`. Here `squeal` abbreviates the session's absolute launcher. An earlier wait expired while the daemon enumerated the new checkout; that result was not treated as a current verdict. Unrelated checks remained queued. No local full suite was run.
- The new B4 test was run in an isolated temporary harness with unchanged candidate tests/helpers, changing only the guard source. Command: `pnpm --config.verify-deps-before-run=false exec vitest run test/harness/check-private.test.ts -t 'review r2 B4'`. Round-2 guard from `e9e9f8bfe`: exit 1, **1 failed, 22 skipped**. Candidate guard: exit 0, **1 passed, 22 skipped**. The temporary harness was removed.
- Direct temporary-repository probes: **16 cases, 0 mismatches**, covering both original B4 roots, a non-ASCII name, repeated dots/slashes, JSON slash escapes, URLs, local file URLs, placeholders and all three exempt names. Temporary repositories were removed.
- `gh run view 44032823841 --json headSha,status,conclusion`: Private material **success**, exact candidate SHA.
- `gh run view 44032823785 --json headSha,status,conclusion`: full CI **in_progress**, exact candidate SHA at the last read. Its final result is unverified here.
- Squeal also emitted a complexity signal for `createDelivery.registerNow.<transaction>` in `src/core/delivery/delivery.ts` (22 against 20). That file is unchanged by this candidate relative to main `e3ed397fb`; the signal is outside this narrow review, not a finding against the B4 repair.

## B4: resolved

Proven at `scripts/check-private.ts:257`: the home-path rule now collapses runs of `/./` and `//` before matching each raw or JSON-decoded form. Both original placeholder-shaped repros, `/home/./<name>/project` and `/Users/./<name>/project`, were tested with made-up names and are rejected. Repeated dot components and doubled separators are also rejected for private names. The new regression test fails without this change and passes with it.

The focused probes confirm:

- HTTP and protocol-relative URLs containing these path components pass.
- A local file URL containing a private home path is rejected; one using the exempt example username passes.
- Angle, variable, brace and percent placeholders pass after separator collapse.
- The exempt names `user`, `runner` and `squeal-e2e` still pass, as does the existing `.localized` example.

No new bypass or false alarm was found in these scoped cases. The comment-only follow-up uses an exempt example and matches the implementation.

## Rebase: no scoped regression found

`git range-diff --no-patch 61904d31b..e9e9f8bfe e3ed397fb..f40719a3e` maps eleven earlier commits unchanged. Two mapped patches differ: the test scrub and the version/bundle rebuild. Three additional commits contain B4, the styleguide/review-text update and the exempt comment example.

The detailed range comparison of the test-scrub commits (`93636e638` and `3e2408ade`) shows only the expected `primer-wait` context change. Main's newer test description, 1,000-character component, expected wait sentence and assertions are retained. Against main `e3ed397fb`, the final `test/harness/primer-wait.test.ts` changes only the recording-host home example to `/home/user`. Its targeted tests pass.

The previously reviewed guard/scrub repair patches are preserved. Comparing the round-2 and current guard sources shows only the separator-collapse helper, its use by the home-path rule and its explanatory comment. The guard test file adds only the B4 case. The rebuild leaves no tracked drift.

## Notes

### N1 — proven, nonblocking: the styleguide states a broader policy than the automated check proves

Location: `docs/styleguide.md:39`.

The prohibition correctly states the human's policy. The next sentence, which says CI fails a push that adds those materials, can be read as a guarantee for every transcript format. The implementation recognizes recorded-session JSON keys, has bounded decoding and deliberately allows specified fixture exceptions. A synthetic two-line transcript with role labels and no matching keys, home path or denylist entry returns no problems in a temporary-repository probe.

Keep the prohibition. For precision, describe the CI sentence as scanning added text lines for home-path patterns, recorded-session keys and the private denylist, with limited fixture exemptions. This is a wording note within the requested styleguide check, not a new blocker or a request to expand the guard. It does not reopen the accepted scrub or bounded-decoding decisions.

## Handoff

B4 is closed at the pinned SHA. No regression from the requested repair or rebase was found. This PASS covers the stated narrow scope. Full CI on the exact release commit must still pass before release.
