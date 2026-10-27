# Wave 6: shipped single-plugin proof

## 002-33 — finish: prove the installed adapter and runtime

Use /worker. Read spec 002 fixed-plugin D7–D9, wave-5-contract.md, notes 002-31/34/35/36/37 and research stable-wrapper-plugin.md plus wrapper-install-flow.md. Generated adapter 1.0.0/seed runtime 0.1.368 and current runtime are committed at 4c17e3f34.

Own test/e2e/plugins.ts, shipped-plugin.test.ts, codex-upgrade.test.ts, new focused test/e2e/codex-* helpers/tests, and tasks/002-33/notes.md plus lessons.md appended proof. Start by giving each Codex fixture isolated PLUGIN_DATA and adapting CLI paths to retained seed/current. Preserve legacy upgrade coverage separately. Test current runtime as well as seed.

Done: actual shipped first-turn bootstrap works offline; runtime A-to-B publication leaves all ten Codex approvals and fixed-plugin bytes unchanged; an existing session stays A, new session uses B; missing pin fails honestly; real CLI provisioning and released format-7 migration work. Use scratch homes only, no production trust/config changes. Suppress background production fetch in ordinary fixtures via future update.json. Local injected release transport is valid; label what uses a stub. Exercise real Codex app-server and record startup timing/budgets. Use existing environment credentials only if needed, never read/copy/persist credentials; any model session must use OpenAI.

Run explicit relevant e2e paths (excluded from Squeal), affected checks, lint/typecheck. No full suite, committed rebuild/version/release. Report product defects to parent before editing outside ownership; no blanket timeout increases. Commit tests and exact evidence with any skipped/unknown proof item.
