/*
 * Row 002-30 (spec 002 D8, wave-4-contract.md): the Codex runtime release
 * artifact, its validation and its staging. Packaging creates the manifest
 * and packs the artifact; the updater stages a release and hands the root to
 * publication. Nothing here selects or publishes a live runtime.
 */

export {
  ARTIFACT_SCHEMA,
  DEFAULT_RUNTIME_LIMITS,
  type DecodedRuntime,
  type DecodeRuntimeOptions,
  decodeRuntimeArtifact,
  type PackedRuntime,
  packRuntime,
  type RuntimeArtifactLimits,
  type RuntimeFile,
} from "./artifact.js";
export {
  type CreateReleaseDescriptorOptions,
  createReleaseDescriptor,
  DESCRIPTOR_SCHEMA,
  parseReleaseDescriptor,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  type RuntimeReleaseDescriptor,
  releaseTagFor,
  serializeReleaseDescriptor,
  versionOfTag,
} from "./descriptor.js";
export { RuntimeReleaseError, type RuntimeReleaseErrorCode } from "./errors.js";
export {
  checkRuntimePath,
  HOOK_ENTRIES,
  isRuntimeVersion,
  LAUNCHER,
  PLUGIN_MANIFEST,
  parseRuntimeManifest,
  REQUIRED_ENTRIES,
  RUNTIME_MANIFEST,
  RUNTIME_MODES,
  RUNTIME_SCHEMA,
  type RuntimeFileEntry,
  type RuntimeManifest,
  serializeRuntimeManifest,
} from "./manifest.js";
export {
  DEFAULT_RELEASE_TIMEOUT_MS,
  LATEST_RELEASE_URL,
  type PreparedRuntimeUpdate,
  type PrepareRuntimeUpdateOptions,
  prepareRuntimeUpdate,
  RELEASE_REPOSITORY,
  type ReleaseFetchOptions,
  type ResolveRuntimeReleaseOptions,
  type RuntimeRelease,
  releaseAssetUrl,
  resolveRuntimeRelease,
} from "./release.js";
export {
  type StagedRuntime,
  type StageRuntimeArtifactOptions,
  stageRuntimeArtifact,
} from "./stage.js";
export {
  fetchTransport,
  type ReleaseRequest,
  type ReleaseResponse,
  type ReleaseTransport,
} from "./transport.js";
export {
  type CreateRuntimeManifestOptions,
  createRuntimeManifest,
  type ValidateRuntimeTreeOptions,
  validateRuntimeTree,
} from "./tree.js";
