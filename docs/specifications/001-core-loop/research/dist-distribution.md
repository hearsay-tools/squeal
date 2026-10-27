# Generated bundle distribution

**Recommendation: move generated bundles off development main into release-only commits in the same repository; keep the hub as a catalog.** This is an **inferred** recommendation, conditional on the CI and baseline changes below. Keep today's layout until those changes pass review. Release assets can supplement this path. They are not yet a demonstrated replacement for every harness.

Research date: 2026-10-27. Source: `181054dd748f2834b423a23b1cababd0d520dd5d`, Squeal 0.1.367. Build probe: Node 24.22.1, installed frozen pnpm lock. Official documentation was fetched on this date; Pi package docs are from 1.0.4, OpenCode source from `v1.18.35` (`53d1eabb61e21162157817bf677da0a4ad3332e3`). [Probe commands, results and limits](probes/dist-distribution/README.md). Research only: no product edits, harness installs, publishing, model sessions or full suites.

## Questions answered

| # | Answer | Evidence tag |
|---|---|---|
| 1 | Four tracked dist trees contain 98 files and 35,618,004 bytes. They contribute 49.1% of changed text lines in the measured 100-commit window. | verified by experiment |
| 2 | Claude Code and Codex fetch Git subdirectories through the hub. The installer extracts Pi/OpenCode packages from the source tag archive. These paths can remain intact with release-only commits. | read in source code; verified by experiment for extraction only |
| 3 | Same-repository release commits preserve URLs, access and layout with less migration than assets, a new repository or hub copies. They reduce main's noise, not existing Git history. | inferred |
| 4 | Build before package-dependent tests; test and promote the same complete package trees. Replace dist-based version detection and ancestor-tag baseline selection. Gate the exact artifact commit. | read in source code; inferred |
| 5 | Prepare checks first, publish one compatible release-only tree, then stop tracking generated outputs on main. Preserve historical tags and plugin identities. Current-harness installation and rollback remain follow-up checks. | inferred |

## 1. Size and churn

**Verified by experiment, source commit above:** `inventory.py` reads Git objects, not filesystem allocation.

| Tracked directory | Files | Bytes |
|---|---:|---:|
| `plugins/claude-code/dist` | 25 | 9,497,247 |
| `plugins/codex/dist` | 27 | 10,487,279 |
| `plugins/pi/dist` | 19 | 6,150,807 |
| `plugins/opencode/dist` | 27 | 9,482,671 |

The total is 34.0 MiB, 22.8% of the 155,952,567 tracked blob bytes. Identical blobs reduce these dist trees to 18,815,985 unique blob bytes before compression. This is **not** pack size or network transfer size.

The last 100 first-parent commits, `(f67bd9a3e, 181054dd7]`, span part of 2026-10-27. Only three touch dist, but they produce 102 dist file changes and 22,520 added/deleted text lines out of 45,852 overall. Binary sizes are excluded from line counts. This is a bounded sample, not a long-term rate or a measurement of conflict time. Deleting outputs now does not reclaim old history; Git also deduplicates repeated blobs.

**Read in source code, same commit:** root `dist/` is ignored TypeScript output. Each plugin's `.gitignore` explicitly retains its own dist. Shared build code also copies the Claude launcher's source into the other three `bin/` directories, and the Claude skill into Codex/Pi with harness notes. Those generated copies and manifest versions sit outside dist and must remain in release packages. The Python/TSX grammar sources under `src/` are inputs, not candidates for deletion.

## 2. Installed bytes and supported storage

**Read in source code, same commit and local hub `5fb7ee04e`:** both hub entries pin `squeal--v0.1.367`, SHA `6709eb4d72d51d472a02602839c4d6d0c1f4c629`, in `hearsay-tools/squeal`. The local snapshot is [hub.json](probes/dist-distribution/hub.json); it does not prove remote-head state.

