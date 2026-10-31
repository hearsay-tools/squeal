# Decision card, 2026-10-31: one rule for named waits

Coordinator 339e9539. Input for the human's decision; not normative. Research: `specifications/011-core/research/named-wait-rule.md` (row 011-273). Nothing is built before the human chooses (the human, 2026-10-30).

A **named wait** is an agent asking Squeal for the results of specific test files (`squeal status --wait 60000 test/a.test.ts`). Squeal then runs those files before other queued work. Releases 0.1.377 and 0.1.378 each failed their first review on this part; this card proposes one rule instead of more patches.

## The proposed rule

1. A wait that names files puts them in one group. Groups keep the order the waits came in.
2. The group runs ahead of all work nobody asked for, but only between runs. It never stops a test that is already running; an edit's own tests still run beside it.
3. The group lasts until each of its files has a current result. The daemon saves the group to disk, so a newer daemon continues it after an update.
4. It never changes which tests run or what a result says.

## Measured on the current code (probe, 5 of 5 cases)

- A wait that starts before its file is queued gets no priority when the file is queued later: the cause of #127 (a retry waited about 12 minutes).
- After a Squeal update the new daemon ignores the old daemon's group, so the wait loses its place: #116.
- A wait on more than 20 files loses the extra files' results and times out: #123.

Covered by the rule: #110, #116, #123 (the 20-file limit), #127, row 011-266 S2. Not covered, need their own rows: #123's pattern matching (how files are chosen) and #125's handoff to a manual command (a hold).

## Options

| Option | What an agent sees | Example | Cost and risk |
|---|---|---|---|
| A. Waits, retries and named slow files | A retried or named slow file runs at the next pause between runs; waits survive an update; waits over 20 files finish | #127: the retried file starts as soon as load falls, not 8 minutes later | About 150–250 code lines, 600–900 test lines. Highest risk: two new places where rules compete about what goes first, the kind of conflict that failed review twice. Unnamed work waits longer |
| **B. Waits only, saved to disk (recommended)** | A wait keeps its place across an update and when its file is queued later; waits over 20 files finish; retries and slow files keep today's order and status says why | #116: after an update the agent's wait still runs first | About 60–100 code lines, 300 test lines. Low risk: it does not change how runs are chosen |
| C. Keep today's order; status explains | Nothing faster; each waiting file says why it waits; over-20-file waits are refused with the limit | #116: the agent reads the cause and waits again | About 40–80 lines; no scheduling risk |

**Recommendation: B first**; A can follow if #110 and #127 still cost time after B.

## Questions for the human

1. Which option to build: A, B (recommended), C, or hold?
2. File #123's pattern matching and #125's manual-command handoff as their own proposed rows (recommended), or close them as covered?
