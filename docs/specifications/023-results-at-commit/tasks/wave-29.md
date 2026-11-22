# Wave 29 (row 023-56): dogfood round 7 on 0.1.599. Use /worker.

The human chose (2026-11-22): release 0.1.599 (with 0.1.598) and run round 7 ("Release + round 7"), on the lab VM ("Lab VM", allowed for this round). 0.1.599 carries row 023-47 (rewritten reads keyed; RECORDER_VERSION 7) and wave 28: V1 (paths under a tracked symlink held at the commit), V2 (estimate per side from measured rate or stored durations at the real group/project/pool limits), V3 (named folders lead the commit queue), V4 (narrowed counts first, rest of the queue apart), V6 (failed setup named beside the other side), V8 (narrowed summary names its scope).

Question: do agents asked a before/after question now reach a full and right answer with no hint, inside a 1,200 s session?

- Read `../lessons.md` rounds 5 and 6 (verdicts, columns, the misread-text table, V1 to V8, and round 6's "for the next round"), `tasks/wave-27.md` (round 6's brief), `tasks/023-44/` (scripts and prompts to reuse as they are).
- **Where:** the lab VM, as round 6 (the human allowed it for this round). Check first that no other user job runs and the 1-minute load is low; say what you found. Never write the VM host name in committed files.
- **Release under test:** 0.1.599 installed as a user installs it (the release's install.sh and its hub entry; the coordinator sends the hub commit when the release is out). Start only after the coordinator says it is released.
- **Isolation (hard rule):** a throwaway OS user; credentials passed by name only, never read, printed, copied or written; as rounds 3 to 6.
- **Sessions (prompts exactly as round 6, no hint):** s1 (squawk before/after, empty store) 10; s2 (Squeal before/after, empty store) 10. At most 3 at once, load-gated, `timeout 1200` each, Sonnet. Stop each session's commit daemon with `squeal stop --at` after it, as round 6 did (V5 is not fixed).
- **Record per session and judge per group** (round 6's columns), and per fix: V1 (do the symlink files now compare?), V2 (estimate quoted vs measured time to the full answer), V3 (named folder results at the commit within the call), V4/V8 (narrowed counts read right; did any agent read a narrowed summary as the whole answer?), V6 (any 'still running' after a failed setup?).
- **Write:** a "Round 7 (023-56)" section in `../lessons.md`, verdict first, counts per group against round 6; scripts and data under `tasks/023-56/`. Proposals, not code.
- **Budget:** 20 sessions; stop and tell the coordinator if model cost passes $8.
- **Done when:** sessions ran (or each that could not is named with its reason); lessons and `tasks/023-56/` committed; `pnpm run check:private` with pipefail passes and a grep of the diff finds no private names; the throwaway user and its processes removed.
