# Brief: row 011-416, a shorter catch-up quiet for a large backlog

Use /researcher. Approved by the human on 2026-11-19 (card of coordinator 4abb5168: "Shorter for big backlogs"). Research only; a product row follows if it pays.

**Question.** `CATCHUP_QUIET_MS` (120 s, `src/core/scheduler/quiet.ts`; row 011-153, `research/catch-up.md`) is 13% of a broad change's drain (`research/broad-change-throughput-2.md`). Would a shorter quiet (for example 30 s and 60 s) when the queued backlog is large (for example over 200 files) finish broad changes sooner without wasting the CPU the 120 s saves when an agent edits again soon?

**Method.** Replay from records first: from the daemon logs and stores of this host (copies only, no daemon on a real store), the gaps between edits during agent turns and the backlog size at each catch-up start; estimate the CPU a shorter quiet would waste on runs a later edit invalidates. Then measure on the lab VM (after the coordinator confirms it is free; read `~/projects/notes/topics/apptension-lab-vm.md`): the 011-395 broad edit with quiet 120, 60 and 30 s as a VM-only patch, two runs each, wall time and CPU. State the VM's load per run.

**Done when.** `research/catchup-quiet.md`: time saved and CPU wasted per quiet and backlog threshold, with tagged evidence, and a recommended rule (or "keep 120 s").
