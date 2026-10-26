# Did Cezar main reset, or never finish?

Use /researcher. Shape: research. Bound: about 10 minutes.

The human asks whether Cezar main reset again or its previous full run never finished, and whether terminal `squeal run --all` is cancelled when no agent session opens. Read prior main-pull-reuse.md, spec 011 lifecycle/checkpoints and status.md.

Inspect /home/agent/projects/cezar read-only. Current status snapshot: revision 162, HEAD ecdde768 dirty, 291 current files, 782 pending (200 running, 582 queued), checkpoint 201/983, no completed full checkpoint since revision 137. Notes at 12:12 UTC: upgrade 0.1.339 to 0.1.341; 12:13 last session ended with 47 slow files and checkpoint pending; 12:14 stopped after no slow file ran for 60 seconds, 47 left queued.

1. Reconstruct checkpoints and revisions since our prior 09:13 reading. Did any complete? Why did counts drop? Separate input changes, runtime upgrades and interrupted work.
2. Trace installed 0.1.341 source (and current source if useful) for terminal run ownership, no-session behavior, last-session exit, slow progress timeout, idle limit, CLI exit and --wait timeout. Give precise practical answer and any defect, with evidence limits.

No tests, builds, installs, restarts, new checkpoints or changes to live checkouts/stores. Offline source/store reads only. Own findings main-pull-checkpoint.md and throwaway probes under probes/main-pull-checkpoint/ in this research folder. Commit findings. Report key timestamps in UTC and plain language; do not infer tested bytes from dirty commits.
