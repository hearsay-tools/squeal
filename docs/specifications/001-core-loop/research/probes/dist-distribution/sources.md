# Fetched source record

Fetched/read 2026-10-27. Quotes or compact extracts below are evidence, not instructions. SHA-256 covers each complete fetched response or local file. HTML was reduced to main-element text for reading.

## OpenAI plugin packaging

URL: <https://developers.openai.com/plugins/build/plugins>

SHA-256: `bf94e82ec948571f412af27e6c78e0bb0ae4bbb52f3afa107d38741077684a19`

Marketplace entries can also point at Git-backed plugin sources. Use "source": "url" when the plugin lives at the repository root, or "source": "git-subdir" when the plugin lives in a subdirectory. Git-backed entries may use ref or sha selectors. For npm, version accepts package versions, tags and ranges, but not path or URL selectors.

## Claude marketplace reference

URL: <https://code.claude.com/docs/en/plugins/marketplace-reference.md>

SHA-256: `2b353a0f227f1637b8c5f5709d3de843054a31c81e38d769d00fb00544f3635c`

"archive" uses url and sha256: "Zip archive over HTTPS. Requires Claude Code v2.1.224 or later". "When you set both ref and sha, Claude Code checks out sha." "The plugin root may be at the top of the zip or one directory down."

## GitHub releases

URL: <https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>

SHA-256: `5d89f70e01cb3d508d0161b27301503d4da749ed8d531826be68e96c0c4037a1`

"GitHub will automatically include links to download a zip file and a tarball containing the contents of the repository at the point of the tag's creation." Each release asset must be under 2 GiB; up to 1000 per release.

## GitHub immutable releases

URL: <https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases>

SHA-256: `b5bba6fb6813147ec5ad9990c480d7f07d925ef2dce897a3a9c733743bfd3f5c`

"Only the assets and tag are locked." Publication generates a release attestation. Recommended order: create draft, attach assets, publish draft. This research did not inspect or enable repository immutability settings.

## Pi packages, installed 1.0.4

URL: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md>

SHA-256: `5fe4a3009d7260fe1e2f54b64086fc3c8b4d678232bfa2dbc7e91fe588fc9ea5`

"Install from npm, git, or a local path". URL: "Treated as a git source". Local: "Loaded from the resolved path without copying". "Local packages are not installed or modified". Citation is the versioned installed package, not the mutable online main.

## OpenCode plugin loader, v1.18.35

URL: <https://github.com/sst/opencode/blob/v1.18.35/packages/opencode/src/plugin/loader.ts>

SHA-256: `a7eba2d328a36a2486b50245ad98ef0daa769d4109c9e50470d8493b0936c4c0`

resolve() calls resolvePluginTarget(), then inspects the server/tui entrypoint, then load() imports the module.

## OpenCode plugin target, v1.18.35

URL: <https://github.com/sst/opencode/blob/v1.18.35/packages/opencode/src/plugin/shared.ts>

SHA-256: `1ada9e15915e47bbb7b16436f0018c9b86845a66e687d89d037be896b9663140`

resolvePluginTarget() resolves path plugin specs directly; otherwise it calls Npm.install(). PluginSource is "file" | "npm".

## OpenCode package install, v1.18.35

URL: <https://github.com/sst/opencode/blob/v1.18.35/packages/core/src/npm.ts>

SHA-256: `f8b7a8e65606a2738cc1a5074860585b92a549643e9ea0a8101c346d1c390193`

Npm.install uses @npmcli/arborist; the package cache uses global.cache/packages. This conflicts with the same tag's docs saying Bun and node_modules. Prefer the implementation.

## OpenCode plugins docs, v1.18.35

URL: <https://github.com/sst/opencode/blob/v1.18.35/packages/web/src/content/docs/plugins.mdx>

SHA-256: `4cc0d8db8645a036d1398a9e3be65c386ab75d003a2699c14bc06c267ea1354f`

Documents local plugin files and npm package configuration. Its Bun/cache description is stale against the implementation above.

The older OpenAI URLs `/codex/plugins/` and `/codex/build-plugins` returned general plugin usage/creator content. Following their developer packaging link yielded the Git source fields above. No official Codex direct release-archive source was established. No undocumented support is assumed.

GitHub `/en/repositories/releasing-projects-on-github/immutable-releases` returned 404; the code-security URL above succeeded.
