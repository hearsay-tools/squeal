FAIL b646f46180bdc4f3ba1a4a54b6afdf2f36af34d4 — 1 proven blocker: B4, introduced by the dot-name exclusion.

Round 2, bounded by `review-0.1.533.md` findings B1/B2/B3/S1/S2/N4 and regressions in their repair. Reviewed candidate `cand/0.1.533`, pinned to the SHA above, against main `23f67d006`. HEAD matched that SHA. The tree was clean before checks and after the build. No product code was changed.

## Verification

- `pnpm run lint`: exit 0, `Checked 3576 files in 2s. No fixes applied.`
- `pnpm run typecheck`: exit 0.
- `pnpm run build`: exit 0. `git status --short` remained empty.
- `squeal status --wait 60000` with the 13 paths below: exit 0 at revision 4, `Named test files at revision 4: no known failures; 13 test files, each with a current result`. Here `squeal` abbreviates the session's absolute launcher. Earlier waits timed out while the daemon listed the new checkout; they were not counted as candidate passes. Other worktree checks remain queued and are not claimed as passes.
- The four new regression tests were run in the same isolated temporary harness, first against the original guard from `d25962b0c`, then against the candidate guard. Command: `pnpm exec vitest run test/harness/check-private.test.ts -t 'fails a home root|undoes JSON string|reads a file name|reads a text file'`. Original guard: exit 1, **4 failed, 18 skipped**. Candidate guard: exit 0, **4 passed, 18 skipped**. Test and helper files were copied unchanged; only the guard source changed between runs. This experiment verifies that the added tests discriminate between the old and repaired behavior. The temporary harness was removed.
- `gh run view 43985459880 --json headSha,status,conclusion`: Private material **success**, exact candidate SHA. The supplied ID `43985459480` returned 404; the run list identified the correct ID above.
- `gh run view 43985459469 --json headSha,status,conclusion`: full CI **in_progress** on the exact candidate at the last read. Its final result is unverified here. No local full suite was run.
- Tracked HEAD blob/path scan: **0 denylist content hits, 0 denylist path hits, 0 literal recording-host home paths**. Decoding JSON escapes for one, two and three rounds also found **0 denylist content hits**. No denylist value was printed or copied here.

The 13 paths were:

```text
test/harness/check-private.test.ts
test/cli/codex-hash.test.ts
test/harness/codex/hooks.test.ts
test/harness/codex/review.test.ts
test/runners/node-test/run-streams.test.ts
test/cli/setup/plan-runners.test.ts
test/daemon/composite-runner.test.ts
test/daemon/socket.test.ts
test/harness/primer-listing.test.ts
test/harness/primer-wait.test.ts
test/harness/setup-skill.test.ts
test/scheduler/edit-cut-readers.test.ts
test/scheduler/editor-scratch.test.ts
```

## Listed repairs

| Prior item | Result | Evidence |
| --- | --- | --- |
| B1: JSON escapes | Fixed for the requested bounded decoding | `forms` checks raw text and three decoded forms. The regression test covers escaped slashes, nested session keys, Unicode-escaped denylist characters, multi-line JSON strings and redacted diagnostics. It fails against the old guard and passes against the candidate. |
| B2: spaced filenames | Fixed | `addedLines` removes Git's trailing header tab without trimming filename whitespace. The test checks exact paths and multi-line session detection for a spaced filename. |
| B3: retained recordings | Fixed for the inventory and agreed retention policy | All **431** private-inventory paths are absent from HEAD and appear in the repair's deletion set. The original blocker examples are deleted. No exact deleted path is referenced by product code, scripts, tests or eval tools in the scanned directories; no Markdown link resolves to a deleted target. |
| S1: attribute-marked text | Fixed | Attribute-marked files with no NUL in the first 8000 bytes receive a text diff. Tests cover a new file, a changed file, a renamed-and-edited file and a genuine binary file. Only added lines are judged. The test fails against the old guard. |
| S2: roots and non-ASCII names | Original cases fixed; the new dot exclusion regresses other home paths | The new test catches roots without a trailing slash and accented names, while retaining public-user, placeholder and URL cases. It fails against the old guard. See B4 for the added exclusion. |
| N4: uppercase JSON suffix | Fixed | A case-insensitive suffix check and a regression test cover pretty-printed `LOG.JSON`. |

## Blocker

### B4 — proven: the blanket dot-name exclusion accepts dot-component aliases of private home paths

Location: `scripts/check-private.ts:35`, introduced by repair commit `dbd7208d4`.

The new username pattern requires its first character to be a letter, number, combining mark, underscore or hyphen. It skips every path whose first component after a home root starts with a dot. A dot can be a directory-navigation component. It is not proof that the path names a file.

Reproduction, using made-up usernames:

1. Create a temporary Git repository with a clean base commit.
2. Add a text file with a home path whose components are `home`, `.`, a made-up username, and `project`. Add another line with `Users`, `.`, a made-up non-ASCII username, and `project`. These are `/home/./<name>/project` and `/Users/./<name>/project` in placeholder notation.
3. Commit and call `privateReport(root, base, { SQUEAL_PRIVATE_DENYLIST: syntheticMarker })`.
4. The candidate reports **no home-path problems** for either line. The original guard reports a home-path problem for **both**. `node:path.normalize` removes the dot component and produces the ordinary absolute home paths.

Thus the repair newly accepts ordinary private home paths written with a POSIX-equivalent spelling. It breaks the guard row's rejection of added absolute home paths. This is a proven regression in the requested dot-name change, not a new speculative hardening idea. The passing tests only exercise the system file `.localized`; they do not test dot-component aliases.

Fix: do not infer file type from a leading dot. Recognize home paths containing dot components, and keep any necessary system-file exception narrow. Add a regression test for both home-root spellings above that fails against this candidate. Preserve the root, Unicode-name, URL, placeholder and public-user cases. No filesystem lookup of the named home is needed.

## Notes

- N1 — proven, acceptable bounded behavior for B1: payloads needing a fourth decoding round remain unread. A direct probe detected the plain payload and the first three nesting levels, then skipped the fourth. Three rounds meet the prior request for bounded decoding and are explicit in source and tests. This guard is not a general decoder of arbitrary encodings or nesting depths.
- N2 — proven: the dot exclusion also permits a hidden directory configured as a process's home. Node's `os.homedir()` accepts such a `HOME`. The statement that every dot-prefixed name is a file is therefore too broad even apart from B4's dot-component case. No such private path was found in the candidate scan. A narrow system-file exception would address both cases.
- N3 — proven: the one retained `.timeline.txt` file is `docs/specifications/007-pytest-runner/research/probes/dogfood/logs/sessions/codex-attempt1.timeline.txt`. It contains reconnect and model-capacity errors, with no prompt, assistant response or tool-call stream. Its retention does not reopen B3.
- N4 — proven from code and sampled data: retaining redacted eval-cell transcripts in `evals/results/*.json` is consistent with their use by eval trend, regrade and calibration tools and `test/evals`. The private inventory identifies that exception. These fixture-repository eval records do not invalidate the scrub repair. The denylist scan still covers them.
- N5 — proven: the Codex hash test and recorded-hook/stream consumers still pass. The scrub preserves the trust-listing and launcher-hash inputs used by the hash test. No deleted evidence file was needed by the targeted tests.

## Handoff

The original listed failures have discriminating regression coverage, and the scrub inventory is complete at this SHA. B4 prevents a PASS. This is the second review FAIL; the coordinator must take the decision through the repository's second-round process. This report does not authorize another repair or a landing. Full CI on this SHA was still pending when recorded.
