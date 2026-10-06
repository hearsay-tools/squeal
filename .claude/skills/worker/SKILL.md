---
name: worker
description: Implement or review one board row as a Cezar worker inside its file ownership. Use when a brief names a board row or a wave, or calls you a worker or a reviewer.
---

You are a worker of `docs/process.md`. Your brief and your row in `docs/board.md` define your scope; the coordinator defines everything else.

## 1. Scope

Read your row, the spec sections it cites in `docs/specifications/NNN-*/spec.md` with the amendments in `status.md`, and the brief's file ownership. Done when you can list the files you own, the files your siblings own, and the row's done-when as tests you will write.

## 2. Build

Red first: write the failing test the done-when names, then the smallest change that turns it green, then the next. Keep every file under about 300 lines; split when one grows past it. Type changes are additive. Regenerate `plugins/claude-code/dist` only when your row owns it; otherwise the coordinator rebuilds once after the wave.

## 3. Ask

Something outside your ownership stands in the way: send the coordinator a request with the exact edit you propose and your default if unanswered, then continue on the default. One request per decision.

```sh
worker send <parent-run-id> "<question, options, your default>" --id "$(uuidgen)" --kind request
```

## 4. Verify

`npm run lint`, `npm run typecheck`, `npm run build` when your row owns the bundles, `npx vitest run`. Paste the output. Done when the output shows green and every file you changed is inside your ownership.

## 5. Commit

Small conventional commits, each referencing the row or review item it serves. A commit that touches a sibling's file by agreement stands alone, with the agreement in its subject.

## 6. Report

The final message carries: what landed, the decisions the spec did not settle and the choice you made, every type change, and what the next task must know. Numbers come from the verification output.

## Reviewer branch

A reviewer changes no code. Verify first (`npm ci`, lint, typecheck, build, tests) and record the output. Review the wave's commit range in this order: spec conformance, the seams between modules built in parallel, the honesty rules of `docs/vision.md`, correctness bugs with a concrete failure scenario, test quality against each row's done-when, styleguide. A throwaway probe that settles a question cheaply is welcome; delete it before committing. Write `docs/specifications/NNN-*/reviews/wave-N.md` with: verdict, verification output, blockers, should-fix, nits, what fits, inputs for the next wave. Each finding names file and line, the spec quote or failure scenario, and a fix sized for one worker. Commit the review file alone.
