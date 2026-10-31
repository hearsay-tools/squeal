# Wave 61: rows 011-274 to 011-278 (the second approved rows of 2026-10-30)

Coordinator 339e9539, 2026-10-31. The human approved these rows on 2026-10-30 (board, Triage rows gh-111, gh-120, gh-109 with gh-128, gh-126, gh-124). Dispatch after wave 60 lands; one candidate; the version is claimed with the peer coordinators before dispatch.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; no added CPU load; no `pnpm run build`. Not yours: the board, `spec.md`, `status.md`, bundles, version. Read affected results with `squeal status --wait 60000 <paths>`.

Three rows change status text. Keep to your seam; when you must edit a shared formatter, make the smallest change and name it in your notes.

## W1: row 011-274 (gh-111: which files ended while their tier still runs)

Use /worker. Shape: slice, one commit.

Outcome: a named wait on a file that ended says it ended and what it still waits for, without calling it current.

Read: board row 011-274; `research/issue-111.md`; spec 011 C4 step 5, C6, C15; `test/scheduler/` tests on `Tier.ended`.

Seam and lead: `Tier.ended` (`src/core/scheduler/tiers.ts:528`) holds the ended files; `yield-history.ts:62` publishes only `ended.size`. Publish the ended file ids per run, and in `src/cli/named-file-lines.ts:256` write "ended, awaiting the tier's final checks" and the unfinished peers (or "unknown").

Owns: `src/core/scheduler/yield-history.ts`, `src/core/status/standing-yields.ts`, `src/cli/named-file-lines.ts`, the run-state type they share, their tests, `tasks/011-274/notes.md`. Leave alone: verdict and currency rules.

Done when: tests, red before: a fast file behind a slow peer, a late run error after a file ended, changed inputs, a delayed end report; ended never reads current or passing; text and JSON agree. Lint and typecheck pass.

Stop and report when this needs a change to when a result becomes current.

## W2: row 011-275 (gh-120: configuration a pinned runtime cannot apply)

Use /worker. Shape: slice, one commit.

Outcome: when a session's runtime cannot apply a configuration key, status and the session's first notice say which key, which runtime, what it costs validation, and how to restart or update.

Read: board row 011-275; `research/issue-120.md`; spec 011 C6, C10; spec 002 D7 to D9; spec 005 D3.

Seam and lead: unknown keys are reported in `src/core/daemon/config-file.ts`; carry them into the daemon's status (`src/core/status/`) as ignored rules, with the runtime version, and into the registration notice. Name the cost for keys whose cost is known (`runtimeFiles`: extra re-runs); otherwise "not applied".

Owns: `src/core/daemon/config-file.ts`, `policy.ts`, a new status part for ignored configuration, the registration line that shows it, their tests, `tasks/011-275/notes.md`. Leave alone: session pinning (`src/harness/*/adapter/store.ts`), liveness text (W3).

Done when: tests, red before: an unknown key, a recognized key beside it, only known keys; text and JSON keep ignored apart from applied rules. Lint and typecheck pass.

Stop and report when the fix needs a change to which runtime a session uses.

## W3: row 011-276 (gh-109 with gh-128: a late heartbeat is not stopped validation)

Use /worker. Shape: repair, wording only, one commit.

Outcome: a hook or status that finds a late heartbeat says it is late, with its age, and that the daemon may be busy or stopped; "stopped" only when a stop or exit is recorded.

Read: board row 011-276; `research/issue-109.md`, `research/issue-128.md`; spec 011 C6, C8, C9; spec 004 D8, D9.

Seam and lead: the "no daemon is validating" sentences in `src/core/delivery/liveness.ts`, `format.ts`, `src/core/status/identity.ts`, `src/cli/status-wait-lines.ts`, `src/core/state/slow-text.ts`, `src/harness/shared/`. Use the evidence each already reads. No new probe, ping or state.

Owns: those files' liveness sentences, their tests, `tasks/011-276/notes.md`. Leave alone: the liveness decision itself, socket probes, W2's notice part.

Done when: tests, red before: a late heartbeat, a recorded stop, a recorded exit, recovery; hook, status text and JSON say the same. Lint and typecheck pass.

Stop and report when a sentence cannot be correct without new evidence.

## W4: rows 011-277 then 011-278 (gh-126 and gh-124: worktree lifecycle)

Use /worker. Shape: slice then docs, two commits in this order.

Outcome: 011-277: `squeal stop <root>` stops a removed worktree's own daemon from its saved identity. 011-278: an orchestrator can read how to hold validation in a child worktree before it starts.

Read: board rows 011-277 and 011-278; `research/issue-126.md`, `research/issue-124.md`; spec 011 C1, C8, C9, C14.

Seam and lead: 011-277: `src/cli/stop.ts:171` refuses a missing root before it resolves a daemon; resolve the saved identity (`worktreeIdFor` and the daemon record) from the path and stop only that daemon and its test children. 011-278: the skill reference an orchestrator reads (find where `stop --until-start` is documented): create the child, `squeal stop --until-start <child root>`, then start the child's session, and `squeal start <child root>` to end it.

Owns: `src/cli/stop.ts`, `src/cli/daemon-access.ts` where needed, their tests, the skill reference page, `tasks/011-277/notes.md`. Leave alone: the stop mark's scope, the status text (W1 to W3).

Done when: 011-277: a two-worktree test removes A while a test runs, stops A after deletion, B goes on; a stale or reused identity and an exited daemon are safe; the result says stopped, remaining or unknown. 011-278: the page names the order and the end of the hold. Lint and typecheck pass.

Stop and report when a removed path cannot be told from another worktree's identity.

## W3, second commit: row 011-282

Also in W3, after 011-276: the `Slow tier:` line in `src/core/state/slow-text.ts` names the slow slot for a `waiting: slot` that a full worker pool also publishes. Use the words of review `reviews/0.1.382.md` B1's fix (`holdText` in `src/core/retry/text.ts` after wave 60.5); keep a recorded holder when there is one. Done when: a full pool with a free slot reads as capacity; text and JSON agree.
