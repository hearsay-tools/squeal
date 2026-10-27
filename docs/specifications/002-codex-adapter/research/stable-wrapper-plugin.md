# An unchanged hook plugin with a separate runtime

A wholly fixed hook plugin can retain approval while its external runtime updates; this requires separate runtime ownership and an explicit version policy.

Row 002-27 / wave 3 R2. Examined 2026-10-27 on Linux, Node 24.21.0, installed Codex 0.164.0. Source: `rust-v0.164.0`, commit `6aaac694803004a63c6f393d153c96d22521a6b9`. This is research, not approval to change Squeal's packaging. No product file, real configuration, credential or release changed. No model request was made.

## Answers

| Question | Answer and tag |
| --- | --- |
| Does an entirely unchanged plugin retain approval after an external runtime update? | Yes: 10/10 hooks retained identical composite hashes and trusted status. A real Codex SessionEnd executed the new runtime. **Verified by experiment**, 0.164.0. |
| Does an unchanged wrapper inside a changing plugin suffice? | No: a manifest-only version update modified all 10 approvals. The wrapper bytes and declaration hashes stayed identical. **Verified by experiment**, 0.164.0. |
| Do changed wrappers invalidate approval? | Yes: adding a comment to `wrapper.sh` modified all 10 approvals and prevented real SessionEnd execution. **Verified by experiment**, 0.164.0. |
| Do spaces and a missing runtime work? | Spaces worked in actual execution. A missing runtime left approval unchanged and the guarded fixture exited silently. That silence is the fixture's policy, not runtime-health evidence from Codex. **Verified by experiment**, 0.164.0. |
| Can a symlink provide the same result inside the plugin? | The fingerprint rejects symlinks as unsupported entry types; it does not follow them. **Read in source code**, 0.164.0. No symlink workaround was attempted. |
| What happens to an old thread? | A thread opened while B was selected executed C at SessionEnd after the selector changed, in the same server process. This wrapper selects the current runtime on every call. **Verified by experiment**, 0.164.0. |

## Approval and execution proof

**Verified by experiment, 0.164.0.** [The bounded probe](probes/stable-wrapper-plugin/run.mjs) derives from 002-25's committed probe. Two scratch homes install a local fixture with Squeal's ten handler positions, including both Stop entries. Each command calls the same plugin-owned shell wrapper. The wrapper reads a selector in `PLUGIN_DATA/runtime/` and executes a versioned fixture outside the plugin root. Each fixture records its version, file, handler, incoming event and session ID, then returns `{}`.

The first update in each home changes only the external runtime from A to B. The probe compares SHA-256 file inventories of the installed plugin before and after. They match exactly. It also compares every `hooks/list` entry, including both parts of `currentHash`. Each home receives one explicit initial approval through `config/batchWrite`. The entire scratch config remains byte-identical through all later steps. No bypass flag or fingerprint exclusion is used.

| Observation | Fixed plugin | Same wrapper in updated plugin |
| --- | ---: | ---: |
| Trusted after explicit approval | 10/10 | 10/10 |
| Trusted after runtime-only A to B | 10/10 | 10/10 |
| Real SessionEnd version before / after runtime update | A / B | A / B |
| Real SessionEnd for thread opened under B, closed after C | C | C |
| Shell replay runs for each of A, B and C | 10/10 | 10/10 |
| Later mutation | Wrapper comment | Manifest 1.0.0 to 1.0.1 |
| Trusted after that mutation | 0/10 | 0/10 |
| Real SessionEnd runtime executions after mutation | 0 | 0 |

Actual boundaries use `thread/start` followed by `thread/archive`, without `turn/start`. The incoming `hook_event_name` is `SessionEnd`, and its session ID equals the archived thread ID. Before initial approval, the same boundary records no runtime execution. After each mutation, the runtime exists but Codex records no execution. This distinguishes trust enforcement from a missing executable.

The other nine handler positions were **shell replay only**: bash ran the listed commands with Codex's documented plugin environment. Those checks establish dispatch and quoting, not real PreToolUse, Stop or other lifecycle behavior. No complete model session was tested.

For the fixed home, removing `current.txt` keeps all ten approvals trusted. All ten shell replays return 0 with empty stdout and no execution record; actual SessionEnd also records none. The other home's already-modified status stays modified. A real product needs an observable setup/status check for a missing runtime, since hook approval alone does not mean validation is running.

## Why it works, and the symlink limit

