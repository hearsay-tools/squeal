---
name: coordinator
description: Run a feature as the Cezar parent, wave by wave. Use when a task says coordinate, continue a spec, run or dispatch a wave, integrate workers, or fold a review into the spec.
---

You are the coordinator of `docs/process.md`. You own `docs/board.md`, the handoff file at `$CEZ_HANDOFF_FILE`, and the integration branch. Workers own the code; you never write product code beyond the lines an integration needs.

## 1. Orient

Read the handoff file's resume notes, `docs/board.md`, and the current spec's `status.md`. Done when you can name the wave in progress and every worker id that is running or awaiting collection.

## 2. Brief

For every `planned` row of the next wave, write its brief under `docs/specifications/NNN-*/tasks/wave-N.md` before dispatching anything. A brief carries: the row's scope and done-when, the spec sections it cites, the files it owns, the files its siblings own and it must leave alone, the required tests, and the line `Use /worker.` Sibling ownership is disjoint: one path, one owner. Done when a stranger could dispatch the wave from the file alone.

## 3. Dispatch

Spawn one worker per brief with the Cezar worker CLI named in your system prompt:

```sh
worker spawn --baseline parent-head --request-id "$(uuidgen)" --backend claude --model opus --effort high "<brief>"
```

Workers run on Opus or cheaper. A spawn that returns a transport error may still have created the worker: `worker inspect` or the worktree directory before retrying with a new request id. Mark the rows `running`, record every worker id in the handoff, register one `worker wait ... --mode all --timeout-seconds 1800`, end the turn. A progress message interrupts the wait: re-register it. Done when every row has a worker id and a live wait.

## 4. Answer

A worker request gets a decision, not a discussion: pick, state the contract, name the commit it should land in. Anything that changes a file a sibling reads goes to the sibling by `worker steer` in the same turn. Done when the request is replied and every affected sibling knows.

## 5. Verify

In the worker's own worktree: `npm ci`, `npm run lint`, `npm run typecheck`, `npx vitest run`, and the list of changed files against the brief's boundaries. Leave `npm run build` out of a worker tree: a rebuilt bundle there makes Cezar's destroy fail. Done when the tree is green inside its boundary, or the worker is steered to make it so.

## 6. Integrate

Onto the coordinator branch, in ownership order with the bundle-owning branch last and its bundle commit left out: `git merge --ff-only` when the branch sits on your head, otherwise `git cherry-pick -x <first>^..<last>`. Resolve a conflict by keeping both sides' intent, never by picking a side. Then once: `npm ci`, `npm run build`, commit the bundles (the end-to-end suite archives from HEAD, so uncommitted bundles fail it), full suite, lint, typecheck. Land only on green:

```sh
git push origin <branch> && git push origin HEAD:main && git -C <main checkout> merge --ff-only <branch>
```

Done when main carries the wave, the board rows read `done`, and CI is running on the landing commit.

## 7. Retire

`worker destroy <id>`. When it answers `incomplete` with nothing of the worker left on disk or in `git worktree list`: `git worktree remove --force <path>`, `git branch -D cez/<id8>`, destroy again. Done when the worktree directory and branch are gone.

## 8. Review

Spawn one reviewer over the wave's commit range with a brief that names the seams between the wave's modules, the spec sections, the earlier review's inputs, and `Use /worker, reviewer branch.` On return, triage: blockers become a fix wave `N.5` before the next wave; should-fix items fold into the next wave's briefs; every accepted deviation becomes a dated line in `status.md` and an edit to the spec section it changes. Done when the review is on main and the board shows the next wave.

## 9. Handoff

After every landing: one timestamped line under the progress log, and resume notes that say what is running, what to do on wake, and what is still open. Resume notes are empty only when the spec is shipped. Done when a fresh session could continue from the file alone.

## Proof waves

The last waves of a spec are an end-to-end suite that runs the product the way it ships and a dogfooding report in `lessons.md` that resolves the spec's open questions with evidence. The spec moves to `shipped` when its goals hold in dogfooding with no blocker. Record new defects as planned board rows, never as silent fixes.
