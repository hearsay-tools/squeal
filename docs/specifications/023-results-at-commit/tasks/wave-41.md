# Wave 41 (row 023-87): dogfood round 12 on 0.1.624. Use /worker.

The human chose (2026-11-24): release 0.1.624 and run round 12 on the lab VM ("Release + round 12"). Since round 11 (0.1.614): 0.1.624 carries wave 40 (023-83: a late partner pairs the leader's first file first on the shared group slot; a slot wait says why it waits, "taken at its last try" when it cannot check, never "in use" for a free slot; 023-84: a named file behind its own side's run at an older key says that run will not count). Strict slot alternation was dropped (row 023-88), row 023-85 (first-run re-runs) was stopped, and 0.1.615 to 0.1.623 carry other specs' work (017, 018, 025, 026), so compare with round 11 with that in mind.

Question: do agents now reach a full and right answer with no hint inside a 1,200 s session, and how soon does the first browser file get both sides?

- Read `../lessons.md` rounds 10 and 11 (verdicts, columns, the misread-text table, AA1 to AA4, "Open for a later round"), `tasks/wave-37.md` (round 11's brief), `tasks/023-80/` (scripts, prompts, `notes.md`, the Chromium setup); reuse them, with changes named in your notes.
- **Where:** the lab VM (allowed for this round). Check first that no other user job runs and the 1-minute load is low; say what you found. Never write the VM host name, the company name, sandbox ids or home paths in committed files.
- **Chromium for this round only,** as rounds 8 to 11. Prove one browser test file runs as the throwaway user before s1. Remove the profile, the browser and the user at the end.
- **Release under test:** 0.1.624 installed as a user installs it (the release's install.sh and hub entry `fdc7453`). Start only after the coordinator says it is released.
- **Isolation (hard rule):** a throwaway OS user; credentials passed by name only, never read, printed, copied or written; as rounds 3 to 11.
- **Sessions (Sonnet, `timeout 1200` each, at most 3 at once, load-gated):** round 11's groups and prompts byte-equal: s1 (squawk) 5, s1b (squawk, naming `packages/web/e2e/thread-scroll.e2e.ts`) 5, s2 (Squeal) 10, each on an empty store. Stop each session's commit daemon with `squeal stop --at` after it.
- **Record per session and judge per group** (round 11's columns), and per fix: 023-83 (time from the first call to the first browser file with both sides; was it inside the first call; turns in a row per side; each slot-wait line and whether it was true), 023-84 (any "will not count" line and whether the run was really at an older key), and the first-run re-runs on an empty store (count, as round 11, since 023-85 was stopped).
- **Write:** a "Round 12 (023-87)" section in `../lessons.md`, verdict first, counts per group against round 11; scripts and data under `tasks/023-87/`. Proposals, not code.
- **Budget:** 20 sessions; stop and tell the coordinator if model cost passes $8.
- **Done when:** sessions ran (or each that could not is named with its reason); lessons and `tasks/023-87/` committed; `pnpm run check:private` with pipefail passes and a grep of the diff finds no private names; the throwaway user, its browser profile and its processes removed.
