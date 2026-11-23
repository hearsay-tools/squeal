# 026 Tiered local checks and cloud sandboxes: status

Stage: research
Started: 2026-11-23

## Decisions so far

- 2026-11-23, the human: asked to weigh two non-exclusive directions for making Squeal cheaper on large repositories (Squeal and Squawk):
  1. Run cheap checks on edit (complexity, cheap lint) and run heavy tests manually or before opening a PR, reusing CI exports (`refs/squeal/<sha>`).
  2. Run every daemon (or all of its test execution, not just catch-up) in its own boat.dev sandbox, revisiting file sync options including Mutagen.
  "Research both in parallel. ... So the idea could be: cheap stuff runs on edit; heavy stuff runs manually (or on edit - subject to configuration) or in cloud."
- 2026-11-23, the coordinator (2960bce7): opened spec 026 for research only (`research/README.md`), two parallel `/researcher` topics (`tiered-pre-pr`, `boat-sandboxes`) on the standing researcher model (`claude` `opus` `high`). No product code or spec yet.
