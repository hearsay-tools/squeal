# Wave 5 narrow re-review

FAIL `4a6a68ce1e108b9e8e4524bd47ebf18de57e516c`

Candidate `cand/023-16`, version 0.1.543, rebuilt on main `b8ebc225d` (0.1.541). Scope: B1 to B3 from `wave-5.md` and the repair delta. **1 proven blocker remains, B1. B2 and B3 are closed for their original scenarios. 1 plausible, nonblocking lifecycle note. No nits.** No product code was changed.

The relevant repair range is `27a6d3b8e..4a6a68ce1`: `8d3d0231a`, `9cc077e51`, `f630a1b21`, `d607c9fc0`, and the version/bundle commit. The unrelated 0.1.541 main changes are not re-reviewed here.

## Remaining blocker

### B1. Proven, still open: configured extensions bypass the file-versus-directory candidate check

**Location:** `src/core/commit/at-keys-fast.ts:63` and line 64 restrict `MODULE` and `INDEX` to a fixed extension list; line 95 omits other modules from the candidate set; `targets` at line 183 applies the same restriction. `src/core/commit/at-keys-checkout.ts:94` then accepts the current key when the target environment agrees.

**Contract:** D2 requires the exact fresh-walk key or `not determined`. Original B1 requires the resolution proof to cover file-versus-directory candidates. Its repair now catches the original `.ts` case, but only for the hardcoded extensions. Vite permits configured `resolve.extensions`, which this proof does not read.

Use identical configuration and test bytes at A and B:

```js
// vitest.config.mjs
export default {
  resolve: { extensions: [".custom", ".ts", ".js", ".json"] },
  test: { include: ["test/*.test.ts"] },
};
```

```ts
// test/a.test.ts
import { it, expect } from "vitest";
import { n } from "../src/a";
it("n", () => expect(n).toBe(2));
// src/a/index.custom, at both commits
export const n = 2;
// src/a.custom, at A only; B deletes this file
export const n = 1;
```

The real adapter supports this configuration without a plugin. At A it loads the sibling file. At B it loads the directory index. The target environment equals the current environment because the configuration did not change. The new checkout/environment step therefore does not repair the missed candidate.

**External probe, then real execution through `runGateFiles({ store: false })`:**

```text
fresh A key:       1a6276f4dd4e994cc329af2e33549ee977b55fc86a1774ab1b149f19ad045acd
fresh B key:       0624fbb685ba74bcf8133bd02fdce98df727727573d8c2326df95365835b2ca1
keysAtCommit(A):   0624fbb685ba74bcf8133bd02fdce98df727727573d8c2326df95365835b2ca1
via:              unchanged
changed:          []
stored outcomes:  [pass]
sideKeys(A):      1a6276f4dd4e994cc329af2e33549ee977b55fc86a1774ab1b149f19ad045acd
A real run:       failed, AssertionError: expected 1 to be 2 // Object.is equality
B real run:       passed
```

The fixture store holds a seeded failure at the independently walked A key and a seeded pass at B's. The API returns B's pass for A. The separate real runs establish the actual assertion failure and pass; they do not store results. Both probe runs produced the same two reference keys. `sideKeys` logged A's exact key and its stored failure.

This is the unresolved B1 resolution premise, not a new architecture audit. The repair's new candidate enumeration excludes a module that the supported resolver actually loads.

**One-worker fix:** Make candidate eligibility conservative for the actual resolver. Use its configured extensions, or send inputs with an unproved extension/resolution rule to the existing checkout walk. Do not extend a hardcoded list by just `.custom`. Add this real-adapter regression with a stored failure/pass and retain the original `.ts`, reverse direction, and manifest cases. The checkout already exists; uncertainty need not become a wrong accepted key.

## Closed blockers

### B1 original `.ts` fixture: fixed, but the general finding remains open

The original sibling `src/a.ts` versus `src/a/index.ts` probe now returns A's exact key, via `walk`, and reads the seeded failure. The same `sideKeys` request returns A's key. The database hash stays unchanged and the checkout is removed. The new `targets` rule covers this default-extension case in both directions, with matching candidate tests.

