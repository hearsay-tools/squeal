# Inbox monitor research

Outcome: identify a small, verified instruction that lets coordinators notice new shared-inbox messages through native harness background-task notifications.

Use /researcher. Shape: research. Read `docs/agent-inbox.md` and the coordinator communication paragraphs in `CLAUDE.md`. This is repository coordination, not a product spec.

Answer these questions:

1. Can Claude Code run a file watcher as a native background task and notify its session when a relevant message arrives? What exact command and tool options work?
2. Can Codex do the equivalent without polling tool output or sending human-input messages? Distinguish active-turn notification from waking a parked session. If unavailable, name the smallest honest fallback.
3. What startup/read/rearm/cleanup sequence prevents missed messages, old-message loops and orphan watchers? How do pending human questions remain untouched?

Sources: installed Claude and Codex CLI help/source; their official documentation; installed Cezar CLI/source only for fallback. Prefer native harness facilities (human, 2026-10-27). First seam: inspect native background-task completion delivery, not filesystem APIs. Cheap local probes are allowed; never contact real coordinator peers or alter human questions. Bound research to 20 minutes.

Own only `docs/coordination/inbox-monitor-findings.md` and optional throwaway probes under `docs/coordination/probes/inbox-monitor/`. Leave board, product code, CLAUDE.md and protocol to the parent. Done when findings distinguish verified behavior from unknowns and include a usable minimal procedure, any tested snippet and cleanup evidence. Commit findings. No full-suite runs or builds.
