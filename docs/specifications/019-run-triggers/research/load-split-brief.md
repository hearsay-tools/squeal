# Research brief: where Squeal's test CPU goes now, by trigger

Use /researcher. Shape: research. Outcome: the current split of Squeal's test CPU on this host by what started each run, with what each share buys, so the human can choose between a "manual" group moment, moving the edit cut's catch-up to a later moment ("light" mode), and cutting runs that keep no result.

## Why

The human, 2026-11-05: "looking at this host load since we started using squeal - it's busy all the time. So I am looking for ways we could allow the config to decide what needs to be delivered fast, what should be available on demand, what do we cover on stop etc." The only split by trigger, `011-core/research/edit-load.md` finding 6 (72 h to 2026-10-23), was taken before the human removed routine full-suite checkpoints (2026-10-25). Its shares: checkpoints 46.3%, work that stored nothing 38.7%, edit route 17.9%, catch-up of edits 14.5%, catch-up of pulls 4.8%, unknown backlog 9.5%.

## Read first

`docs/vision.md`; `011-core/research/edit-load.md` (method, classes) and `011-core/research/probes/edit-load/work.mjs`; `011-core/research/edit-cut.md`; `011-core/research/host-load.md` and `011-core/research/probes/host-load/`; spec 011 C4 (edit work, catch-up, quiet); spec 019 D1 to D3 (groups, moments, lanes); `src/core/scheduler/edit-cut.ts`, `quiet.ts`.

## Questions

1. **The split now.** Re-run the `edit-load.md` classification over the last 72 h of copies of this host's stores (squeal, cezar, toolkit-dev, any other with a store): recorded seconds and an inferred CPU range per class, per repository and pooled. Same classes, so the two dates compare; add the slow lane and check groups by name where a repository has `checks`.
2. **Runs that kept no result.** Split this class by cause (timed out, discarded or replaced at the same key, cancelled by an edit, yields, other) and name the trigger each one came from.
3. **Catch-up.** Per repository: catch-up seconds per edit, the share in node:test and pytest (no quiet wait there), and the test files that turned to FAIL or PASS only in catch-up, with how long after the edit.
4. **What the human's two ideas could save.** From 1 to 3, an upper bound for each: (a) groups the project would mark manual (name the candidates in each repository's config, for example cezar's e2e and slow files); (b) catch-up moved to pause, Stop or commit, including how often a pause or Stop came before the catch-up would have run.
5. **Ranking.** Every share above 5% of one repository's or the pooled seconds, by seconds, each with what it buys (a verdict, an earlier verdict, nothing).

## Rules

As in `011-core/research/edit-load-brief.md`, "Rules": copy each store with its `-wal` and `-shm` before reading; never open a live store, socket or permit pool; never run `evals/bin/*` or `tasks/*/probe/`; no test runs are needed, so start none; tag each finding; lead with seconds and shares, then n. No design. Budget about two hours.

Own `research/load-split.md` and `research/probes/load-split/` in this folder only. Edit no board, spec, status, test or product file.

Done when questions 1 to 5 each have an answer with numbers and tags, the two dates compare class by class, and the probe README says how to re-run it. Commit.
