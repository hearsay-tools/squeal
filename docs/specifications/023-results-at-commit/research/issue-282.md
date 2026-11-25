# Issue 282: proof rejects a green directory read before asking the commit daemon

2026-11-25. Recommendation: diagnose the proof's directory admission against the
commit daemon's existing rules, retaining commit-side keys and result provenance.
No product change is authorized by this triage.

## Questions and verdict

| Question | Answer and evidence |
|---|---|
| Reproduced? | **Verified by experiment, 0.1.636 source:** a synthetic closure containing a tracked directory is refused by proof's `needsOf`, while the commit daemon's `listingsHeld` accepts its exact tracked names. Original four-file Squawk proof **not reproduced**. |
| Missing green closure or missing input? | **Read in source code, 0.1.636:** the reported `needs packages/cezar/src/runners/` comes after a keyed closure was obtained. It is the directory-admission refusal, not #266's absent stored closure. |
| Does a clean-HEAD worktree pass suffice? | **Read in official docs, spec 023 D5.1/D7.6 at the examined checkout:** no. Frozen-install commit-side evidence is required; git cleanliness does not establish installed-package identity. |
| Existing work or duplicate? | **Inferred from source and issue bodies:** related to #266/#264/#268, not an established duplicate. Done 023-64/70/76 and proposed 023-82 are the closer directory/provenance work. |

## Report and environment

Reported in [#282](https://github.com/hearsay-tools/squeal/issues/282), not independently
verified: CLI 0.1.636, Antigravity plugin 0.1.634, Squeal revision 3, model
`gemini-4-neon-high`. Squawk HEAD `b73f2c060`, base `353fc9016`: four files have a
current worktree pass, red runs fail eight new assertions, green is unknown with
`needs packages/cezar/src/runners/`, exit 3. A single-file retry also refuses.
The report does not include full proof JSON, stored closure or directory contents.

Examined checkout: `65d90b0fd07946ece721f7cbcf3bd8729f2115da`, package 0.1.636.
Session runtime/skill: 0.1.636, under
`~/.codex/plugins/data/squeal-hearsay/versions/0.1.636/`.
Initial load: `11.25 12.52 9.38`, 16 online CPUs. Probe loads: 9.62/16 initially and 5.29/16 after relocating the probe.
Load did not trigger the human's skip rule. No Squawk suite, install, daemon or
heavy reproduction was run. Original environment was not reconstructed within
the bounded triage; heavy or isolated follow-up belongs on boat.dev, not this host.

Exact issue/environment/probe commands:

```sh
gh issue view 282 --repo hearsay-tools/squeal --json number,title,body,comments,state,url,createdAt
gh issue view 266 --repo hearsay-tools/squeal --json number,title,body,state
gh issue view 264 --repo hearsay-tools/squeal --json number,title,body,state
gh issue view 268 --repo hearsay-tools/squeal --json number,title,body,state
git rev-parse HEAD
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
# Initial run, before relocation:
pnpm exec tsx research/probes/issue-282/probe.mjs
# Same probe, final path:
pnpm exec tsx docs/specifications/023-results-at-commit/research/probes/issue-282/probe.mjs
```

`checks` reported 2,276 default test files, 2,069 pass and 207 not current. This
research claims no suite pass. The source probe exited 0 in 0.44 seconds:

```json
{"load":9.62,"cpus":16,"folder":"src/runners/","proofPreflightNeeds":"src/runners/","commitHoldsBlob":true,"commitHoldsFolderAsBlob":false,"commitDaemonListingHeld":true,"blobPreflightNeeds":null}
```

The final-path rerun also exited 0 in 0.31 seconds, with load 5.29 and the same predicate results.

Probe and scope: `docs/specifications/023-results-at-commit/research/probes/issue-282/{README.md,probe.mjs}`. It imports
production functions, supplies a synthetic keyed closure and reads this checkout's
tracked directory. It does not invoke the proof command, assert a test verdict,
or establish the contents of Squawk's reported directory.

Reporter command, **not run here**:

```sh
squeal proof packages/cezar/src/runs/archive-on-merge.test.ts packages/cezar/src/runs/run-archive.test.ts packages/cezar/src/runs/run-read-flags.test.ts packages/cezar/src/runs/run-retention.test.ts --base 353fc9016284b7d3cbaae3cff29162ae8a501f4b
```

## Findings and boundaries

1. **Read in source code, 0.1.636:** `src/cli/proof-green.ts:128` calls
   `greenNeeds` before deciding stored versus pending green results. Its `needsOf`
   call (`src/cli/status-at-run-select.ts:163`) rejects an existing directory
   because `heldAt` holds blobs, not listing paths (`src/core/commit/held.ts:110`).
   A rejected file is set to unknown and never added to `pending`, so no green ask
   is made for it. The rejection also precedes use of a stored commit-side pass.
   The literal reported reason identifies this path; whether every original file
   had only this blocking input remains unverified.
2. **Verified by experiment, 0.1.636 source:** this happens even when the folder
   contains exactly the names git tracks. In contrast, the commit daemon uses
   `heldAt.has(path) || listingsHeld(path)` (`src/core/daemon/commit-start.ts:81`;
   `commit-listings.ts:26`), supporting directory reads since row 023-64. The probe
   demonstrates the predicate mismatch, not that the original call must be proven.
3. **Read in source code, 0.1.636:** safely admitting a directory is not permission
   to reuse a foreign pass. `src/core/daemon/at-asks.ts:323` applies refusals to
   stored results too; directory results require the commit worktree's writer.
   `src/cli/proof-green-run.ts:106` and `:148` preserve that `ownOnly` rule after
   waiting. Merely exempting directories in green preflight would expose the
   earlier direct stored-result branch and must not bypass these rules.
4. **Read in official docs and source, examined checkout:** D2, D4.9, D5.1/5.2/5.5/5.6
   and D7.6 govern this issue. `status.md` records the explicit clean-checkout
   decision and the earlier directory refusal in 0.1.597. Spec 023 is shipped with
   proposed rows still open. The report's worktree fallback conflicts with D5.1.
   An in-call temporary green checkout is not an established workaround: the
   ordinary proof side also calls `needsOf` (`src/cli/proof-side.ts:130`). No
   supported recovery command was verified; do not promise `--env` or a retry.

## Overlap and human decision

**Read in issue bodies/source, versions 0.1.597/0.1.595/0.1.600 respectively:**
#266 fails before red because `proof-green-rows.ts` cannot establish a stored
closure at the commit key; #282 has a closure and rejects a directory within it.
#264 concerns a stored break-side pass and input identity. #268 concerns red
failure evidence with an unstaged file-level error. No common root cause is
established. Keep their evidence linked rather than closing one as a duplicate.

**Read in board/source, examined checkout:** done 023-64 admits exact tracked
listings in the commit daemon; 023-70 protects result-writer provenance; 023-76
records listing names in keys but retains the writer restriction. Proposed
023-82 would certify names actually read so worktree directory results may count
at a commit. #282's suggested worktree reuse overlaps 023-82; enabling a correct
commit-daemon run is a narrower question and need not authorize that expansion.

**Inferred recommendation:** approve bounded diagnosis of proof's green directory
admission and an actionable refusal. Done when a tracked-directory reader can
obtain the proper commit-side green evidence, or explain the specific missing
input/provenance with a supported recovery; ignored extra names, foreign results,
late arrivals and missing closures remain distinguished. Preserve exact side
keys and honest unknowns. Original JSON, the stored closure and actual committed
versus on-disk directory names would decide whether this specific four-file
report should finish proven after that repair.
