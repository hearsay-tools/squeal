import { RuntimeReleaseError } from "./errors.js";
import { isRuntimeVersion } from "./manifest.js";

/*
 * Row 002-30, wave-4-contract.md: each release carries two fixed assets,
 * the artifact and a descriptor naming its runtime version, the release tag
 * and commit it was packed from, the artifact's file name and the SHA-256
 * of its bytes. The commit is the exact release commit packaging is given;
 * it is never baked into a committed bundle. A descriptor is valid only for
 * the tag of its own version, `squeal--v<version>`, the repository's
 * release tag (docs/process.md 6a).
 */

export const RUNTIME_ARTIFACT_ASSET = "squeal-codex-runtime.json.gz";
export const RUNTIME_DESCRIPTOR_ASSET = "squeal-codex-runtime.json";
export const DESCRIPTOR_SCHEMA = 1;

export interface RuntimeReleaseDescriptor {
  readonly schema: 1;
  readonly version: string;
  /** `squeal--v<version>`. */
  readonly releaseTag: string;
  /** The full 40-hex commit the release was packed from. */
  readonly releaseCommit: string;
  /** Always `squeal-codex-runtime.json.gz`. */
  readonly artifact: string;
  /** SHA-256 of the artifact bytes, lowercase hex. */
  readonly sha256: string;
}

const TAG_PREFIX = "squeal--v";
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEYS = ["schema", "version", "releaseTag", "releaseCommit", "artifact", "sha256"] as const;

/** The release tag of `version`. */
export const releaseTagFor = (version: string): string => `${TAG_PREFIX}${version}`;

/** The runtime version a release tag names, or `null` when it is not a Squeal release tag. */
export function versionOfTag(tag: string): string | null {
  if (!tag.startsWith(TAG_PREFIX)) return null;
  const version = tag.slice(TAG_PREFIX.length);
  return isRuntimeVersion(version) ? version : null;
}

const invalid = (message: string): RuntimeReleaseError =>
  new RuntimeReleaseError("descriptor", message);

function check(descriptor: RuntimeReleaseDescriptor): RuntimeReleaseDescriptor {
  if (!isRuntimeVersion(descriptor.version))
    throw invalid(`descriptor has invalid version ${JSON.stringify(descriptor.version)}`);
  if (descriptor.releaseTag !== releaseTagFor(descriptor.version))
    throw invalid(
      `descriptor tag ${descriptor.releaseTag} is not the tag of ${descriptor.version}`,
    );
  if (typeof descriptor.releaseCommit !== "string" || !COMMIT.test(descriptor.releaseCommit))
    throw invalid("descriptor releaseCommit must be a full lowercase commit hash");
  if (descriptor.artifact !== RUNTIME_ARTIFACT_ASSET)
    throw invalid(`descriptor artifact must be ${RUNTIME_ARTIFACT_ASSET}`);
  if (typeof descriptor.sha256 !== "string" || !SHA256.test(descriptor.sha256))
    throw invalid("descriptor sha256 must be lowercase hex");
  return descriptor;
}

export interface CreateReleaseDescriptorOptions {
  readonly version: string;
  /** SHA-256 of the artifact bytes (`packRuntime(...).sha256`). */
  readonly sha256: string;
  /** The exact release commit being packaged. */
  readonly releaseCommit: string;
}

/** The descriptor of an artifact packed at `releaseCommit`; throws on an invalid field. */
export function createReleaseDescriptor(
  options: CreateReleaseDescriptorOptions,
): RuntimeReleaseDescriptor {
  return check({
    schema: DESCRIPTOR_SCHEMA,
    version: options.version,
    releaseTag: releaseTagFor(options.version),
    releaseCommit: options.releaseCommit,
    artifact: RUNTIME_ARTIFACT_ASSET,
    sha256: options.sha256,
  });
}

/** The descriptor asset's text: fixed key order, 2-space JSON. */
export function serializeReleaseDescriptor(descriptor: RuntimeReleaseDescriptor): string {
  const ordered = Object.fromEntries(KEYS.map((key) => [key, descriptor[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Parses a descriptor asset. With `tag`, the release it was downloaded
 * from, the descriptor must name that release: a descriptor copied into
 * another release is refused.
 */
export function parseReleaseDescriptor(text: string, tag?: string): RuntimeReleaseDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid("descriptor is not JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(value, key))
  )
    throw invalid(`descriptor must hold exactly ${KEYS.join(", ")}`);
  const descriptor = value as RuntimeReleaseDescriptor;
  if (descriptor.schema !== DESCRIPTOR_SCHEMA)
    throw invalid(`descriptor has unsupported schema ${JSON.stringify(descriptor.schema)}`);
  check(descriptor);
  if (tag !== undefined && descriptor.releaseTag !== tag)
    throw invalid(`descriptor names release ${descriptor.releaseTag}, downloaded from ${tag}`);
  return descriptor;
}
