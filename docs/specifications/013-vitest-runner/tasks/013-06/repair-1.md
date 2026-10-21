# 013-06 repair 1: a separate project config's root server is emptied too

Use /worker. Shape: repair. Outcome: `closeEmptied` also empties the root Vite server, its environments and the core project when the root config selects only a separate project config.

The finding (reviewer 571f6813 on cand/0.1.250, before `../../reviews/0.1.250.md`): `Vitest.close` clears `vitest.vite` for the unselected core project before `emptyClosed` gathers its targets. The probe left the root server with 31 own keys, the core project with 25 and the root environments with 21, 20 and 17, and all three root graphs survived three last-resort GCs. Inline projects share the root server and pass.

Read `brief.md` and `notes.md` beside this file, and `src/runners/vitest/empty-closed.ts`.

First edit, a lead: in `empty-closed.ts`, gather the targets before awaiting the close and empty them after it resolves; add the core project (`coreWorkspaceProject` or Vitest 5.0.3's equivalent) when `vitest.projects` lacks it. When the close rejects, leave every target whole.

Tests first, red before: in `test/runners/vitest/empty-closed.test.ts`, a root config that selects only a separate project config file. Before the close, take a `WeakRef` to every root and project module graph. After a recreate, then a forced GC: the closed instance, its core project, its servers and their environments have no own property, and every graph is collected. Do the same for a slow pass's close.

Owns: `src/runners/vitest/empty-closed.ts`, `test/runners/vitest/empty-closed.test.ts` and its fixture. If the key-format test flags a new changed line, ask before you edit `test/keys/validity/`.

Done when: the new test fails before the fix and passes after; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` are green apart from the bundle drift (or `npx vitest run test/runners/vitest test/keys`, if no daemon validates; say which), with the output pasted; the key-format test passes with no version raise. No `npm run build`. Commit on your branch.