| Consumer | Fetch to entry point | Other storage compatibility |
|---|---|---|
| Claude Code | Hub `git-subdir`, `plugins/claude-code`; `hooks/hooks.json` runs `hooks/run` and `dist/*.mjs`; `bin/squeal` runs `dist/cli/*.mjs`. | Git release commits, distribution repo and hub-relative plugin trees fit documented source forms. HTTPS ZIP assets are documented with optional `sha256`; pin it. |
| Codex | Hub `git-subdir`, `plugins/codex`; hook commands name `${PLUGIN_ROOT}/dist/*.mjs`. Squeal then retains runtime/skill copies in plugin data. | Git release commits, distribution repo and hub-local trees fit documented forms. Current OpenAI docs establish Git and npm sources, not a direct archive source; npm version selectors explicitly exclude paths/URLs. Direct release assets are **not determined**. |
| Pi | `install.sh` downloads `.../archive/refs/tags/squeal--v<V>.tar.gz`, strips one root, moves `plugins/pi` to its version directory, then calls `pi install <directory>`. Manifest loads `dist/extension.mjs`, with worker/CLI/runtime files beside it. | Same-repo release tags need no URL/layout change. Assets, a distribution repo or hub archives can work through changed installer extraction; Pi still loads a local package. Pi docs also support npm/Git, but installing this monorepo root is not equivalent to selecting `plugins/pi`. |
| OpenCode | Same archive extraction for `plugins/opencode`; installer points `current` at the version directory and registers `file:<current>`. `exports["./server"]` names `dist/plugin.mjs`, which uses the bundled Node bridges. | Same-repo release tags preserve this flow. Other storage needs changed installer downloads, then the same local package registration. No direct remote archive path was verified. |
| Shell installer | README/update fetch `releases/latest/download/install.sh`. That script delegates Claude/Codex to the current hub; its embedded version selects Pi/OpenCode archives. It copies the launcher. | An installer asset alone does not carry runtime bytes. A package asset needs extraction and integrity checks. A tag containing only sources would leave required runtime files absent. |

The compatibility statements above are **read in official docs** for source forms and **inferred** for a migration. [Fetched extracts, URLs and hashes](probes/dist-distribution/sources.md) preserve the evidence. OpenCode's tagged docs say Bun installs npm plugins; its same-tag source uses Arborist. The source decides this discrepancy.

**Verified by experiment:** an isolated release branch holding today's package bytes leaves scratch main without dist. The unchanged `install.sh` `unpack()` function extracts Pi and OpenCode with all 27/32 package file hashes equal, including their entry points. Both Git subdirectory targets contain hook bundles. This tests archive shape and bytes, not a harness install. Existing [release-hub research](release-hub.md) separately tested pinned Git installs with Claude 2.1.295/Codex 0.160.1; it is older evidence, not a new test of current binaries.

## 3. Options and deciding tradeoff

**Inferred, from the paths above:**

| Storage | Provenance/rebuild/rollback | Access and maintenance |
|---|---|---|
| Today's main | Source and output share one SHA; drift check compares rebuild. Retains every development bundle. | Existing access and release steps; large routine diffs. |
| Same-repo release-only commits **(recommended)** | Release commit retains exact source plus tested outputs. Parent/source SHA and package hashes connect it to reviewed main. Historical tags remain readable. | Same repo, hub identity, tag names and archive paths. Adds artifact preparation and exact-commit CI. No new reader access. |
| Separate distribution repository | Keeps future binary history out of source Git. Must record source SHA, lock/toolchain and package hashes across repos; old source snapshots remain available separately. | New repo, credentials and publication ordering; hub URLs and installer source change. More machinery for this goal. |
| GitHub release assets | Packages can be immutable and checksummed with source/build metadata. Downloading one tested object avoids a later rebuild. | Claude ZIP support; Pi/OpenCode installer work; Codex direct support unresolved. Private HTTP downloads need access handling beyond today's Git credentials. |
| Bundles inside hub | Hub commit records package bytes and catalog together; source provenance still crosses repositories. | Avoids an external plugin Git fetch, but makes every catalog checkout carry bundle history. Pi/OpenCode still need installer changes. Couples unrelated plugin releases. |

GitHub says generated source archives contain the tagged tree, not attached assets. Its immutable-release feature locks the tag/assets and produces a release attestation; attach all assets to a draft before publishing. These are **read in official docs**, not a finding that this repository has immutability enabled. An attestation proves published identity, not that tests passed.

Release-only commits solve main's review noise while retaining today's transports. They do not make ordinary full Git clones small. If avoiding all future binary Git objects becomes the primary requirement, a separate distribution repository is the compatible Git alternative; assets need the Codex question resolved first.

