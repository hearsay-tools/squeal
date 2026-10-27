# 002-30 runtime release artifact and validated staging: notes

Worker notes for the packaging row, the updater/CLI row and the reviewer. Date: 2026-10-27. Spec 002 D8, `tasks/wave-4-contract.md`. Code: `src/harness/codex/runtime-release/`, tests: `test/harness/codex/runtime-release/`. Import only from `runtime-release/index.ts`.

## What this row does and does not do

- Does: create and check `runtime.json`; pack a runtime tree into the artifact; write and parse the release descriptor; resolve the latest release once; download the descriptor and artifact from that exact tag; validate everything in memory; write a private staging tree; validate it again from disk; return its root and a cleanup handle.
- Does not: publish into `versions/`, write `runtime/current.json` or session pins, take an updater lock, keep a retry delay, schedule anything, read a token, or change the fixed plugin, its seed, install directories or user config. W1's `publishRuntime` owns publication. Nothing here imports W1's code.

## Public interface

### Packaging (build row)

```ts
createRuntimeManifest({ root, version, nodeFloor }): RuntimeManifest
serializeRuntimeManifest(manifest): string            // write this as <root>/runtime.json
validateRuntimeTree(root, { expectedVersion?, nodeVersion? }): RuntimeManifest
packRuntime(root, nodeVersion?): { version, envelope: Buffer, artifact: Buffer, sha256 }
createReleaseDescriptor({ version, sha256, releaseCommit }): RuntimeReleaseDescriptor
serializeReleaseDescriptor(descriptor): string
RUNTIME_ARTIFACT_ASSET = "squeal-codex-runtime.json.gz"
RUNTIME_DESCRIPTOR_ASSET = "squeal-codex-runtime.json"
REQUIRED_ENTRIES, HOOK_ENTRIES, LAUNCHER, PLUGIN_MANIFEST, RUNTIME_MANIFEST
```

Build order: build `plugins/codex-runtime/` with every required entry, then `createRuntimeManifest`, then write `runtime.json` with `serializeRuntimeManifest`. At release time, run `packRuntime` and `createReleaseDescriptor` with the exact release commit. Upload both assets to the `squeal--v<version>` release. `packRuntime` refuses a tree that `validateRuntimeTree` refuses.

Required entries (`REQUIRED_ENTRIES`): `.codex-plugin/plugin.json` (name `squeal`, same version as `runtime.json`), `dist/runtime.mjs`, `dist/cli/squeal.mjs`, `bin/squeal-launcher` (mode 0755), `skills/squeal/SKILL.md`, and the ten `dist/<hook>.mjs` entries of `hooks.json`. The committed `plugins/codex` has every entry but `dist/runtime.mjs` today; `limits.test.ts` adds a stand-in.

Reproducibility: `envelope` is canonical JSON and is the same for the same tree on every platform. The gzip bytes are fixed for one zlib build only: level 9, zero mtime, no name, OS byte 255. A drift check across machines compares `envelope`, not `artifact`. The descriptor binds the published `artifact` bytes.

### Updater and CLI (wiring row)

```ts
resolveRuntimeRelease({ transport?, signal?, timeoutMs?, tag? }): Promise<RuntimeRelease>
  // RuntimeRelease = { tag, descriptor }; one listing request (none with tag) + the descriptor; writes nothing
prepareRuntimeUpdate({ transport?, signal?, timeoutMs?, tag?, release?, stagingDir, limits?, nodeVersion? })
  : Promise<PreparedRuntimeUpdate>
  // PreparedRuntimeUpdate = { root, version, releaseTag, releaseCommit, sha256, cleanup }
stageRuntimeArtifact({ artifact, sha256?, expectedVersion?, stagingDir, limits?, nodeVersion? }): StagedRuntime
  // the offline step for a local artifact file: { root, version, manifest, sha256, cleanup }
decodeRuntimeArtifact(artifact, { limits?, expectedVersion?, nodeVersion? }): DecodedRuntime  // memory only
fetchTransport: ReleaseTransport           // Node fetch, follows redirects, no credentials
type ReleaseTransport = (url, { headers, signal }) => Promise<{ status, headers: { get }, body: AsyncIterable<Uint8Array> | null }>
class RuntimeReleaseError { code; status; transient }
LATEST_RELEASE_URL, releaseAssetUrl(tag, asset), releaseTagFor(version), versionOfTag(tag)
DEFAULT_RUNTIME_LIMITS, DEFAULT_RELEASE_TIMEOUT_MS (120 s for the whole operation)
```

Suggested updater sequence, under the updater lock:

