# Wave 6 review: FAIL

Candidate: `cand/0.1.547`, exactly `cf4357e2a349ce800e0e4a6a068c633c88a7a637`.
Verdict: **FAIL — five proven blockers; no separate should-fix items or nits.**

## Blockers

### B1 — proven: CI returns a different key from the checkout after shared observations grow

Location: `src/core/commit/at-keys-ci.ts:170`.

Contract: row 023-17 requires “a key from the export equals the key the checkout gives for the same file (exactness).” D2 requires the checkout key. Spec 018 D11 keeps today's exposure in that key. The review brief makes a wrong key a wrong pass.

`settle` keys only the export's closure. The checkout keyer copies the shared observed maps from the repository store. An input that another run recorded therefore enters the checkout key but not the CI key. The notes describe this limit, but it does not meet the row's exactness requirement.

Reproduction on the real-adapter fixture:

1. Commit `test/a.test.ts`, its static import `src/a.ts`, and `data.txt`. Use `withRemote`, `recordHere`, `ciExportAt(f, commit, [TEST])`, and `publishLocal` from the existing fixtures.
2. In the main store, set `observedMetaKey("")` to `JSON.stringify({ "test/a.test.ts": ["data.txt"] })`.
3. Compare `keysAtCommit` for `[TEST]` with the same call using `ci: false`.

Actual output: CI settles one file, returns pass with origin `ci` at `e5e728779c17b3878068beb4f2dc1d05e98c5f407fd4e10c7e57b787183f33fa`; the checkout returns `69b5a48ac3a37723bfab0148166c5a724b1a3c98ca3c2254254553233c28977a` with no result. The equality assertion fails.

Fix scope: one core worker. Match the checkout's shared observed-input rules before accepting a CI key. Send the file to the checkout whenever equality cannot be proved. Do not change the checkout to discard observed inputs. Add this busy-store equality case beside the fresh-store equality test.

### B2 — proven: a stored environment is accepted after an allow-listed variable changes

Location: `src/core/commit/at-keys-ci.ts:189`; caller input at `src/core/commit/at-keys.ts:91`.

Contract: row 023-17 uses a CI result only when the environment equals. Spec 018 D10 says “Every other field must be equal,” including the environment-variable hash. D2 requires the key that the checkout computes under the call's environment.

The CI path reads `worktreeEnvironment` and checks only the live process's Node version, platform and arch. It never receives `KeyingOptions.env`. With no daemon to update the record, an earlier environment remains valid to this path indefinitely. The no-daemon current side and the checkout both use the supplied environment, so the two sides can describe different conditions while CI supplies a known pass.

Reproduction: configure `env.allowlist: ["SQUEAL_REVIEW_MODE"]`, record the environment and make the export with that variable unset, then call with `env: { ...process.env, SQUEAL_REVIEW_MODE: "changed" }`. All commit files stay equal. CI settles one file at `e5e728779c17b3878068beb4f2dc1d05e98c5f407fd4e10c7e57b787183f33fa` with a pass. With `ci: false`, the same call returns `bdfda2f0b4a4fadb824278f74b49187e7a822c5238ea635912c3441ae1d0f4ec` with no result. The equality assertion fails.

Fix scope: one core worker. Pass the call's environment into the CI proof, validate the keyed environment inputs against it, and fall back when the recorded descriptor cannot prove equality. Cover a stopped daemon followed by a changed allow-listed variable. Preserve D10's specific CI-field tolerances.

### B3 — proven: a local export is reported as a CI result

Location: `src/core/commit/at-keys-ci.ts:225`; rendered through `src/cli/status-at-report.ts:82`.

Contract: D3 requires the result's origin. Spec 018 D2 says “The commit and the source are recorded, never inferred later.” The review brief makes a wrong origin a wrong pass.

`recordOf` unconditionally sets `origin: "ci"` and worktree `ci`. Neither `exportOf` nor `importRefusal` requires a GitHub source. A valid local export at the results ref is accepted. `publishExport` also permits such a bundle. The ref's name does not establish the producer.

Reproduction: use the valid bundle from B1's setup without the observed-map edit; replace only `header.source` with `{ kind: "local" }`; publish it at `refs/squeal/<commit>`; ask for `[TEST]`. Actual output includes `ci.source: "local export at 494e6d72"` and a pass whose record has `origin: "ci"` and `runId: "local export at 494e6d72"`. Status converts it to origin kind `ci` and text “from CI's export.” The assertion that a local export must not claim a CI origin fails.

