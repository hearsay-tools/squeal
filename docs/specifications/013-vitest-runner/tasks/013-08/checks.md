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
