# Throwaway distribution probes

These probes support [the findings](../../dist-distribution.md). They are research fixtures, not product code or regression suites. Run from the repository root. No harness installation, settings mutation, publication, full suite, credentials or model session is involved. Temporary builds and Git repositories are deleted on exit. Do not commit `node_modules` or generated bundles here.

Examined product commit: `181054dd748f2834b423a23b1cababd0d520dd5d` (0.1.367). Run date: 2026-10-27. Node 24.22.1. Dependencies were already installed from the pinned pnpm lock.

| Command | Saved result | Actual result |
|---|---|---|
| `python3 docs/specifications/001-core-loop/research/probes/dist-distribution/inventory.py 181054dd748f2834b423a23b1cababd0d520dd5d` | `inventory.json` | Exit 0. 98 dist files, 35,618,004 bytes. Last 100 first-parent commits: three touch dist; dist contributes 22,520 of 45,852 changed text lines. |
| `pnpm exec tsx docs/specifications/001-core-loop/research/probes/dist-distribution/build.mts` | `build.json` | Exit 0. Two builds each of four harnesses. No repeat differences and no checkout differences across 98 files. |
| `python3 docs/specifications/001-core-loop/research/probes/dist-distribution/archive.py` | `archive.json` | Exit 0. Actual installer `unpack()` extracts Pi/OpenCode with all hashes equal. Git plugin targets contain hook bundles. Main contains no dist. Ancestor-tag helper misses the newest release tag. |

`build.mts` reads the current checkout and installed dependencies. Reproduce it at the examined source commit. It calls exported output-directory builders, not the in-place build entry points, so it does not change product files. It tests bytes only, not runtime execution or complete manifest/skill generation. `inventory.py` is read-only and measures uncompressed blob sizes and numstat, not pack or transfer sizes. `archive.py` pins its input commit, creates a disposable Git repository from the real plugin trees, and calls only the original installer function definitions through `unpack()`. It never calls `main`, `pi`, `opencode`, `claude`, or `codex`. Its synthetic source/release topology proves extraction and ancestor selection, not full release automation. Archive size is only for the fixture's plugin trees and metadata, not the whole Squeal source archive.

`sources.md` records official URLs, versions, excerpts and complete response/file SHA-256 hashes. Fetches used `curl -fsSL --max-time 30 <URL>`; HTML pages were read through an HTMLParser extracting main-element text and omitting scripts/styles. No web search outside the named official sources was used. Pi docs were read from the installed 1.0.4 dependency. OpenCode files were fetched from its exact `v1.18.35` tag. The local hub manifests in `hub.json` were read from the cached hearsay checkout at `5fb7ee04ead913f5183c3cd8985890ba938c89e5`; no private configuration or credentials were copied.

Full-suite tests, live harness installs, remote publication, remote permission settings, other operating systems, and a stable Codex adapter/runtime implementation were not tested.

## Completion verification

`git diff --cached --check` passed after staging. Every saved JSON file parsed, and local Markdown links resolved. The three explicit probes above exited 0.

Affected-status command:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  docs/specifications/001-core-loop/research/dist-distribution.md \
  docs/specifications/001-core-loop/research/probes/dist-distribution/inventory.py \
  docs/specifications/001-core-loop/research/probes/dist-distribution/build.mts \
  docs/specifications/001-core-loop/research/probes/dist-distribution/archive.py
```

Actual result: exit 3, revision 0. No daemon had validated since `2026-10-27T13:49:29.446Z`; the daemon had stopped. No test file's closure held any of the four selected paths. Worktree: zero known failures; 478 of 1,270 test files were unknown. There is no affected-test pass to claim. The independent research probes are the relevant validation here. No product code changed; no product suite, lint or typecheck was run for these docs and throwaway probes.
