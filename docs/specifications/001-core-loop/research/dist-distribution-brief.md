# Generated bundle distribution research

Human authorized research on 2026-10-27; OpenAI models only. Shape: research. Use /researcher.

Outcome: recommend where generated plugin bundles should live, with evidence for installation and migration compatibility.

Read process release rules, spec 001 D9 and status, `research/release-hub.md`, the installer and harness build scripts. Start at `install.sh` archive extraction; first trace each harness's installed entry point back to its published bytes.

Questions:
1. Which generated directories are tracked, how large are they, and what measurable churn do they add?
2. What do Claude Code, Codex, Pi, OpenCode and the shell installer fetch? Can each use release assets, a distribution repository, a release-only branch, or hub-contained bundles?
3. Compare those options with today's layout: compatibility, source provenance, reproducibility, rollback, access requirements and maintenance.
4. What must CI and release checks change so tested bytes equal installed bytes?
5. What migration sequence preserves existing installs and historical versions? Identify unresolved assumptions and the smallest follow-up verification.

Sources: repository source/history, existing research, official harness documentation/source, GitHub release documentation and the local marketplace manifests. Use isolated, cheap probes; no real installation, publishing, full suite or product edits. Note the separate stable-Codex-plugin work in progress; distinguish it from released behavior. Apply /openai-docs for Codex research.

Own only `research/dist-distribution.md` and `research/probes/dist-distribution/` here. Commit findings, source URLs/versions, probe commands/results and limitations. Done when every question has a tagged answer or explicit unknown.
