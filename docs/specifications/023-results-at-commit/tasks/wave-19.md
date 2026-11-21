# Wave 19 (row 023-33): before/after dogfood rerun on the released round-4 fixes. Use /worker.

The human chose (2026-11-21, "Release + rerun"): release 0.1.583 (shipped inside spec 011's 0.1.584 release), then rerun the before/after groups. Read `../lessons.md` "Round 4 (023-28)" (groups s1, s2, s7, the misread texts, R1 to R8), `tasks/wave-17.md` (round 4's brief: isolation, recording and cleanup rules all hold), `tasks/023-28/` (scripts and prompts to reuse; round 4 ran on the lab VM), `tasks/023-32/` (the same setup moved to a boat.dev sandbox) and `~/projects/notes/topics/boat-dev.md`.

Question: with `--run` filling both sides (R1), the HEAD refusal with `--run` (R2), setup failures named (R3), honest fit (R4), the proof summary line and step 8 (R5), and leftover processes ended (R6), do agents asked a before/after question now reach a full and right answer with no hint, inside a 1,200 s session?

- **Release under test:** the first release that contains 0.1.583 (expected 0.1.584), installed as a user installs it. Start only after the coordinator says it is released.
- **Where:** your own boat.dev sandbox (never the lab VM; never reuse a sandbox you did not create). Delete it at the end and report its cost. Write no sandbox id, account name, token, company name or VM host name in any committed file.
- **Isolation (hard rule):** a throwaway OS user in the sandbox, as in rounds 3 and 4; credentials passed by name only, never read, printed, copied or written.
- **Sessions (prompts exactly as round 4, no hint):** s1 (squawk before/after, empty store) 10; s2 (Squeal before/after, empty store; R5's proof misreading) 10. At most 3 at once, `timeout 1200` each, Sonnet. s7 is not rerun (round 4's s7 answers were already full).
- **Record per session and judge per group** (round 4's columns): `--run` used; both sides filled; answer full and right, partial, honest "cannot tell", or wrong (with the reason); `--at HEAD` calls; calls past 120 s; whole-session time; swaps in the own tree; any Squeal text misread; any process left after the session (R6). Lead with counts per group against round 4's.
- **Write:** a "Round 5 (023-33)" section in `../lessons.md`, verdict first; scripts and data under `tasks/023-33/`. Proposals, not code.
- **Budget:** 20 sessions; stop and tell the coordinator if model cost passes $8.
- **Done when:** sessions ran (or each that could not is named with its reason); `lessons.md` and `tasks/023-33/` committed; `pnpm run check:private` passes and a grep of the diff finds none of the private names; the sandbox deleted.
