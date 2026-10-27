import { DEFAULT_RUNTIME_LIMITS, type RuntimeArtifactLimits } from "./artifact.js";
import {
  parseReleaseDescriptor,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  type RuntimeReleaseDescriptor,
  versionOfTag,
} from "./descriptor.js";
import { RuntimeReleaseError } from "./errors.js";
import { stageRuntimeArtifact } from "./stage.js";
import {
  type Deadline,
  deadlineOf,
  fetchTransport,
  getBounded,
  type ReleaseTransport,
} from "./transport.js";

/*
 * Row 002-30 (spec 002 D8): official discovery reads hearsay-tools/squeal's
 * latest GitHub release once, then binds every download to that release's
 * tag, `releases/download/<tag>/<asset>`, never to a mutable `latest` URL.
 * The descriptor must name the same tag, and the artifact must match its
 * SHA-256, version, manifest and every file before it is staged. The
 * endpoint is fixed: only an injected transport reaches anything else.
 */

export const RELEASE_REPOSITORY = "hearsay-tools/squeal";
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;

/** The immutable download URL of `asset` in the release tagged `tag`. */
export const releaseAssetUrl = (tag: string, asset: string): string =>
  `https://github.com/${RELEASE_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${asset}`;

/** One whole operation, from the first request to the staged root. */
export const DEFAULT_RELEASE_TIMEOUT_MS = 120_000;
const MAX_LISTING_BYTES = 2 ** 20;
const MAX_DESCRIPTOR_BYTES = 64 * 1024;
const USER_AGENT = "squeal-codex-runtime";
const API_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": USER_AGENT,
};
const ASSET_HEADERS = { accept: "application/octet-stream", "user-agent": USER_AGENT };

/** A release resolved to its exact tag and validated descriptor. */
export interface RuntimeRelease {
  readonly tag: string;
  readonly descriptor: RuntimeReleaseDescriptor;
}

export interface ReleaseFetchOptions {
  /** `fetchTransport` by default; tests inject a local one. */
  readonly transport?: ReleaseTransport;
  /** The caller's cancellation, reported as `aborted`. */
  readonly signal?: AbortSignal;
  /** The bound on the whole operation, reported as `timeout`. */
  readonly timeoutMs?: number;
}

export interface ResolveRuntimeReleaseOptions extends ReleaseFetchOptions {
  /** An exact release tag; without it the latest release is resolved once. */
  readonly tag?: string;
}

const releaseError = (message: string): RuntimeReleaseError =>
  new RuntimeReleaseError("release", message);

function checkTag(tag: unknown): string {
  if (typeof tag !== "string" || versionOfTag(tag) === null)
    throw releaseError(`${JSON.stringify(tag)} is not a Squeal release tag`);
  return tag;
}

/** The tag of the latest release, which must list both runtime assets. */
async function latestTag(transport: ReleaseTransport, time: Deadline): Promise<string> {
  const body = await getBounded(transport, LATEST_RELEASE_URL, {
    headers: API_HEADERS,
    maxBytes: MAX_LISTING_BYTES,
    time,
  });
  let listing: { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  try {
    listing = JSON.parse(body.toString("utf8"));
  } catch {
    throw releaseError(`${LATEST_RELEASE_URL} did not answer JSON`);
  }
  const tag = checkTag(listing?.tag_name);
  if (listing.draft === true || listing.prerelease === true)
    throw releaseError(`latest release ${tag} is a draft or prerelease`);
  const names = Array.isArray(listing.assets)
    ? listing.assets.map((asset: { name?: unknown }) => asset?.name)
    : [];
  if (!names.includes(RUNTIME_ARTIFACT_ASSET) || !names.includes(RUNTIME_DESCRIPTOR_ASSET))
    throw releaseError(`release ${tag} has no Codex runtime assets`);
  return tag;
}

async function resolveWithin(
  transport: ReleaseTransport,
  time: Deadline,
  tag: string | undefined,
): Promise<RuntimeRelease> {
  const exact = tag === undefined ? await latestTag(transport, time) : checkTag(tag);
  const body = await getBounded(transport, releaseAssetUrl(exact, RUNTIME_DESCRIPTOR_ASSET), {
    headers: ASSET_HEADERS,
    maxBytes: MAX_DESCRIPTOR_BYTES,
    time,
  });
  return { tag: exact, descriptor: parseReleaseDescriptor(body.toString("utf8"), exact) };
}

/**
 * Resolves the latest release (one listing request) or `tag`, and reads its
 * descriptor from that exact release. Downloads no artifact, so the updater
 * can compare versions first. Writes nothing.
 */
export function resolveRuntimeRelease(
  options: ResolveRuntimeReleaseOptions = {},
): Promise<RuntimeRelease> {
  const time = deadlineOf(options.timeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS, options.signal);
  return resolveWithin(options.transport ?? fetchTransport, time, options.tag);
}

export interface PrepareRuntimeUpdateOptions extends ResolveRuntimeReleaseOptions {
  /** A release `resolveRuntimeRelease` returned; skips resolving again. */
  readonly release?: RuntimeRelease;
  /** The parent of the private staging directory (`stageRuntimeArtifact`). */
  readonly stagingDir: string;
  readonly limits?: RuntimeArtifactLimits;
  /** The running Node, `process.versions.node` by default. */
  readonly nodeVersion?: string;
}

export interface PreparedRuntimeUpdate {
  /** The staged, validated runtime root, ready for publication; not live. */
  readonly root: string;
  readonly version: string;
  readonly releaseTag: string;
  readonly releaseCommit: string;
  /** SHA-256 of the artifact bytes. */
  readonly sha256: string;
  /** Removes the staging directory; call it after publication or on giving up. */
  readonly cleanup: () => void;
}

/**
 * Resolves a release (unless `release` is given), downloads its artifact
 * from that exact tag, and stages it (`stageRuntimeArtifact`). It changes no
 * current selection, pin, install directory or user config. Any failure
 * throws a `RuntimeReleaseError` and leaves no staging directory; a network
 * failure writes nothing at all.
 */
export async function prepareRuntimeUpdate(
  options: PrepareRuntimeUpdateOptions,
): Promise<PreparedRuntimeUpdate> {
  const transport = options.transport ?? fetchTransport;
  const time = deadlineOf(options.timeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS, options.signal);
  const limits = options.limits ?? DEFAULT_RUNTIME_LIMITS;
  const { tag, descriptor } =
    options.release ?? (await resolveWithin(transport, time, options.tag));
  if (descriptor.releaseTag !== tag)
    throw new RuntimeReleaseError(
      "descriptor",
      `descriptor names ${descriptor.releaseTag}, not ${tag}`,
    );
  const artifact = await getBounded(transport, releaseAssetUrl(tag, RUNTIME_ARTIFACT_ASSET), {
    headers: ASSET_HEADERS,
    maxBytes: limits.maxArtifactBytes,
    time,
  });
  if (time.caller?.aborted)
    throw new RuntimeReleaseError("aborted", `update to ${tag} was aborted`);
  const staged = stageRuntimeArtifact({
    artifact,
    sha256: descriptor.sha256,
    expectedVersion: descriptor.version,
    stagingDir: options.stagingDir,
    limits,
    ...(options.nodeVersion === undefined ? {} : { nodeVersion: options.nodeVersion }),
  });
  return {
    root: staged.root,
    version: staged.version,
    releaseTag: tag,
    releaseCommit: descriptor.releaseCommit,
    sha256: staged.sha256,
    cleanup: staged.cleanup,
  };
}
