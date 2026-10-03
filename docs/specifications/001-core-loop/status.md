# 001 Core validation loop: status

Stage: research
Started: 2026-10-02

## Decisions so far

- Stack: TypeScript, Vitest first, Claude Code first (ADR 0001).
- Project state lives in the main worktree and is shared by all worktrees of the same repo. Worktrees read and write there.
- A new worktree inherits the baseline from the shared store automatically. Spec 001 must choose a state model that makes this a lookup, so a later spec never undoes it.
- Agents receive a diff between what they were last told and the current known state, computed at delivery time, never a replay of raw events.
- Result validity is per check, not per run. No cancel-and-restart on new changes.
- Delivery must reach the agent mid-turn, at tool boundaries, not only at the end of a turn.

## Open questions (research phase)

See `research/README.md`.

## Links

- Vision: `../../vision.md`
- ADR: `../../decisions/0001-typescript-vitest-claude-code.md`
