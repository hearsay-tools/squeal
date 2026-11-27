# Issue 297: credential-free sandbox installation

Date: 2026-11-27. Owner: spec 005 D3. Related contracts: spec 002 D1 and D7–D9; spec 012 CC1. Issue: https://github.com/hearsay-tools/squeal/issues/297.

## Verdict

**Reproduced the marketplace access barrier, not an end-to-end harness install.** Clean-environment anonymous GitHub access cannot fetch the marketplace. A public runtime download path already exists in the README's CI section. The original 2026-11-20 incident has no command log and remains unverified.

Squeal examined: repository version **0.1.654**, checkout `8aa9a1d60cebde8f4fc9d2a76f2b0cbd447887a2`; public runtime descriptor names release commit `503cc5e85395f59c1b3d33614e647b070ea02f2c`. The issue names 0.1.647 but says that was established later. Host one-minute load was **5.66** with **16 CPUs** (`/proc/loadavg`: `5.66 6.20 6.63`), below the skip threshold. Only short network requests ran; no builds or tests ran.

## Findings

| Question | Answer and evidence |
| --- | --- |
| Does the marketplace require credentials now? | **Verified by experiment, 0.1.654 context:** clean-environment API request returned HTTP 404; credentials-disabled `git ls-remote` failed with `fatal: could not read Username for 'https://github.com': terminal prompts disabled`. This reproduces the access barrier the installer encounters. |
| Does installation depend on it? | **Read in source code / official docs, 0.1.654:** `install.sh` and README Install use the harness marketplace commands for Claude Code and Codex. README explicitly says the hub is private and needs access and GitHub credentials. Spec 005 D3 owns this install contract. |
| Is a public standalone path absent? | **Read in official docs, 0.1.654:** README CI / Pin one release documents downloading `squeal-codex-runtime.json.gz`, verifying a pinned SHA-256, unpacking it and running `dist/cli/squeal.mjs` without a harness. It explicitly says the install script also works outside GitHub Actions with its three variables set. **Verified by experiment:** its 0.1.654 descriptor downloads in a clean environment, naming the public runtime asset and SHA-256. The asset download, extraction and CLI execution were not tested. |
| Is that equivalent to full plugin installation? | **Inferred from spec 005 D3, 002 D1/D7–D9 and 012 CC1:** no. A bare runtime does not itself register harness hooks or preserve the plugin's install/update/trust contract. This probe did not run Claude Code or Codex installation. |

## Commands and limits

Exact commands are preserved in [the throwaway probe](probes/issue-297/README.md). The clean descriptor request returned schema 1, version `0.1.654`, artifact `squeal-codex-runtime.json.gz`, SHA-256 `16eaf8b95c6b68d9c8856ec807681c3b952d3df3f600a6b0f5cb05a41f4f91b1`.

An initial request using the session's inherited environment could access the marketplace. That result was discarded as anonymous evidence. The repeat used `env -i`, no curl config, no system/global git config, no credential helper and disabled prompts. No credentials or authentication headers were read or saved.

## Decision input

Choose whether to make the existing public standalone runtime path clear in the main Install section, or to authorize a supported credential-free installer/plugin path. The latter changes the installation contract and needs a separate approved implementation row. This triage changes no product behavior or existing hold.

Sources: README Install and CI / Pin one release; `install.sh`; `docs/specifications/005-agent-adoption/spec.md` D3; `docs/specifications/002-codex-adapter/spec.md` D1, D7–D9; `docs/specifications/012-claude-code-adapter/spec.md` CC1; issue #297.
