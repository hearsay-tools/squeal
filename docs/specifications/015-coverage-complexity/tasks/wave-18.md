# 015 wave 18: coverage off by default again

Briefed by coordinator 52e58f23 on 2026-10-26. The human, after 0.1.358 and the dogfood's Round 2 (94 coverage lines since 0.1.341, 0 useful): "OK, off by default for now". One worker.

## W1: 015-89

Use /worker. Shape: slice. Starts from main 0.1.358. Outcome: a project whose squeal.config.json does not set `coverage.enabled` takes no coverage; complexity stays on by default; a project that sets `"coverage": {"enabled": true}` behaves exactly as in 0.1.358.
- Read spec 015 D1 and D8 (**Keys**), `status.md` from 2026-10-26, and commit `a2ab372a2` (015-64, which turned the default on).
- **Lead.** `src/core/types/policy.ts:344`: `DEFAULT_POLICY.coverage.enabled` to `false`. `untested` and `crap.enabled` stay `true`, since they act only under `coverage.enabled`.
- **Words.** The three skill copies `plugins/{claude-code,codex,pi}/skills/squeal/references/policy.md` (and their source, if one exists): the default reads `false`, with one opt-in example. The same section still says "its own Vitest runs": since 0.1.358 that is "its own Vitest and node:test runs" (D8 **node:test**). Any other default text you find (status, setup, README).
- **Owns.** `src/core/types/policy.ts`, the skill references, the tests that assumed the default (a test about coverage sets it on itself), and any default text above. This repository's `squeal.config.json` keeps `"enabled": true`. Ask before any other source file.
- **Done when.** Tests, red first: a worktree with no coverage setting gets no coverage step, no session-start coverage sentence, and no `untested` or CRAP state; one with `coverage.enabled: true` gets all three. Its Vitest and node:test keys equal those of 0.1.358 with `coverage.enabled: false` (a validity case or a key test). Notes in `tasks/015-89/notes.md`, with the D1 sentence you propose. Lint, typecheck, `squeal status --wait 60000 <changed-path>...`; paste both. No full suite, no bundles, no version.

## R1: review the 0.1.361 candidate

Use /reviewer. Shape: review. Review the exact candidate SHA in the dispatch against base `ac0f538a7` (main 0.1.359 plus docs). Read W1, D1, D8 **Keys**, the 2026-10-26 default-off decision in status.md, and tasks/015-89/notes.md. Own only `reviews/0.1.361.md`; change no product, test, spec, board or bundle file.

Check default-off and explicit-on behavior, session-start wording, both runners' keys, skill parity, and committed version and bundle consistency. Complexity stays on and this repository keeps coverage on. A project without the coverage setting changes keys once at upgrade. The notes name broader affected checks with unknown verdicts before the build.

Use targeted checks and Squeal evidence; read candidate CI. No local full suite, full-suite checkpoint or build. Run relevant node:test checks on Node 22.19.0 with `$HOME/.nvm/versions/node/v22.19.0/bin` first on PATH as well as the default runtime. Record exact commands and results; label proven, plausible or unverified findings. Commit the review file. A proven break blocks; do not merge or release.