## 4. Tested bytes and required gates

**Verified by experiment, Node 24.22.1:** two sequential isolated builds of each harness produced identical hashes for all 98 output files, and matched the committed dist trees. This proves repeatability on this toolchain only, not cross-platform reproducibility or runtime correctness.

**Read in source code, source commit above:** `.github/workflows/ci.yml` runs tests before build. Its drift list includes Claude/Pi/OpenCode dist and launcher copies, but omits Codex dist. `scripts/check-version-bump.ts` triggers only on committed dist changes. `test/keys/validity/trees.ts:lastRelease()` uses `git describe` on ancestors of HEAD. The scratch release branch proved that this returns an older tag when the newest release is off main.

**Inferred required changes, before migration:**

1. Build complete packages from the reviewed source SHA with frozen dependencies before tests that consume packaged paths. Keep source tests and package entry/installer tests. Do not replace behavioral checks with checksum equality.
2. Record source SHA, artifact commit, runtime/adapter versions, lock hash, exact Node/pnpm/esbuild versions, and sorted file hashes plus executable modes. Include manifests, hooks, skills, launchers and copied runtimes. Reject extra or missing files.
3. Promote those tested trees without rebuilding different bytes at publication. Rebuild in a separate directory for reproducibility evidence, then compare every shipped path. Include Codex in that coverage.
4. Gate version changes from release-relevant source/build inputs or generated-output comparison, not tracked dist. Keep distinct runtime versions between different development builds: environment keys and daemon ordering still use them.
5. Replace ancestor-only release discovery with an explicit released source/artifact mapping. Preserve source snapshots in release commits so key comparison can still extract source and lockfiles. Do not silently use an older baseline.
6. Run full-suite CI for the exact final artifact commit through a release candidate branch or workflow dispatch. A green source parent alone is insufficient under the release rule. Update the documented exact-main assumption through the normal human-reviewed process. Promote hub pins/latest installer only after artifact checks pass; verify downloaded package hashes before promotion. No full suite ran in this research.

## 5. Migration and unresolved checks

**Inferred sequence:** first land the gates, explicit baseline mapping and a release assembler while main still holds bundles. Prepare a release-only commit from reviewed source, retain the full source tree and current plugin layout, and keep its immutable `squeal--v<V>` tag. Verify packages and exact-commit CI before moving hub pins and latest installer. Then stop tracking generated bundles on main; keep building them for local development and CI. Never merge artifact commits back into main. Keep all old tags, assets and IDs (`squeal@hearsay`), and preserve the existing installed-version retention rules. Document that direct development-checkout plugin use needs a build.

The old shell script still finds Pi/OpenCode in historical tag archives. Current Claude/Codex installs remain governed by hub pins; a versioned installer is not a four-harness version lock. Rollback can restore an old catalog target, but active-daemon version ordering means a complete downgrade is **not established**. Prefer a new higher runtime version built from the intended older source unless isolated rollback proves otherwise.

The separate stable Codex adapter/runtime split is **in progress**, per this task and the 2026-10-27 coordination note. It is not shipped behavior in the examined source. Agree the adapter/runtime artifact contract before implementing this migration. It may make runtime assets preferable later; this report does not assume its transport, session-pin policy or approval behavior.

Smallest remaining checks:

- **Not determined:** current Claude/Codex update behavior when only the Git location changes while plugin identity remains. Use a dummy hub and scratch homes for install, update and rollback; include a missing ref and checksum mismatch where supported. Do not use real installations.
- **Not determined:** final stable-Codex split contract. Confirm its package format, version identity, runtime selection and rollback/retention requirements with its coordinator before choosing Codex release artifacts.
- **Not determined:** cross-platform build equivalence and release-download authentication for private assets. Run the package hash probe on the release toolchain/platforms; probe private asset access only if choosing assets. No credential or repository setting was inspected here.

Sources: repository paths cited above, `src/harness/{build,claude-code/build,codex/build,pi/build,opencode/build}.ts`, plugin manifests/hooks, `install.sh`, `src/cli/update.ts`, process step 6a, spec 001 D9/status and [prior hub research](release-hub.md). Official URLs, source versions, extracted claims and response hashes are in [sources.md](probes/dist-distribution/sources.md).
