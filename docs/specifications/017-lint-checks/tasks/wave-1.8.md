# Wave 1.8: the observer's open flags, and Node 22.19

The human, 2026-10-26, on the fourth FAIL (`reviews/0.1.353.md` B1-R4) and the red CI on Node 22.19: "A. Fix; review vs real plugins." One repair, then one review against published plugins and ESLint itself; a project-local rule written to read files in an unusual way is a named limit (D5 boundary 6), not a blocker.

## R5, the observer

Use /worker. Shape: repair. Worker 2e373245, on `int/017-w1` (move `cez/2e373245` there; your tree is clean). Workers run on claude opus xhigh. No `npm run build`.

Outcome: every read-capable open is observed on Node 22.19, 22.23 and 24, and the read-set test shows no unobserved input on any of them.

Read: `reviews/0.1.353.md` (B1-R4 and its fix scope); CI run 40380014921's Node 22 shards (`gh run view 40380014921 --log-failed`); spec 017 D5 "The bytes ESLint used".

Seams, as a lead:
- `provider/observe.ts:275` reads a string flag as readable only when it starts with `r`. Every flag but `a`, `ax`, `as`, `w` and `wx` reads (`a+`, `ax+`, `as+`, `w+`, `wx+`, `r+`, `rs+`), for sync, callback and promise opens.
- On Node 22.19, `reads.test.ts:74` finds `eslint.config.js` unobserved; 30 real-provider tests then store nothing. Node 22.19.0 is installed at `/home/agent/.nvm/versions/node/v22.19.0/bin`; reproduce with it on `PATH`.
- `PROVIDER_VERSION` 4 and `LINT_KEY` `squeal-lint-key/4`, so version-3 results are not reused.

Owns: `src/core/lint/provider/**`, `src/core/lint/pass/**` only as the fix needs, `test/lint/**`, `test/fixtures/lint/**`, your notes. Leave everything else alone.

Done when:
- the reviewer's two-root `a+` case is a real-provider test on ESLint 9 and 10: the second root gets fresh findings, or nothing is stored;
- a flag table test covers every Node string flag and the numeric forms;
- `npx vitest run test/lint/` passes on Node 22.19.0, 22.23.3 and 24.21.0 (state each count);
- lint and typecheck pass; `squeal status --wait 60000` on your changed paths; no full suite.

Anything new that lets a stored result differ from fresh ESLint, in ESLint itself or a published plugin, is a request to me. A contrived local rule is a note under boundary 6.
