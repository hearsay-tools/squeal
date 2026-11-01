# Wave 3: ESLint dogfood (017-13), beside oxlint research (017-12)

The human, 2026-11-01: "Both at once". 017-12 is a research brief, `../research/oxlint-provider-brief.md`. This file is 017-13.

## 017-13 dogfood of the ESLint lint check in live sessions

Use /worker. Shape: finish, dogfood. **Outcome:** `lessons.md` (create it) gains "Round 1 (017-13)". It answers open questions 1, 4 and 5 and goal 9 with evidence from real agent sessions: what the lint check tells an agent while it works, whether that is right, and what the agent does with it. The pattern is 015's `tasks/wave-1.md` Part C.

**Read:** `spec.md` goals, D5, D7 to D10, Testing and Open questions; `tasks/017-09/notes.md` and `tasks/017-10/notes.md` for the store and the wording; 015 `tasks/wave-1.md` Part C for isolation.

**Isolation.** Use the OS user `squeal-e2e` (uid 1002, home `/home/squeal-e2e`, Node in `/opt/squeal-e2e/node22` and `node24`, `claude` in `/home/squeal-e2e/.npm-global/bin`). Start each process as `sudo -n [--preserve-env=NAMES] -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... <cmd>` with cwd `/`. Pass credentials by name only. Install Squeal 0.1.390 (tag `squeal--v0.1.390`) for that user's Claude Code from a `git archive` copy. Bring each repository in with `git bundle`, install its packages as that user, and set `"lint": { "enabled": true }` in its `squeal.config.json`.

**Repositories.**
1. `~/projects/saas-bp-management-dashboard` at `b36f7150`: ESLint 9.39.2, an Nx monorepo, 144 `eslint.config.js` files, the import resolver, about 2,400 source files. Read-only on the original.
2. One public repository with ESLint 10, flat config and typed rules, from `research/eslint-provider.md`'s survey (svelte or astro), cloned at a named commit.

**Sessions.** Eight `claude -p` sessions on `--model sonnet`, four per repository, each a real small task:
1. an edit that adds a lint finding (one `FAIL lint` expected);
2. a fix of an existing finding (`PASS lint`);
3. a refactor that moves code and keeps the findings (no notice);
4. an ordinary task with no lint aim (noise).

Before the sessions, record each repository's first pass: its time to the end, the CPU and the RSS. Start each session only when the one-minute load is at or below 24, and record the load.

**Record per session:** every SQUEAL line that names lint; the agent's next action; whether the line was right (compare it with a fresh `eslint` CLI run on the same bytes); the time from the edit to the delivery; the worker's CPU per edit and its RSS.

**Rules.** Write only under `/home/squeal-e2e`, `/tmp/dogfood-017-13/`, and your worktree's `lessons.md` and `tasks/017-13/`. Change no product code. Each defect becomes a proposed row in `lessons.md`, with its reproduction. Stop every daemon you started and show that none is left.

**Done when:** `lessons.md` Round 1 is committed with every session's record, answers to open questions 1, 4 and 5, goal 9's cost with the load, and the proposed rows.
