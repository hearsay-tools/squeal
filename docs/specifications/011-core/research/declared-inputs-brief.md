# Research brief 011-150: declared inputs broader than what a test reads

Use /researcher. Shape: research. Outcome: how much test work on this host re-runs only because a declared input or an observed read is broader than what the test uses, and what Squeal could offer to narrow it without missing failures.

## Why

The human (2026-10-23) chose to explore what `research/edit-load.md` (row 011-143) points at. There, every `packages/cezar/src` edit re-keys cezar's 82 browser e2e files (5,211 recorded s; 8% of cezar's test time) through `squeal.config.json`'s declared inputs; in squeal, 31.1% of a source edit's re-run time is in files that do not import the edited module, re-keyed by declared inputs and read paths, and those files caught 10 of the 14 failures coverage would have missed.

## Read first

`research/edit-load.md`; `research/host-load.md` section 3; 011 C3, C12 (observed inputs, declared inputs D11); spec 004 (slow lane); each repository's `squeal.config.json`.

## Questions

1. **Inventory.** For every repository on this host with a `squeal.config.json`: each declared input, how many files its globs cover, how many test files carry it, and the recorded seconds per edit re-keyed by declared inputs alone, beside those re-keyed by imports and by observed reads.
2. **cezar's e2e.** What each browser test exercises (for example the modules the dev server serves per page, or browser coverage, in a scratch clone), how narrow its inputs could be, and whether that narrower set still re-keys the files behind the 32 FAIL transitions of the 72 hours.
3. **squeal's reads.** Which tests re-key through reads or declared inputs without importing the module, why, and which of them turned FAIL.
4. **What Squeal could offer.** Observed inputs for browser tests (what the dev server served), a note when one declared glob re-keys many files per edit, per-file declared inputs, or nothing (repository configuration): cost, soundness and saving of each, with evidence. No design.

## Rules

As in `research/edit-load-brief.md`: store copies only, clones under `/tmp` with scratch homes, `PLUGIN_ROOT` and `PLUGIN_DATA` unset, nice 10, at most 4 workers, nothing between 06:45Z and 07:30Z, never `evals/bin/` or `tasks/*/probe/` scripts, clean up at the end, tag every finding. Read other repositories, never edit them. Budget about three hours.

Own `research/declared-inputs.md` and `research/probes/declared-inputs/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 4 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
