# Wave 17 (row 023-28): before/after dogfood rerun on released 0.1.577. Use /worker.

The human chose (2026-11-20, "Release + rerun"): release 0.1.577, then rerun the before/after groups on the released version. Read `../lessons.md` "Round 3 (023-23)" (the before/after groups s1, s2, s7, the misread texts, Q1 to Q8), `tasks/wave-15.md` (the brief of round 3: isolation, recording and cleanup rules all hold), `tasks/023-23/bin/` (the scripts and prompts to reuse) and `tasks/023-23/notes.md`.

Question: with 0.1.577's report (the `--run` next step at its end, "one call is the whole comparison", `--at HEAD` on a clean tree naming `HEAD~1`) and the skill's step 8 clause, do agents asked a before/after question now reach a full and right answer with no hint?

- **Release under test:** 0.1.577 as released (tag `squeal--v0.1.577`, hub `c126136`), installed as a user installs it, as in round 3.
- **Where:** the shared lab VM (named in the shared notes; never write its host name or the company name in any committed file or message). Start only after the coordinator says the VM is free. Check `uptime` before each batch; work in `~/work/<your task id>/`; delete everything at the end; leave no process.
- **Isolation (hard rule):** a throwaway OS user, as in round 3; credentials passed by name only, never read, printed, copied or written.
- **Sessions (prompts exactly as round 3, no hint):** s1 (squawk before/after, empty store) 10 sessions; s2 (Squeal before/after, empty store) 10 sessions; s7 (squawk before/after with HEAD's results stored) 5 sessions, with round 3's store copy shortcut (warm s7-01 fully, copy its store into identical clones, check the copy reads current). At most 3 sessions at once, `timeout 1200` each, Sonnet.
- **Record per session and judge per group** (round 3's columns): `--run` used or not; answer full and right, partial, honest "cannot tell", or wrong (with the reason); `--at HEAD` calls; tool-limit overruns (a call past 120 s); swaps in the own tree; any Squeal text misread. Lead with counts per group against round 3's.
- **Write:** a "Round 4 (023-28)" section in `../lessons.md`, verdict first; scripts and data under `tasks/023-28/`. Proposals, not code.
- **Budget:** about 25 sessions; stop and tell the coordinator if cost passes $10.
- **Done when:** sessions ran (or each that could not is named with its reason); `lessons.md` and `tasks/023-28/` committed; `pnpm run check:private` passes and a grep of the diff for the company name and the VM host name finds nothing; the throwaway user, its files and every process removed from the VM; the work folder deleted.