1. `resolveRuntimeRelease()`. If `descriptor.version` is already retained, stop. No artifact is downloaded.
2. `prepareRuntimeUpdate({ release, stagingDir: <PLUGIN_DATA>/runtime/staging })`. Keep the staging directory on the same file system as `versions/`, so publication can rename.
3. W1 `publishRuntime({ sourceRoot: prepared.root, data, select: true })`.
4. `prepared.cleanup()` in a `finally`. It is idempotent and removes only `stagingDir/squeal-runtime-XXXXXX/`.

Error codes: `network`, `timeout`, `aborted`, `http` (`status` set), `too-large`, `release`, `descriptor`, `integrity`, `artifact`, `runtime`, `node`, `staging`. `transient` is true for `network`, `timeout`, `staging`, and HTTP 408, 429 and 5xx. Use it to pick the persisted retry delay. A non-transient error means this release is wrong for this host until a new release appears. `node` means the runtime needs a newer Node; report it as such.

## Validation rules (where each one is checked)

- Paths (`checkRuntimePath`): relative, `/` separators, each segment `[A-Za-z0-9._@+-]{1,255}`, not `.` or `..`, at most 1,024 characters. This refuses absolute paths, traversal, backslashes, spaces, control characters and non-ASCII. Every name in `plugins/codex` 0.1.366 fits.
- Path sets (`checkPathSet`): no two paths equal when case is ignored, and no file is a parent directory of another file.
- Modes: 0644 or 0755 only. On disk the execute bit decides, so a checkout under umask 002 (0664/0775) validates. The staged tree is written with the exact modes.
- `runtime.json` must be byte-identical to `serializeRuntimeManifest` of its parsed form. This refuses duplicate keys, which `JSON.parse` would merge silently, and any other spelling. Exact keys at both levels, schema 1, `nodeFloor` in the form `major.minor.patch`, lowercase SHA-256.
- Envelope `{schema: 1, version, files}`. Records are exactly `{path, mode, data}`, so link, directory and other typed records are refused. Paths are strictly ascending, which refuses duplicates. Base64 must be canonical. `runtime.json` is a 0644 record. Every other record is listed with its hash and mode, and every listed file has a record.
- Versions must agree in the descriptor, the envelope, `runtime.json` and `.codex-plugin/plugin.json`. The descriptor's tag must be `squeal--v<its version>` and must equal the tag it was downloaded from.
- Trees on disk: `lstat` walk. Symlinks (to files or directories), hard links (`nlink > 1`) and special files are refused. Unlisted, missing, changed and mode-changed files are refused.
- Bounds, all checked before any write: compressed 64 MiB, inflated 192 MiB (`maxOutputLength`), 2,048 files, 64 MiB per file (also checked on base64 length before decoding), 128 MiB in total. Listing 1 MiB, descriptor 64 KiB. A body is refused by `content-length` before reading, or as soon as streamed bytes cross the bound. Each limit is at least 12 times the 0.1.366 plugin packed as a runtime: 39 files, 10.6 MB decoded, largest file 3.2 MB, envelope 14.1 MB, artifact 3.6 MB, `packRuntime` 483 ms on this host.

## Decisions the contract did not settle

- Required entries include the ten hook entries and the 0755 launcher. The contract names them as runtime contents. Change `REQUIRED_ENTRIES` if packaging drops a hook entry.
- The descriptor has no size field. The SHA-256 and the byte bound catch truncation and oversize.
- The release listing must name both assets. Otherwise `release` "has no Codex runtime assets", and no download starts. Releases before the runtime artifact exist get this error.
- A draft or prerelease that is reported as latest is refused.
- The tag is not checked against the git ref API. The descriptor's `releaseCommit` is the packager's statement, not verified here. Binding rests on the exact-tag URL and the SHA-256. Signatures are out of scope (research `wrapper-install-flow.md`: format undetermined).
- `fetchTransport` follows redirects (GitHub asset downloads redirect to its asset host) and adds no `Authorization`. The anonymous API limit is 60 requests per hour per IP. One update check costs one listing request.
- One deadline covers the whole operation, and the caller's signal is separate. Codes `timeout` and `aborted` tell them apart.
- `stagingDir` is created when it is missing (mode 0700). Nothing is created before the download and in-memory checks pass, so an offline or refused update writes nothing at all.

## Residue for later rows

- Leftover `squeal-runtime-*` directories from a killed process stay in `stagingDir`. The updater should remove them under its lock before staging. This row has no sweep, because only the lock owner knows that no other stage is running.
- W1's store validates published trees with its own code. A later quality pass can make W1 call `validateRuntimeTree`, so that one rule set exists. The rules here are a superset of the contract's list.
- `dist/runtime.mjs` does not exist in any build yet.
- A real GitHub release has not been exercised. The tests rewrite the official URLs to a local HTTP server and assert the exact official URLs requested.
