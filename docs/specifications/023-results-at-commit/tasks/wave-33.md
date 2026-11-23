# Wave 33 (row 023-69): dogfood round 9 on 0.1.610. Use /worker.

The human chose (2026-11-23): release 0.1.610 and run round 9 on the lab VM ("Release + round 9"); row 023-70 waits for the next wave. 0.1.610 carries wave 32: 023-64 (a folder read holds at the commit when its names on disk equal the commit's listing; review S1: names resolved one by one), 023-65 (a named file is cut out of a batch of unknown time when more than 20 unfinished files lie outside the call), 023-66 (the call's measured rate counts per group), 023-67 (a request-only group's files that a real run request queued read as queued in the hook, `squeal status` and `status --wait`; a plain named wait does not count), 023-68 (both sides start a request's files in one order).

Question: do agents asked a before/after question now reach a full and right answer with no hint inside a 1,200 s session, and does a session that names one browser file get that file's comparison?

- Read `../lessons.md` rounds 7 and 8 (verdicts, columns, the misread-text table, X1 to X3, "Open for a later round"), `tasks/wave-31.md` (round 8's brief), `tasks/023-63/` (scripts, prompts, `notes.md`, the Chromium setup); reuse them, with changes named in your notes.
- **Where:** the lab VM (allowed for this round). Check first that no other user job runs and the 1-minute load is low; say what you found. Never write the VM host name, the company name, sandbox ids or home paths in committed files.
- **Chromium for this round only,** as round 8 (its AppArmor profile limited to the throwaway user's browser path). Prove one browser test file runs as the throwaway user before s1. Remove the profile, the browser and the user at the end.
- **Release under test:** 0.1.610 installed as a user installs it (the release's install.sh and its hub entry; the coordinator sends the hub commit when the release is out). Start only after the coordinator says it is released.
- **Isolation (hard rule):** a throwaway OS user; credentials passed by name only, never read, printed, copied or written; as rounds 3 to 8.
- **Sessions (Sonnet, `timeout 1200` each, at most 3 at once, load-gated):**
  - s1 (squawk, empty store) 5 with round 8's prompt exactly.
  - s1b (squawk, empty store) 5 with round 8's prompt plus one browser file named: "… Include `<path>` in the comparison." Pick `<path>` from round 8's data: a browser test file the change selects whose run took close to the median of the browser files that ran (say which and why in the notes).
  - s2 (Squeal, empty store) 10 with round 8's prompt exactly.
  - Stop each session's commit daemon with `squeal stop --at` after it, as before (V5 is not fixed).
- **Record per session and judge per group** (round 8's columns), and per fix: 023-64 (any "not comparable (needs <folder>/)" for the lint files; did they compare in every s1 session?), 023-65 (the named `open.test.ts` at the commit: inside the call or not, time from the first call), 023-66 (estimates quoted vs measured; any browser time taken from unit files), 023-67 (any "waiting for `squeal run browser`" after an at-run queued them; any "queued by a request" with nothing running), 023-68 (browser files with both sides; s1b: did the named browser file get both sides, and how long after the first call).
- **Write:** a "Round 9 (023-69)" section in `../lessons.md`, verdict first, counts per group against round 8; scripts and data under `tasks/023-69/`. Proposals, not code.
- **Budget:** 20 sessions; stop and tell the coordinator if model cost passes $8.
- **Done when:** sessions ran (or each that could not is named with its reason); lessons and `tasks/023-69/` committed; `pnpm run check:private` with pipefail passes and a grep of the diff finds no private names; the throwaway user, its browser profile and its processes removed.