Fix scope: one core worker with a CLI contract check. Refuse local-source bundles in this CI-only shortcut and use the checkout, or carry the actual recorded export source through a documented origin shape. Test the final text and JSON as well as the record. Do not infer CI from a ref or import marker.

### B4 — proven: an undetermined all-file listing can exit 0

Location: `src/cli/status-at.ts:135` and `src/cli/status-at.ts:152`; `src/cli/status-at-report.ts:110`.

Contract: D1 gives exit 3 when some file is not determined. Exit 0 means every selected file is known on both sides.

With no paths, a failed checkout gives no file map. If the working tree now lists no tests, `compareSides` receives an empty union and `exitCode` returns 0. A missing listing becomes an empty successful comparison. With current files present, the same missing map can instead label a file `absent` at the commit, although the checkout never established absence.

Reproduction: commit the one-test fixture, then delete its test in a second commit. Run `statusAtCommand({ commit: before, paths: [], json: true }, io, options)` with an install returning `{ ok: false, command: "install", ms: 1, reason: "exit 1", log: "" }`. Actual output: code **0**, `failure: "install: install: exit 1"`, `files: []`, and all four counts zero. The assertion that this must not exit 0 fails.

Fix scope: one CLI worker. Treat a failed commit-side listing as undetermined independently of file counts; return 3 for this checkout failure. Preserve the failure in text and JSON. Do not use a missing lookup entry as proof of absence when the listing failed. Cover both empty and nonempty current listings.

### B5 — proven: folder selection omits tests deleted since the requested commit

Location: `src/cli/status-at-now.ts:139`; `src/cli/status-at.ts:132` and `src/cli/status-at.ts:136`.

Contract: D1 permits paths to narrow the test files; D3 compares each selected file at the commit and now, with unknown on either side. A folder must select its test files at both versions.

The command expands a folder only against today's listing, passes those files to `keysAtCommit`, and unions commit-side refs only when no paths were supplied. Tests that existed in that folder at the commit disappear from the report. This is not only the notes' old-only-folder limit: it also happens when the folder still has a current test.

Reproduction: at the first commit, have `test/a.test.ts` and `test/plain.test.ts`. At HEAD delete only `a.test.ts`. Store a pass at the unchanged plain test's key. Ask for `paths: ["test"]` at the first commit. Actual output: code **0**, one file (`test/plain.test.ts`), `unchanged: 1`, `unknown: 0`. The assertion that the report includes `test/a.test.ts` fails. That file should appear with `now: absent`, making the comparison unknown and the exit code 3.

Fix scope: one CLI worker. Expand paths against each side's listing and compare the union, retaining project identity. Cover a partly deleted folder, a wholly deleted folder, and a file listed under a named project only at the commit. Keep the explicit nonexistent-file behavior.

## Verification output

All product checks and external probes below ran at the exact candidate with `git status --porcelain` empty. The probe source and its config were outside the repository and were removed before committing. No product file was edited. The report is the only file committed by this review.