### B2. Proven fixed for the unlisted config-read fixture

`keysAtCommit` now reads the target environment in a checkout for every request with a present file. `inCheckout` accepts a current key only when that target project environment exists and equals the current hash. Otherwise it walks the file there.

The original unchanged config reading `choice.txt` into `define.CHOICE`, with only the text file changing from `1` to `2`, now returns A's exact key and seeded failure. `changed` names the different environment. `sideKeys` also gives A's exact key; database bytes do not change and no checkout remains. This closes the concrete B2 wrong-pass case. It does not prove resolution equality when the target environment is equal, as B1 shows.

### B3. Proven fixed for the held default install and next-sweep scenario

The default `installCheckout` reports its process group through `started`. `withCheckout` records the leader's process identity in `CheckoutMarker.group`. Normal removal and the dead-owner sweep both call `removeTree`, which stops that recorded group before deleting the checkout.

The original dependency-free npm fixture again ran its real default `npm ci`, with a preinstall script writing its pid/cwd and waiting on an interval. The probe sent SIGKILL to the lookup owner during preinstall. After the next lookup's sweep, the script was gone, the old checkout path was gone, and the checkout list was empty. The test passed. This is evidence for next-sweep cleanup, not immediate termination at the instant of owner death.

## Nonblocking note

### N1. Plausible: death between install spawn and marker write leaves no group for the sweep

**Location:** `src/core/checkout/install.ts:57` spawns before reporting the pid; `src/core/commit/at-keys-walk.ts:159` records it and catches recording errors. `tasks/023-16-notes.md` explicitly records this remaining window.

A SIGKILL between the spawn and marker update could leave an install group absent from the marker. A later sweep would remove the folder without stopping that group. No probe forced this timing, so this is **plausible and nonblocking**, not another proven B3 failure.

**Bounded follow-up:** Give process creation and durable owner/group registration one supervised lifetime, or make an unrecorded child unable to continue an install. Add a deterministic barrier test around spawn/record if this is dispatched. Do not treat another ordinary post-marker kill test as evidence about this interval.

## Verification

