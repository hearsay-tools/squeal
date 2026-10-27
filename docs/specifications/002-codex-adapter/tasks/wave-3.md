# Wave 3: stable Codex hook approval

## R1 — 002-25, research

Use /researcher. Establish the smallest hook-definition change that preserves Codex approval across plugin version updates.

Read spec 002 D1/D4, status.md, research/wave-0-checks.md section 3, and spec 005 D3. Start at plugins/codex/hooks/hooks.json; compare its PLUGIN_ROOT references with src/cli/codex/{hash,launcher,trust}.ts. The first probe should compare hooks/list identity and trust for the same plugin installed at two version paths in an isolated scratch Codex home.

Answer: (1) What does current Codex hash before and after expansion? (2) Does shell-time $PLUGIN_ROOT or another minimal command keep trust and execute the current version, including paths with spaces? (3) What must change in launcher config, hash tests, and migration guidance? Verify an actual upgrade, all hook entries, changed-definition invalidation, and execution. Never write the real Codex config or trust store. No model session is needed if app-server and harmless hook fixtures prove it.

Sources: official OpenAI hook/plugin docs, installed Codex and its versioned source, existing repository research/tests. Own only research/stable-hook-approval.md and research/probes/stable-hook-approval/. No product, spec or board edits. Commit findings and bounded reproducible probes; stop after about 20 minutes and name unknowns.
