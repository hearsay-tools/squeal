# Issue 85: repeated cross-harness version mismatch warning

Date: 2026-10-23. Issue: https://github.com/hearsay-tools/squeal/issues/85

## Fit and owner

Inferred: passes the vision decision filter by reducing repeated advisory noise while retaining validation feedback, provenance and uncertainty. Spec 005 D3 owns the launcher and its cross-harness warning; D6 owns concise guidance. Intake labelled area-core, but the requested change concerns launcher output, not daemon handover.

## Evidence and reproduction

Reported by an agent using Squeal (`friction`), not independently reproduced: issue 85 reports each CLI call repeating Claude Code 0.1.276 versus Codex 0.1.277, then Codex 0.1.278. Its session kept the 0.1.277 skill. This triage checkout and session use 0.1.278.

Not reproduced, because the one-minute host load was 68.08, above 24 CPUs. No researcher, live probe, status wait or fixture was started. No probe directory was needed.

Exact host checks: `uptime` returned load averages `68.08, 65.64, 68.83`; `getconf _NPROCESSORS_ONLN` returned `24`. Checkout version check: `node -p 'require("./package.json").version'` returned `0.1.278`.

Commands reported by the issue, not executed here:

```text
squeal status --wait 60000 packages/cezar/src/runs/completion-actions.test.ts
squeal why <check>
```

Read in source code: `plugins/codex/bin/squeal-launcher` checks for differing installed versions and writes the advisory to stderr before running the CLI. That branch has no session deduplication. Source inspection supports the symptom but does not establish live reproduction.

## Duplicate check

Read in repository and GitHub: fetched origin/main, searched its board for `#85`, mismatch/cross-harness/version-warning terms, `completion-actions.test.ts` and `squeal-launcher`, and checked all open issues with their labels, including `triaged`. No existing issue-85 row or exact open duplicate found. Done row 005-74 fixes which running version the warning names, not its repetition; done 005-76 centralizes launcher source. Open #77 / gh-77 concerns daemon handover and unavailable verdicts, not this advisory. Open #81 concerns skill paths during updates, not advisory repetition.

## Decision and done-when

The human decides whether to approve session-scoped deduplication or a documented advisory-only suppression control. An unchanged mismatch should appear once per session or be suppressible through that documented control; a changed mismatch must appear again. Test failures, daemon status and validation must remain visible and unchanged. Existing holds stand. This triage authorizes no implementation and changes no spec or skill.

Documentation-only verification: checked the diff and paths; no product checks run and no build outputs changed.
