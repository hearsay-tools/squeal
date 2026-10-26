# Wave 2: lint presentation and pnpm

Approved scope: human, 2026-10-26. Rows 017-06/07/08 and wave 3 remain planned.

## Rules for every row

1. Test a key against the bytes the tool actually read, not against a list.
2. Include the reviewer’s attack: an edit between two steps, including a read and its presentation or acknowledgement.
3. A noted gap that can store or display a wrong result goes back to the worker before review.
4. Tests running real ESLint must also run on CI’s Node 22.19: `/home/agent/.nvm/versions/node/v22.19.0/bin`.

Use Squeal affected results, lint and typecheck. No full-suite run or checkpoint. No build in worker trees. Do not edit board/status, generated bundles or versions. Leave committed notes with actual evidence under your row’s task folder. The repository will use pnpm; before migration lands, existing npm commands still work. Preserve npm support in product fixtures and users’ projects.

## 017-09: lint presentation logic

Use /worker. Shape: slice. Make truthful lint snapshots, registration, consumer news, changed details and Stop evidence available from the lint store for D8’s callers.

Read spec D2/D6/D8/D9 and status amendments; tasks/017-04/notes.md and tasks/017-05/notes.md; reviews/0.1.356.md inputs. Start at `src/core/lint/store/views.ts`: first write a test that seeds a consumer, changes a finding, then reads and acknowledges its news. Follow `src/core/delivery/code-deliver.ts`, `code-since.ts` and `code-source.ts` as the template.

Own new `src/core/lint/surface/**`, `src/core/types/lint-delivery.ts`, `test/lint/surface/**`. You may extend lint store/pass records only when needed to record D8 facts at their source; keep those changes in separate commits. Do not change provider/keys, CLI, shared delivery/status/harness, evals or package tooling (siblings’ files).

Send the proposed exported API to the parent early for 017-10. Done when tests prove count seeding, silent repeat, independent consumers, config summary/reseed, cap/overflow, changed selection, removed-file resolution, off/missing store, honest pending/stale/unknown reasons, and only new current failures eligible for opt-in Stop. No unknown/stale PASS. No test failures or denied edits from lint. Edit between read and acknowledge must preserve later news.

## 017-10: CLI and agent wiring

Use /worker. Shape: slice. Wire 017-09’s API into `squeal lint [path...] [--changed] [--json]`, status, registration, agent delivery, and opt-in lint Stop.

Read spec D2/D6/D8/D9, status amendments, both wave-1 task notes and reviews/0.1.356.md inputs. Start at `src/cli/main.ts`: first add a failing lint-command test beside code-command tests. Use `src/core/delivery/code-format.ts` and existing code fields as the presentation seam.

Own CLI lint modules and main dispatch, new lint adapters under delivery/status/harness, minimal wiring in existing daemon/shared types/delivery/status/harness, lint-focused CLI/harness/evals tests, and eval parser only as needed. Do not edit sibling lint surface/types/store/pass code or package tooling, existing 015 logic, generated bundles, board or status. Parent supplies the 015 agreement before shared edits; request any additional file ownership.

Done when real formatter output passes the eval parser plain/hook JSON, test failures appear first, five lint changes plus correct overflow, registration/status/off reasons are truthful, daemon-free detail and --changed work, opt-in Stop counts only eligible lint failures and never denies writes, and off-mode outputs remain identical. Include a revision/read race. Use 017-09 exports; do not duplicate its logic.

## 017-11: pnpm for repository development

Use /worker. Shape: slice. Migrate this repository’s development install, scripts and CI to a pinned pnpm version with a frozen lockfile.

Read package.json, package-lock.json, test/fixtures/lint/toolchain/package.json, .github/workflows/ci.yml, scripts/check-version-bump.ts, current contributor/agent instructions and 017-04’s test-only dependency notes. Start at package.json: pin packageManager and replace the build script’s npm call; import the lockfile without broad dependency upgrades.

Own package.json (no version raise), pnpm-lock.yaml, pnpm config/workspace files, removal of root package-lock.json, active workflow/script/development-instruction command updates, and narrowly necessary install-layout compatibility tests/helpers (request source ownership first). Other workers own lint feature and CLI/delivery; leave their files, all generated bundles and historical research/reviews untouched. Product npm support, npm aliases, npm test fixtures and user install commands stay supported.

Done when a clean frozen pnpm install resolves ESLint 9/10 and isolated TypeScript 6 toolchain beside root TypeScript 7, targeted real lint tests pass on Node 22.19, lint/typecheck pass, and CI uses pnpm cache/install/exec correctly. Document exact pnpm version, native dependency build policy and necessary install layout decisions. No build/full suite in worker tree. Report any key-validity implications; do not silently weaken keys or update replay recordings.
