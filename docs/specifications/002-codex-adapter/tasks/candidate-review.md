# Stable Codex plugin candidate review

Use /reviewer. Review the exact candidate SHA supplied at dispatch against base 40259a9e4. Own only `docs/specifications/002-codex-adapter/reviews/0.1.368.md`.

Read fixed-plugin D7–D9, wave-4/5 contracts, tasks/002-33/notes.md and repair notes 002-36/37. Review all product changes in the range. Prioritize adapter/runtime boundaries, immutable publication and pins, offline seed retention, updater SQLite exclusion and abort admission, setup/launcher migration, official-release descriptor validation, and honesty of runtime identity. The 120-second updater limit is not a hard bound on admitted synchronous filesystem work.

Verify ordinary build leaves every fixed-plugin byte unchanged. Inspect explicit adapter build/version guards and release asset packaging. Use current affected checks and exact-candidate CI; no local full suite. E2E is excluded from Squeal: run only focused discriminating proof if needed. Scratch homes only, no production trust writes, no credentials read or persisted; any model session uses OpenAI.

Do not edit product or generated files. Record proven blockers separately from plausible notes, precise commands/results, and pending CI. Commit the review file alone. PASS is required before main; it does not replace exact-release CI.
