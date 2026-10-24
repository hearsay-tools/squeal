# Judge brief 016-08: the check protocol

Use /judge. Shape: review of research. Outcome: where the two findings on the check protocol diverge, which side the evidence favours, and the spec input for the contract a check provider satisfies. The human authorized this fan-out on 2026-10-24 for the central question of spec 016.

Read: `check-protocol-brief.md` (the questions), `check-protocol.md` (016-03, Claude Opus 5.5) and `check-protocol-astra.md` (016-07, GPT-6-Astra), and the sources they cite. For Squeal's own contract, read only what they cite from `src/core/types/runner.ts` and 011 C3, C4 and C14.

Weigh each of the brief's five questions. Name the divergences that change the design most: which protocol or format to build on, which transport for which tier, the minimum a provider supplies for keys and transitions, and the identity of a diagnostic.

Write `check-protocol-judgment.md` and commit that file alone. Edit no board, spec, status or findings file.
