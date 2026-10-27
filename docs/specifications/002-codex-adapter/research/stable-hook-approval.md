# Stable hook approval across plugin upgrades

Keep the existing hook commands: a command-only change cannot preserve approval across version-only updates in Codex 0.164.0.

Row 002-25 / wave 3 R1. Examined 2026-10-27 on Linux, Node 24.21.0, installed `codex-cli 0.164.0`; upstream tag `rust-v0.164.0`, commit `6aaac694803004a63c6f393d153c96d22521a6b9`. Only scratch homes were used. No model request, product change, real config write or real trust write occurred.

## Questions and verdict

| Question | Answer | Evidence |
| --- | --- | --- |
| 1. What does current Codex hash before and after expansion? | It hashes each normalized **raw declaration** before `${PLUGIN_ROOT}` replacement. It also fingerprints the whole plugin. `hooks/list.currentHash` joins both hashes with `/`. The command it lists has already had braced references replaced. | **verified by experiment**, 0.164.0; **read in source code**, same tag |
| 2. Does shell-time `$PLUGIN_ROOT` retain trust and run the current version, including spaces? | It executes the selected installed version correctly, as does the existing braced command. Neither retains approval after a manifest-only version bump: 10/10 hooks become modified. There is no proven minimal command that meets the approval goal under this policy. | **verified by experiment**, 0.164.0 |
| 3. What must change in launcher config, hash tests and migration guidance? | No command replacement is justified. Separate declaration fingerprints from plugin approval in documentation and tests. The launcher port still matches declaration hashes. If a later decision adopts bare syntax for another reason, launcher substitution must also handle it. Existing trust writes already accept Codex's composite hash, but that is renewed approval. | **read in source code** and **inferred**, 0.164.0 plus this checkout |

## Two separate identities

**Read in source code, 0.164.0:** `hooks/src/engine/discovery.rs:599–609` copies the raw command into the normalized config, then replaces exactly `${<environment-key>}` for execution. `hook_hash` at line 874 hashes the normalized identity `{event_name, matcher?, hooks:[handler]}` using the existing canonical TOML/JSON fingerprint. The plugin key remains `<plugin>@<marketplace>:hooks/hooks.json:<event>:<group>:<handler>`, without version or absolute path.

**Read in source code, 0.164.0:** `discovery.rs:730–785` combines that declaration hash with `plugin_content_hash` and evaluates both approvals. `plugin_fingerprint.rs:15–97` hashes relative paths, entry types and file bytes under the plugin root. It includes `.codex-plugin/plugin.json`; it does not exclude the manifest version. Its exclusions are `__pycache__`, `.venv`, `*.pyc` and `*.egg-info`. The root's absolute path is absent from that fingerprint. `plugin_trust.rs:51–69` requires the declaration hash and content hash to match. Thus removing version text from a command cannot neutralize a changed manifest's hash.

**Verified by experiment, 0.164.0:** after `config/batchWrite` receives the composite `currentHash` as `hooks.state."<key>".trusted_hash`, Codex saves separate `trusted_hash` and `trusted_content_hash` values. The probe preserves those lines in `results.json.savedTrust`. This works through the same API shape Squeal's `src/cli/codex/trust.ts` uses. It is approval of the current bundle, not persistence of old approval.

**Read in source code, 0.164.0:** the `/hooks` browser obtains `hooks/list`; its trust action submits `current_hash` through `config/batchWrite` (`tui/src/hooks_rpc.rs:24–90`). It displays the aggregate `Modified since last trusted - review required` (`bottom_pane/hooks_browser_view.rs:663–669`). The inspected UI does not distinguish a changed command from changed bundle content. The API exposes the two hash components through `currentHash`; the saved config exposes the two approval fields. A separate user-facing content-approval switch was not found in these paths.

