# 014 squeal ps: status

Stage: draft (spec written 2026-10-21 from 014-01 to 014-03; awaits the human's review before any board wave)
Started: 2026-10-21

## Decisions so far

- 2026-10-21, the human: one command, `squeal ps`, that shows every live Squeal daemon and every test process Squeal started, each with its CPU and memory, and flags what should not be up, so the human can check what occupies the host. It prints one snapshot; a live view is out (a `--watch` can be a later row). It reports and changes nothing: each flagged line names the command that would end it. Beside Squeal's own processes it shows the host totals (load, CPU pressure, memory) and Squeal's share of them; it lists no other process.
- 2026-10-21, the coordinator's assumptions, for the spec to confirm or change: the default covers every daemon of the user on the host, grouped by repository with the current one first, and a flag narrows it to this repository; `--json` gives a versioned shape (styleguide); Linux through `/proc` first, macOS as far as research finds.

## Open questions

- D9: should the daemon record its last use (`daemon-used:<id>` in `meta` with each heartbeat), so that `past-idle` and `past-unused` are exact? Coordinator's recommendation: yes, as its own first-wave row. Without it both flags are left out.
- D10: Linux only in this spec, macOS later? Coordinator's recommendation: yes; no macOS host is available to test on.
- The coordinator's assumptions above, now written as D1 (host default, `--repo`), D8 (`--json`, `v: 1`) and D10.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).
