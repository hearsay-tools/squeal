# Research brief 014-03: what should not be up, and how others list it

Use /researcher. Shape: research. Outcome: a list of the states `squeal ps` flags, each with a cheap read-only detection rule, the healthy states it could wrongly flag, and the command that would end it; and how comparable tools lay out such a listing. Follow the rules in `README.md`.

Read first: every spec's `lessons.md` and the board's rows and Later items on leftovers, orphans, daemons that did not exit, old versions, stale sockets and `/tmp/squeal-e2e-*`; 011 C9 (every exit rule: root or worktree gone, sessions gone, idle, unused, reinstalled, step-down), C10 Capacity (permits), C13 (the leftover scan); 012 CC4 (the idle waiter); 004 D2 (the slow lock).

Questions:

1. **The list.** For each state the evidence shows has happened, or the rules imply can happen (a daemon past an exit its rules require; a daemon whose root or worktree entry is gone; an older release beside a newer install; two daemons of one worktree; a test process whose daemon is gone or whose tier ended; a socket, lock or permit with no live holder; temp directories left behind; an idle waiter or consumer whose harness process is gone): its source (row, defect, lesson), how to detect it read-only, its cost, the healthy states it could flag, and the command that ends it.
2. **The host now.** Apply the list read-only to the host and report what it finds, with the load. For example: are the two 0.1.234 daemons of the snapshot right to be alive? Stop nothing.
3. **Time bounds.** Which flags need a time bound (a tier past `runner.timeoutMs`, a daemon unused past `daemon.unusedExitMinutes`), and which setting gives each.
4. **Prior art** (`read in official docs`): `docker ps` and `docker stats`, `pm2 ls`, `gradle --status`, `nx daemon`, `turbo daemon status`, `watchman`, `systemd-cgtop`. Their columns, grouping, how they show a problem, their JSON form, and their default scope (project or host).

Own `should-not-be-up.md` and `probes/should-not-be-up/`.
