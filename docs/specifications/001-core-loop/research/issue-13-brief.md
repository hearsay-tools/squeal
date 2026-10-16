# Issue 13: invalidation reason hidden by artifact paths

Use /researcher. Shape: research. Read docs/process.md, docs/vision.md, docs/styleguide.md, spec 001 spec.md (D4, D5, D7, D9, D12) and status.md. Review GitHub issue hearsay-tools/squeal#13 including comments (agent-reported friction, 0.1.199).

Answer: (1) Does the request fit the vision? (2) Is it already a board row, and what new evidence does it add? Search the full board and relevant specs, especially 001-403 and 001-413. (3) Can the hidden invalidation reason be reproduced? Start at the runner diagnostic containing "was written during this run and ended as it was", then trace the actual delivery truncation. Run a cheap deterministic probe with many artifact paths through actual product code; record exact reproduction commands, revision, output and limits. Distinguish formatter reproduction from live watcher reproduction; do not claim the originating run was replayed.

Own only research/issue-13.md and research/probes/issue-13/ under this spec. No product, board or spec edits. Commit findings and minimal reproducible probe. No implementation, full suite, builds, release or GitHub writes. Done when all three answers have tagged evidence and a recommendation for a pending human decision.
