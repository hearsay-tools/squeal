# Integration checks: Cezar coverage repair

Candidate: `5234d29d2`, `cand/0.1.347`. Product and test content stays at that commit. Later commits add documentation only.

| Command | Result |
|---|---|
| `npm ci` | exit 0, 196 packages installed |
| `npm run build` | exit 0; TypeScript and all four plugin builds |
| `npm run lint` | exit 0; 2254 files checked, no fixes |
| `npm run typecheck` | exit 0 |
| `npm run check:version -- origin/main` | `version bump: 0.1.345 -> 0.1.347, ok` |
| `npx vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts` | exit 0; 2 files and 18 tests passed in 86.91 s |

The key comparison finds no different stored outputs and exercises every changed line. The coordinator accepts unchanged adapter and coverage-provider versions. The payload format is unchanged. Missing coverage records can arrive on a later run; the fixes do not make an existing valid test result invalid.

The worker's six scoped provider, reporter and runtime test files had current passing results. Its final known failures were four bundle-drift tests, because workers do not build plugin bundles. Integration rebuilt the bundles. The worker still had 100 of 1165 files pending, so it claimed no result for those files.

The parent also observed the existing OpenCode held-Stop deadline failure (board row 008-38) before and after integration. It has not been fixed in this candidate. The Cezar navigation timeout remains a review input, as recorded in `../013-09/notes.md`.

Full-suite evidence is pending in candidate CI [40336082558](https://github.com/hearsay-tools/squeal/actions/runs/40336082558). Release requires passing full-suite CI on the exact release commit.

Parent affected status at revision 28 (`squeal status --wait 60000` on the four changed sources and validity cases): 190 current (189 pass, existing OpenCode 008-38 fail), 223 selected files pending. It returned at its 61 s deadline. This is partial affected evidence, not a full pass. The reviewer independently observed current passing results for key-format, version-sensitive and seven focused provider/reporter files.

## Candidate CI repair

The first candidate CI 40336082558 failed Node 22 shard 2 on `test/cli/install-sh.test.ts:221`: `install.sh` named 0.1.345 while `package.json` named 0.1.347. Commit `ab0ca19b5` corrects only that literal after a docs-only main rebase. Product, test and bundle bytes remain identical to the reviewed `5234d29d2`. New exact-candidate CI: [40338863343](https://github.com/hearsay-tools/squeal/actions/runs/40338863343). Narrow integration re-review: worker 77f11322. No release is permitted while its full-suite result is missing or failed.

Review N1 is retained as planned row 013-11 with a bounded research brief. Both original workers were collected at their latest settled revisions, their desired commits integrated, and their resources destroyed.

## Integration onto main 0.1.346

Main advanced with reviewed lint data-layer row 017-03 at `b089ea554` while candidate CI ran. The coordinator rebased onto `92d3b5420`, removed the obsolete build and installer-version commits, and rebuilt 0.1.347 as `9bb4edd09`. The coverage source/tests and key validity cases are byte-identical to `ab0ca19b5`. The new lint source/tests are unchanged from main.

`npm ci` and `npm run build` exit 0. Lint exits 0 (2275 files), typecheck exits 0, and `npm run check:version -- origin/main` accepts 0.1.346 to 0.1.347. The required key/version gate also includes the install-sh test this time; it is still running. A narrow combined-bundle review is with bdd7eaa4. Candidate CI on the earlier main base is superseded. No full-suite pass or release is claimed.
