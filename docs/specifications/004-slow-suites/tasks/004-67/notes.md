# 004-67 notes (worker, 2026-10-17)

## Seam map

- `src/harness/shared/no-edit.ts`: `unchangedSinceRegistration(store, consumer)`. It is true when the consumer's registration revision (`registration().since`, the `registered` meta row, `src/core/delivery/registered.ts`) is still the latest revision and `seesEveryChange` holds. That second check means the daemon that had finished its start scan at registration is still the one recorded, because an edit made while no daemon ran sits in no revision until a later start scan. It counts any revision, including one from another session. A consumer that left and came back keeps its old `since`, so any revision since its first registration restores the wait.
- `stop-slow.ts` (waiting entry): after `handedOver`, before `waitForSlow`, it returns `null` in a read transaction.
- `stop.ts` (2 s entry, by coordinator agreement): `decide()` skips the slow reason for `MAIN_AGENT` in its own read transaction. This covers Pi, OpenCode, an untrusted Codex hook and the first Stop before the `stop-wait:` row exists. SubagentStop still blocks.
- Primer: the policy-on sentence is 6 characters shorter than 0.1.206's, so every fold decision stays the same (Claude Code and Codex, 0 to 2 node:test projects). `primer-slow-policy.test.ts` pins its length against the old sentence.
- Skill: step 4 says "required once you edit" (the body budget is under 5,000 characters, now 4,997). `commands.md` says "means it is, once you change a file". The `stop.requireSlowSuite` row in `policy.md` names the exemption. `skill.test.ts` now compares `policy.md` across the copies.

## Test fixtures

`stop-slow-helpers.ts` `repo()` and `stop-require-slow.test.ts` `repo()` now register before revision 1, so revision 1 is the session's edit. `edit(r)` in the helpers adds a revision after a re-registration. Tests that register a second session or re-register use it.

## Residual risk

An edit in the agent's last tool call that the watcher has not yet turned into a revision (100 ms quiet, 500 ms maximum debounce) reads as no edit. In practice the model's final message takes longer than that. The waiting entry checks after the handoff to leave more time.
