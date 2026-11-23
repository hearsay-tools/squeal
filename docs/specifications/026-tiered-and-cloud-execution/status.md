# 026 Tiered local checks and cloud sandboxes: status

Stage: research
Started: 2026-11-23

## Decisions so far

- 2026-11-23, the human: asked to weigh two non-exclusive directions for making Squeal cheaper on large repositories (Squeal and Squawk):
  1. Run cheap checks on edit (complexity, cheap lint) and run heavy tests manually or before opening a PR, reusing CI exports (`refs/squeal/<sha>`).
  2. Run every daemon (or all of its test execution, not just catch-up) in its own boat.dev sandbox, revisiting file sync options including Mutagen.
  "Research both in parallel. ... So the idea could be: cheap stuff runs on edit; heavy stuff runs manually (or on edit - subject to configuration) or in cloud."
- 2026-11-23, the coordinator (2960bce7): opened spec 026 for research only (`research/README.md`), two parallel `/researcher` topics (`tiered-pre-pr`, `boat-sandboxes`) on the standing researcher model (`claude` `opus` `high`). No product code or spec yet.
- 2026-11-23, the coordinator (2960bce7): wave 0 research done (rows 026-01 and 026-02):
  - `research/tiered-pre-pr.md` (researcher 65b4575c): `checks` already expresses cheap-on-edit / heavy-manual, but seven code paths start or reopen the Vitest keying host (0.5 to 1.1 GB) on every edit (even `README.md`) regardless of `at`. Complexity and oxlint work on edit with no runner host. Intermediate churn is 52% (Squeal) and 39% (cezar) of file-hours, yet a closure-complete pre-PR run still hits 38 to 90% of Squeal's suite and 74% of cezar's (even with CI imports), saving no CPU vs today's live daemons (mean 4,393 to 5,193 file-s/worktree). Only a narrow pre-PR run (changed tests + namesakes, 0.05 to 1.3% of suite) is cheap; no command selects it from a base ref today, and `squeal code --base` skips `manual` groups and hides broken tests behind `incomplete`.
  - `research/boat-sandboxes.md` (researcher cdbcd98f): five `--no-env` boat.dev starts ($0.03 total, all deleted). Warm snapshot + `boat fork` with `.git` reaches SSH-ready in 7.8 to 8.7 s (down from 44 to 52 s), 10-file delta takes 118 to 156 ms, and all 3 Git-dependent tests from 021 D2 pass (27/27). On a Ryzen 9 9950X sandbox, edit-to-verdict over kept SSH is 1.12 s median (1 Vitest file), 1.73 to 3.16 s (10 files, coverage on or off), and 0.19 to 0.23 s (`node:test`). However, `boat-trial.md` D5's slow disk sync is a machine-class problem, not `fork` or `ascii-lazyfs`: Ryzen 7 9700X sandboxes (fresh and forked alike; 3 of 4 machines today, 9 of 16 `TREND.md` runs) hit 34 to 38 ms per disk flush vs 0.14 ms on 9950X, slowing the same runs to 10.5 s and 41 s with 6 to 11 false timeout failures. Recommends hybrid 2A (thin local daemon + shared store + cheap local edit checks, remote runner hosts + remote planning on boat.dev), NOT Mutagen or `boat push` (not incremental: 13 s for 1 file), gated on resolving the 9700X slow-disk lottery with boat.dev.
  - Open for the human: whether to pursue Track 1 (moment-aware keying + narrow `--base` pre-PR run + `code --base` scope fix), ask boat.dev about the 9700X disk flush / machine class before building Track 2, narrow closures (e.g., type-only imports), or pause here.
