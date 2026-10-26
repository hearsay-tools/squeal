# Wave 2 candidate review

Use /reviewer. Shape: review. Review `cand/0.1.360` at the exact spawn baseline against `ac0f538a7` (main before integration). Write and commit `docs/specifications/017-lint-checks/reviews/0.1.360.md`. Own only that file.

Read spec 017 D2/D6/D8/D9/D10, status amendments, wave-2 brief, all three worker notes, and 0.1.356 review inputs. Start at `src/core/delivery/delivery.ts`: test a failed main-store commit and an edit between lint read and acknowledgement. Inspect conditional acknowledgements, config-summary reseeding, Stop after config change, CLI disk provenance, five-entry cap, eval parsing, and unchanged off/015 output. Also review pnpm frozen install, CI and lock-format validity helpers against the previous npm release. No full suite/checkpoint or worker build. Use affected evidence and exact-head CI.

Every review brief retains wave-1 lessons: test keys against actual tool reads; include an edit between two steps; a known wrong-result gap needs repair before acceptance; real ESLint tests also run on Node 22.19 (`/home/agent/.nvm/versions/node/v22.19.0/bin`). The human's lint bar is ESLint and published plugins; contrived local rules are D5 boundary 6. Wave 3 and 017-06/07/08 are outside scope. Label proven breaks, plausible concerns and unverified claims separately.
