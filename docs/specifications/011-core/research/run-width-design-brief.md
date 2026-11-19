# Brief: row 011-413, design so a background run stops holding CPUs idle at a fixed width

Use /researcher (design shape). Approved by the human on 2026-11-19 (card of coordinator 4abb5168: "Design it"). Research and design only; no product change.

**Problem.** `research/broad-change-throughput-2.md` (row 011-400): a backlog tier keeps the grant it started with (`tiers.ts` grant fixed, only shrinks); one started at width 1 ran 98 to 225 s on one worker while about 9 CPUs idled; backlog tiers ran 2.9 files at once on 5.1 permits, a plain run 11.6 of 12. Vitest 4 fixes a run's width at its start.

**Design candidates.** (a) A second instance in the lane when permits free up while a narrow tier runs (the lane's second instance exists since rows 011-269 and 011-399). (b) Do not start a tier at the floor width when a wider grant is due within a short time. (c) Smaller tiers so the width is chosen more often. Others if the evidence points there.

**Method.** Read spec 011 C4 step 5 and C10, rows 011-269, 011-399, 011-405, 011-404. Prototype each candidate as a VM-only patch and measure the 011-395 broad edit (1,200 files) against today's: wall time, idle CPUs while files wait, total CPU, two runs each. Lab VM only after the coordinator confirms it is free (read `~/projects/notes/topics/apptension-lab-vm.md`); report the VM's load per run; remove what you copied.

**Done when.** `research/run-width-design.md`: the measured effect of each candidate, the recommended design with its spec text (C4/C10), the rows it needs, and the risks (more CPU above the ceiling, fairness across daemons, the two-instance bound).