- `git fetch origin`; `git rev-parse HEAD` → `cf4357e2a349ce800e0e4a6a068c633c88a7a637`.
- Fetched `origin/main`: `8681a898a20f41c744f76ea30722f0c542793c59`; merge base: `bcb54db8d33b7e04c80dfc2fcc9b373461f4fa92`. `git log origin/main..cf4357e2a349ce800e0e4a6a068c633c88a7a637` names six commits: `c4e68a8f9`, `7943bb5fb`, `859483996`, `50958ff9a`, `87f8bbe13`, `cf4357e2a`.
- Installation was supplied by Squawk (`pnpm install --frozen-lockfile`); not repeated, as instructed.
- `pnpm run lint` → exit 0, `Checked 3645 files in 1747ms. No fixes applied.`
- `pnpm run typecheck` → exit 0 (`tsrs --fast --noEmit`).
- `pnpm run build` → exit 0; all four harness builds ran. `git status --porcelain` remained empty, including the committed bundles.
- `git diff --check` → exit 0, no output.
- `timeout 600 pnpm exec vitest run test/commit/at-keys-ci.test.ts test/cli/status-at.test.ts test/cli/status-at-fixture.test.ts test/keys/key-format.test.ts test/version-sensitive.test.ts --maxWorkers=2` → **5 files passed, 37 tests passed**, 25.90 s. The direct run followed the broad affected lookup's unknown results; no full suite ran.
- Squeal: `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with the eight changed source paths selected 1,006 tests: **66 current/pass, 940 unknown**, exit 3. The baseline said nothing had queued those unknown inputs. These wider affected results are **unverified**, not a blocker and not claimed as passing.
- A subsequent Squeal path wait for `test/commit/at-keys-ci.test.ts`, `test/cli/status-at.test.ts`, and `test/cli/status-at-fixture.test.ts` asked its own run of those unknown files. Output: **3 test files, each with a current result**, no known failures, 26.5 s, exit 0. The wider worktree still had **803 not current: 28 queued, 775 unknown** at that reading.
- External real-adapter probes used `timeout 600 pnpm exec vitest run --config /tmp/squeal-review-023-wave6-889b2c13/vitest.config.mts --maxWorkers=1`. First run: **3 assertion failures** proving B1–B3, 4.37 s. A second run with `-t 'all-file|folder selection'`: **2 assertion failures**, 3 skipped, proving B4–B5, 3.47 s. These were intended contract assertions against the candidate, not failures of its committed tests.
- A control run with `-t 'bad export key'` passed: **1 passed, 5 skipped**, 3.03 s. A self-inconsistent export key and a valid export with no results both settled zero files and fell back to the checkout.
- Exact-candidate CI at the last check: [Private material](https://github.com/hearsay-tools/squeal/actions/runs/44125608444) **success**; [CI](https://github.com/hearsay-tools/squeal/actions/runs/44125608567) **in progress** (six Node 22/26 shards and the Node 24 checks). Full-suite CI remains **unverified**. No full-suite checkpoint was requested.
- `pnpm run check:private` → exit 0, `private: 10029 added lines in 54 files over bcb54db8d33b7e04c80dfc2fcc9b373461f4fa92, ok` before this report. It warned that `SQUEAL_PRIVATE_DENYLIST` is empty, so that rule was skipped. The command reads committed changes only; it will also be repeated after the report commit to include this file.

## What fits

- The CLI/core seam carries `KeyAt.stored` and the additive `ResultRecord.origin` without a shared-store write. Normal named-file CI hits skip installation and checkout; missing exports, mismatched recorded descriptors, missing results, and invalid keys fall back.
- The committed fixture checks database bytes and git ref/config/`FETCH_HEAD` preservation. The opted-in fetch reads one results ref. With `shared.ref` absent and no local ref it performs no fetch. Code inspection agrees with those checks.
- Text lists changes and unknowns, counts unchanged known files, and separates no-daemon stored lookup from daemon state. JSON is versioned and carries both sides, keys, origins, commit, HEAD, dirty flag and checkout time. A changed outcome exits 0 when both sides are known.
- The daemon-side fixture reads the recorded keys, revision and pending state without re-keying. The states are materialized before the read-only store closes. The no-daemon fixture keys the current tree through the same gate keyer as the commit checkout.
- The `fail -> pass` fixture is real at the runner boundary: `passesAt` launches the installed Vitest in plain worktrees at both commits, checks failure before and success after, and only the source value changes for that test. The CLI comparison then uses fixture result rows at independently computed keys. It does not claim those inserted rows were captured from a daemon run.
- The seven-day line is covered in unit and git-fixture tests. Failed named-file installation gives not determined and exit 3. Invalid commit and invalid option paths give usage/setup exit 2.
- Version/key-format tests pass. The rebuilt 0.1.547 bundles have no drift.

## Inputs for the repair wave

Repair B1–B3 in the core CI step and its tests. Keep `keysAtCommit` read-only, preserve its fallback order and the no-network-without-policy rule, and keep `ci: false` as the independent checkout reference. B1 and B2 are separate proofs: fresh-store key equality does not cover either shared observations or changed call environments. Reuse 018's key and environment rules rather than adding another weaker equality rule.

Repair B4–B5 in the CLI modules and their tests. A listing failure must reach the exit decision before an empty file set can imply success. Path expansion needs both versions before comparison. If this needs a core listing API change, agree that seam before dispatching disjoint owners.

Keep each direct check under `timeout 600`; use affected results and targeted fixtures, not a full suite. Re-run private checks and regenerate/version bundles for the repaired candidate. Row 023-07's run budget and 023-08's proof behavior are still outside this wave.