**Read in official docs, fetched 2026-10-27.** The [hooks guide](https://developers.openai.com/codex/hooks/) says changed hooks are skipped until trusted. It documents `PLUGIN_ROOT`, the writable `PLUGIN_DATA`, and SessionEnd when an open conversation is archived. It does not promise separate runtime verification.

**Read in source code, 0.164.0.** `discovery.rs:280–334` supplies the plugin root and separate data root. Lines 730–785 combine declaration and plugin content hashes for approval. `plugin_trust.rs:28–69` recomputes plugin contents at execution. `plugin_fingerprint.rs:15–97` walks the plugin root, hashing relative paths and bytes. It does not recursively inspect external files named by a shell command. The runtime is outside that root, so its changes do not change the hash.

The fingerprint uses `symlink_metadata`. A symlink is neither a directory nor a regular file and reaches `unsupported plugin entry type`; a symlinked root also fails its directory check. Thus placing a link to the changing runtime inside the plugin is not an established supported alternative. The probe uses ordinary files and a regular selector file outside the root.

**Inferred.** Approval now delegates execution to an independently maintained runtime location. It still detects changes to the fixed plugin; it does not approve each later runtime release. The installer/updater must own runtime provenance. This is a different packaging and approval boundary from today's bundle, not a command-only repair. It qualifies 002-25's broader negative inference: no upstream policy change is needed for this split, but keeping the whole hook plugin fixed is essential.

## Packaging and version consequences

These are **inferred proposals**, grounded in the experiment and repository sources, not implemented behavior:

- Keep the entire hook plugin fixed: manifest, wrapper, declarations, bundled skills and every other fingerprinted file. Putting a constant wrapper in today's changing Squeal bundle fails. Any actual wrapper repair still needs fresh approval.
- Provide a separate runtime install/update step before hooks need it. A frozen plugin cannot keep copying new runtime code from its own unchanged bundle. An installer or a separate hook-free package could populate the runtime store. This probe models that step with file writes; it does not test a release or package manager transaction.
- Give the updater one owner for complete versioned copies, an atomic selector change, rollback and retention. Codex's normal update of the wrapper plugin alone cannot supply new runtime bytes. `src/cli/update.ts` currently delegates Codex updates to `plugin marketplace upgrade`; a split must define how that command also delivers the runtime.
- Decide whether existing sessions switch runtimes or pin one. The probe proves immediate switching, even for an already-open thread. A stable wrapper version and `PLUGIN_ROOT` no longer identify the selected runtime version. Session pinning would require separate durable state and retention; it is unimplemented and unverified here.
- Preserve each daemon's own recorder/reporters and each session's required skill files. Spec 005 D3 and `version-copies.ts` already keep versioned copies. However, `keepCodexCli` uses `PLUGIN_ROOT` as the copy source, and `keepVersion` requires its manifest to match the runtime version. A fixed wrapper manifest cannot satisfy that check for later runtime releases. Copy ownership and version provenance need an explicit change; existing preservation code is not a ready external-runtime installer.
- Keep one owner of each intended handler. A new wrapper plugin alongside the existing hook-bearing plugin or launcher declarations risks double execution. The migration must remove/disable the superseded declarations or make the separate runtime package hook-free. The two distinct Stop handlers remain intentional. Duplicate installation and migration were not exercised.

**Read in repository evidence / verified by experiment.** Spec 005 D3 and [plugin-cache-cleanup.md](../../005-agent-adoption/research/plugin-cache-cleanup.md) document Codex deleting old cache versions. This probe's manifest update also removes 1.0.0. The fixed-plugin runtime updates leave its cache root intact. Keeping an old runtime outside that cache helps only if its separate updater retains it.

## Recommendation, checks and limits

Treat the split as feasible and put its runtime ownership and session-version policy into the next design decision. Do not implement it as a small wrapper edit inside the existing bundle. The deciding tradeoff is fewer Codex approval prompts in exchange for a separately trusted runtime updater and explicit version coordination.

Command: `node docs/specifications/002-codex-adapter/research/probes/stable-wrapper-plugin/run.mjs > docs/specifications/002-codex-adapter/research/probes/stable-wrapper-plugin/results.json`. Exit 0. Both scenarios print `runtime-only trusted=10/10; shell A/B/C=10/10; boundary records=1; missing runtime silent=10/10`; their respective wrapper edit or plugin update prints `modified=10/10`. [Full observations](probes/stable-wrapper-plugin/results.json) retain all assertions' inputs and runtime records.

Squeal `status --wait 60000` on the probe returned exit 3: no test closure holds this research file; 0 known failures, 1042 unknown of 1265 test files. The probe itself is the direct verification. No product suite, build or full-suite checkpoint ran. Not determined: production bootstrap/update transactions, complete turn lifecycle, session pinning, updater concurrency, Windows/macOS, future Codex behavior, or end-to-end Squeal daemon compatibility with this split.

Sources read: [Codex hooks](https://developers.openai.com/codex/hooks/) and [plugins](https://developers.openai.com/codex/plugins/); versioned [discovery.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/discovery.rs), [plugin_fingerprint.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/plugin_fingerprint.rs), [plugin_trust.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/plugin_trust.rs), [store.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/store.rs); local `stable-hook-approval.md` and probe, spec 002 D1/status, spec 005 D3/cache research, `src/harness/codex/kept.ts`, `src/harness/shared/version-copies.ts`, and `src/cli/update.ts`.