**Read in official docs, fetched 2026-10-27:** the [hooks guide](https://developers.openai.com/codex/hooks/) says Codex requires review of the exact definition, records its current hash, and skips changed hooks until trusted. It documents the plugin environment variables and `/hooks`. It does not explain the new bundle fingerprint. The versioned source and installed binary settle this detail.

## Upgrade and execution results

**Verified by experiment, 0.164.0:** [run.mjs](probes/stable-hook-approval/run.mjs) installs a local harmless plugin through real Codex commands in two independent scratch homes. It uses all 10 current Squeal entries: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, both Stop handlers, SubagentStart, SubagentStop, Interrupt and SessionEnd. The fixture files are identical between versions; only the manifest changes from 1.0.0 to 1.0.1. The install root contains spaces. Full observations are in [results.json](probes/stable-hook-approval/results.json).

| Observation | Existing `${PLUGIN_ROOT}` | Shell-time `$PLUGIN_ROOT` |
| --- | ---: | ---: |
| Trusted after initial approval | 10/10 | 10/10 |
| Stable declaration hashes after version bump | 10/10 | 10/10 |
| Changed content hash after version bump | 10/10 | 10/10 |
| Trusted after version bump, before any new approval | 0/10 | 0/10 |
| Commands executing the 1.0.1 fixture through `bash -c` | 10/10 | 10/10 |
| Raw declaration hashes matching Codex | 10/10 | 10/10 |
| Hash of listed command matching declaration hash | 0/10 (expanded path) | 10/10 (unexpanded variable) |
| Modified after editing only PostToolUse, following fresh approval | 10/10 | 10/10 |

Only PostToolUse's declaration hash changed in the final check. The shared content hash changed for every hook. Both installations removed the old version directory. Shell execution used the commands Codex listed and its documented `PLUGIN_ROOT` environment; it did **not** make Codex execute hooks marked modified. No bypass flag was used.

For example, the braced SessionStart retained declaration hash `sha256:0c132913495a596585c293ba3dc3ee08e28d27884a83274999b617bcd8e91b96`. Its bundle hash changed between install versions. This directly refutes version-dependent command identity as the cause in this experiment.

## Compatibility and supported choices

**Read in repository evidence:** [wave-0-checks.md section 3](wave-0-checks.md#3-trust-hash) recorded 0.160.1 preserving trust across a version bump with braced commands. That result was valid for its recorded version. It is not the behavior of 0.164.0. The exact intermediate release that added bundle approval was not determined.

**Read in source code / inferred:** `src/cli/codex/hash.ts` ports declaration hashing, pinned to 0.160.1. This probe confirms its normalized algorithm for all 10 current entries in 0.164.0, but a declaration hash alone no longer equals plugin `currentHash`. Keep the old fixture as a historical contract; add a version-labelled composite-hash upgrade test if implementation follows. Do not bless a new syntax by merely updating pinned hashes. `trust.ts` should continue treating `currentHash` as opaque. Its existing explicit approval route works; automatically calling it after each upgrade would change the approval policy.

**Read in source code / inferred:** `launcher.ts` replaces only `${PLUGIN_ROOT}` because config-defined hooks get no plugin-specific environment. Changing the plugin to `$PLUGIN_ROOT` alone would leave launcher commands unresolved (or dependent on an inherited foreign value). Any separately approved syntax change needs token-bounded handling of both forms, absolute path quoting, existing metacharacter rejection, and matching hashes computed after launcher substitution. `test/cli/codex.test.ts` already requires no `PLUGIN_ROOT` reference in emitted commands. Preserve coverage for spaces, both Stop entries, fast paths and all other hooks.

| Supported choice | Tradeoff and evidence |
| --- | --- |
| Keep plugin hooks and review each changed bundle through `/hooks` or Squeal's explicit `init --harness codex --trust` flow. | Retains Codex's content approval. Adds review after a version-only update in 0.164.0. **Verified by experiment** for the API; **read in docs/source** for UI and Squeal flow. Recommended under the present scope. |
| Use the existing launcher-defined hooks and their explicit per-launch trust config. | Config hooks have declaration trust without a plugin bundle fingerprint. The launcher assumes responsibility for selecting and approving executable code; it must refresh absolute paths after updates and avoid duplicate plugin hooks. This is a different trust boundary, not preserved plugin approval. **Read in source code**, discovery's optional `plugin_root`/content hash and Squeal `launcherConfig`; not end-to-end exercised here. |
| Use managed hooks under an administrator's policy. | The official guide says managed hooks are trusted by policy and cannot be disabled through the user browser. Requires managed configuration and changes ownership of approval. **Read in official docs/source**, not probed. |
| Use documented `--dangerously-bypass-hook-trust` only in externally vetted automation. | Runs enabled hooks without persisted trust for that invocation. Bypasses the check rather than preserving it; unsuitable as a silent plugin fix. **Read in official docs**, not used or recommended by this probe. |

**Inferred:** meeting the original goal while keeping ordinary plugin content approval needs a change in Codex's approval policy (for example, an upstream decision about version-only metadata), not a hook command rewrite. Excluding manifest changes alone would still not preserve approval when bundled code changes. No such supported exception was established here. Do not move executable code outside the bundle merely to evade its fingerprint.

Migration guidance in spec 002 D1 and spec 005 D3 must qualify the old claim that approval survives every upgrade by Codex version. Switching command syntax itself needs one fresh approval and cannot remove future bundle reviews. Bare syntax also does not fix a running process that still holds the deleted old cache root: `PLUGIN_ROOT` comes from the loaded plugin source, not a dynamic newest-version lookup (**read in source code**, discovery lines 286–305). Preserve the existing saved-copy and restart guidance.

## Verification and limits

Command: `node docs/specifications/002-codex-adapter/research/probes/stable-hook-approval/run.mjs > docs/specifications/002-codex-adapter/research/probes/stable-hook-approval/results.json`. Exit 0. Each form printed `installed=10, approved=10, upgrade trusted=0, executed=10, changed modified=10`. Assertions covered stable keys and declaration hashes, changed bundle hashes, all hook statuses and version-correct execution. No product suite ran: this task changes only research and throwaway probes.

Not determined: Windows shell compatibility, the first affected Codex release, a complete event lifecycle inside a model session, and hooks already loaded in a running process during upgrade. These are not needed to decide whether the requested syntax-only change can satisfy the current approval goal. The negative result is established by both the installed binary and versioned source.

Sources: [official hooks](https://developers.openai.com/codex/hooks/), [official plugins](https://developers.openai.com/codex/plugins/); upstream `rust-v0.164.0` [discovery.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/discovery.rs), [plugin_fingerprint.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/plugin_fingerprint.rs), [plugin_trust.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/plugin_trust.rs), [command_runner.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/command_runner.rs), [hooks_rpc.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/hooks_rpc.rs), [hooks_browser_view.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/bottom_pane/hooks_browser_view.rs). All source files cited were fetched at that tag. Local sources: `plugins/codex/hooks/hooks.json`, `src/cli/codex/{hash,launcher,trust}.ts`, `test/cli/codex{,-hash}.test.ts`, spec 002 D1/D4 and status, and spec 005 D3.
