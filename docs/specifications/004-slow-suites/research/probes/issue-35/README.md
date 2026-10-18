# Issue 35 reproduction brief

Use /researcher. Shape: research. Within 20 minutes, determine whether slow completion guidance queues package tests without required build artifacts, separating installed 0.1.199 behaviour from origin/main. Read issue #35, spec 004 D5–D9 and status, existing issue-3-preconditions.md and issue-29.md, board rows 004-62, 004-65, 004-67 and gh-29. Start at the prior issue-29 probe; adapt a minimal throwaway package fixture rather than running cezarion’s full suites.

Own only research/issue-35.md and research/probes/issue-35/ under this spec. No product, board, spec, status or skill edits; no delegation. Before live probes compare one-minute load to CPU count: above it, skip and report why. Record version, host load, exact commands, reproduced versus source-only evidence, and duplicate boundaries (#3/#16, #29/#5, #19). Answer whether missing-prerequisite protection is already covered by 004-65, and what docs-edit exemption remains undecided. Do not build or repair artifacts to make tests pass. Commit findings and bounded probes; leave dependencies/log bulk untracked outside deliverables. Done when each question has tagged evidence or an explicit not-determined reason.

## Probe (throwaway)

`run.sh` and `overlay/` are a throwaway fixture for `../../issue-35.md`, reusing `../issue-3-preconditions/fixture/`. Everything runs in a `/tmp/issue35-*` scratch repository with HOME and XDG inside it, and each command is bounded by `timeout 150`. Nothing is built. `output-0.1.199.txt` and `output-0.1.213.txt` are the recorded runs from 2026-10-18 at one-minute load 16.70 on 24 CPUs.
