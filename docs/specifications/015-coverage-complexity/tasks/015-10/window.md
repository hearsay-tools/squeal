# 015-10 dogfood window

Times complexity was switched on, for the dogfood worker (015-10 Part B).

| Repository | Switched on | By | Commit |
|---|---|---|---|
| squeal | 2026-10-24T03:55Z (lands on main with this commit; each worktree from then on) | coordinator 52e58f23 | this commit |
| cezar | 2026-10-24T06:26Z (local commit on `main` in `/home/agent/projects/cezar`, not pushed; the human, 2026-10-24: "make and commit a change on this host. We will merge it later") | coordinator 52e58f23 | cezar `03c905a00` on `d1ac04b15` |

Notes for the dogfood worker:

- Installed plugins at switch-on: Claude Code cache 0.1.283 and 0.1.284, Codex cache 0.1.284. A daemon started before the refresh reports the key as unknown until it restarts.
- With the default include and exclude, the first count in the coordinator's worktree gave 110 functions over 20. 29 were throwaway research probes under `docs/specifications/*/research/probes/`, so this repository adds `docs/**` to `complexity.exclude` (a repo-local choice, coordinator 52e58f23); then 81 over. By directory: `src` 60, `evals` 11, `test` 10 (the 29 in `docs` are gone).
- Seen at switch-on: `squeal code` lists 4 files as `parse-error` with 0 unknown functions. Three are barrel files with `export type * from` (`src/core/code/store/index.ts`, `src/core/code/pass/index.ts`, `src/core/types/index.ts`): the shipped grammar seems not to parse TypeScript 5.0's `export type *`. The fourth is a fixture that is broken on purpose. Judge whether this is a defect (a proposed row) and how often it appears in cezar.
- cezar: default include and exclude. Its task worktrees fork from its configured base `origin`, which resolves to `origin/main`, so the local commit reaches only sessions in cezar's main checkout. The human, 2026-10-24, asked whether the dogfood needs more; the coordinator said no, so it stays that way: round 1's evidence is this repository, plus cezar's main checkout. Once the human merges 03c905a00, new cezar tasks get it. Count sessions per checkout, and say how thin cezar's sample is.
- Seen by the coordinator at revision 55 (2026-10-24, ~04:45Z): a `git rebase` onto `origin/main` brought in other coordinators' commits, and the next delivery held four `STILL FAIL complexity:` lines (`namedLine`, `waitForNamed.<withStatusStore>`, `recordFocusedTier.<map>`, `report`) for functions this session never edited, under the title "4 complexity changes". D6's first-edit rule treats a pulled change as the agent's edit. Count how often this happens, and judge whether `STILL FAIL` should skip revisions that came in by a pull, rebase or checkout (a proposed row).