All product checks and external probes ran at the exact candidate with a clean tracked tree. The build had no tracked drift. Temporary probe source and fixtures were outside the worktree and were removed before this findings-only commit. No probe install or lookup child remained. The installed dependency tree was retained as instructed; the pnpm wrapper reported it up to date during the lint command.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin && git checkout --detach 4a6a68ce1e108b9e8e4524bd47ebf18de57e516c` | Exit 0; `git rev-parse HEAD` equals the requested candidate |
| `git status --short`, after checkout and after build/probes | Empty |
| Dependency setup | No separate install repeated. The lint invocation first printed `Lockfile is up to date, resolution step is skipped`, `Already up to date`, and `Done in 92ms using pnpm v12.15.0`. |
| `pnpm run lint` | Exit 0: `Checked 3618 files in 1714ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: TypeScript and all four harness builds completed; committed bundles did not drift |
| `git diff --check 27a6d3b8e..HEAD` | Exit 0, no output |
| Squeal affected-source command below | Exit 3 after 60.8 s: **303 selected, 1 current pass, 302 pending**, no known failures. The checkout re-keyed many tests and the running tier did not yield. Broader coverage remains **unverified**. |
| Squeal nine named tests below | Exit 0 after 20.0 s: `Named test files at revision 5: no known failures; 9 test files, each with a current result.` Worktree: 1072 of 1919 files not current, 4 running and 1068 queued. Results can be inherited by content key; this is not a fresh full-suite claim. |
| `timeout 600 pnpm exec vitest run --config <probe>/vitest.config.mjs` | Exit 1: **3 passed, 1 failed**, 12.34 s. The original B1, B2 and B3 probes passed; the configured-extension B1 case returned the wrong key/pass. |
| Same command with `-t 'B1 directory resolution with configured custom extension'` | Exit 1: **1 failed, 3 skipped**, 4.00 s. Added actual execution of A and B before the key assertion. A failed on the expected assertion and B passed; the wrong key remained. |
| `pnpm run check:private`, before the findings commit | Exit 0: `private: 2236 added lines in 64 files over b8ebc225dd15bcc2a8e0c96e1bc29fc77a4b3508, ok`. Warning: the local private denylist is empty, so that rule was skipped. This scanner reads committed HEAD; the staged review is also searched for absolute home paths. |
| `gh run view 44056110703 --json headSha,status,conclusion,jobs` | At 2026-11-17 09:34 UTC: exact candidate, CI **in progress**. Six Node 22/26 shards and the Node 24 lint/typecheck/version-sensitive job remained in progress. Version-bump and nightly jobs were skipped. Full-suite result is **unverified**, not a finding. [CI run](https://github.com/hearsay-tools/squeal/actions/runs/44056110703) |
| `gh run list --commit 4a6a68ce1e108b9e8e4524bd47ebf18de57e516c` | Exact-candidate `Private material` run **success**, [run 44056110685](https://github.com/hearsay-tools/squeal/actions/runs/44056110685) |

The temporary probe folder was `~/projects/squeal/.ai/squawk/t/51f5d4df/sq-rereview-wave5-7f275415`. Commands used its expanded path. Reference keys came from the existing `freshKey` fixture helper: an independent plain detached worktree at each version, its real Vitest adapter and the gate's fresh keyer. The key fixtures use the documented Vitest link install. B3 uses the real default npm frozen install. The B1 execution follow-up uses `runGateFiles` with `store: false` in a separate worktree at A and the fixture at B.

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  src/core/commit/at-keys.ts src/core/commit/at-keys-fast.ts \
  src/core/commit/at-keys-checkout.ts src/core/commit/at-keys-side.ts \
  src/core/commit/at-keys-walk.ts src/core/checkout/checkout.ts \
  src/core/checkout/install.ts src/core/checkout/marker.ts \
  test/commit/at-keys-resolution.test.ts test/commit/at-keys-killed.test.ts \
  test/checkout/group.test.ts test/keys/key-format.test.ts \
  test/version-sensitive.test.ts test/runners/boundaries.test.ts

"$SQUEAL" status --wait 60000 \
  test/commit/at-keys-resolution.test.ts test/commit/at-keys-fast.test.ts \
  test/commit/at-keys-killed.test.ts test/commit/at-keys-untracked.test.ts \
  test/commit/at-keys.test.ts test/checkout/group.test.ts \
  test/keys/key-format.test.ts test/version-sensitive.test.ts \
  test/runners/boundaries.test.ts
```

No full suite or checkpoint was requested. No repair test lies outside Squeal's coverage. The unrelated main e2e changes are outside this narrow review. Direct tests cover the concrete failure modes, without repeating the covered candidate tests.

## Nits

None.

## What fits and next-wave inputs

- B2 and the concrete post-marker B3 case are settled by the independent probes. Do not re-prosecute them unless another diff changes these boundaries.
- The shared store stays read-only in the passing B1/B2 probes. The extraction of checkout and side helpers preserves their behavior. An install failure now returns uncertainty for files tentatively kept by the git filter as well as files already selected for walking; the current named test covers it.
- The old `checkout: boolean` API is now `checkoutMs: number | null`. `keysAtCommit` remains in `at-keys.ts`; `sideKeys` moved to `at-keys-side.ts`; `KeyAt` and uncertainty types moved to `at-keys-checkout.ts`. Future CLI callers must use these new imports and honor every uncertainty.
- Every lookup with a file present now creates and installs a checkout to read the target environment. `via: unchanged` means no target closure walk; it no longer means no checkout. The spec D2 and fast-helper preamble still describe reuse without a checkout. The repair notes state the new behavior. Reconcile those descriptions when folding this review. The cited 6 to 9 s real-repository overhead is an estimate, not a measurement from this review; the link fixture does not validate it.
- Keep the remaining B1 repair inside the candidate-eligibility rule. Environment equality is necessary but does not prove the static closure. Use the walk when the configured resolver is outside the proof, and retain an unchanged ordinary-file case that can still keep its key after the environment check.

The original review's other settled cases and deferred proof-side helper copying remain outside this re-review. The coordinator decides how this second FAIL is handled under `docs/process.md` step 6.
