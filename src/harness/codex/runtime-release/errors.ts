/*
 * Row 002-30 (spec 002 D8): every refusal of a runtime release is one typed
 * error. `code` names the step that refused; `transient` says whether the
 * same request can succeed later unchanged, which the updater's retry delay
 * (a later row) reads. Context (URL, tag, path) is in the message.
 */

export type RuntimeReleaseErrorCode =
  /** The transport failed: refused connection, DNS, reset. */
  | "network"
  /** The operation's deadline passed. */
  | "timeout"
  /** The caller's signal aborted the operation. */
  | "aborted"
  /** A response had a status other than 2xx. */
  | "http"
  /** A response, the artifact, its decompressed envelope or a file is over its bound. */
  | "too-large"
  /** The release listing is malformed or lacks the runtime assets. */
  | "release"
  /** The release descriptor is malformed or names another release. */
  | "descriptor"
  /** The artifact bytes do not match the descriptor's SHA-256. */
  | "integrity"
  /** The artifact is not a well-formed envelope (gzip, JSON, records). */
  | "artifact"
  /** The runtime inside is invalid: manifest, paths, modes, hashes, entries, version. */
  | "runtime"
  /** The runtime needs a newer Node than the one running. */
  | "node"
  /** Writing the staging directory failed. */
  | "staging";

const TRANSIENT: ReadonlySet<RuntimeReleaseErrorCode> = new Set(["network", "timeout", "staging"]);

export class RuntimeReleaseError extends Error {
  override readonly name = "RuntimeReleaseError";
  readonly code: RuntimeReleaseErrorCode;
  /** The HTTP status of an `http` error, otherwise `null`. */
  readonly status: number | null;

  constructor(code: RuntimeReleaseErrorCode, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
  }

  /**
   * True when retrying later can succeed: network, timeout, staging I/O,
   * and HTTP 408, 429 and 5xx. False for a release that is wrong, too large
   * or needs a newer Node, and for the caller's own abort.
   */
  get transient(): boolean {
    if (this.code === "http")
      return this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500;
    return TRANSIENT.has(this.code);
  }
}
