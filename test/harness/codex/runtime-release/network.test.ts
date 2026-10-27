import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_LIMITS,
  LATEST_RELEASE_URL,
  prepareRuntimeUpdate,
  type ReleaseTransport,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  type RuntimeReleaseErrorCode,
  releaseAssetUrl,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";
import { put, rejection, snapshot } from "./fixture.js";
import { publish, type ReleaseServer, releaseServer, send, stall, stream } from "./server.js";

/*
 * Row 002-30 (spec 002 D8): one attempt per asset, bounded in time and
 * bytes. Offline, refused, failing, stalled, aborted and oversized answers
 * each end as one typed error, say whether a later retry can succeed, and
 * leave the plugin data directory exactly as it was.
 */

const A = "0.1.900";
const TAG = `squeal--v${A}`;

interface Outcome {
  readonly code: RuntimeReleaseErrorCode;
  readonly transient: boolean;
  readonly status: number | null;
  readonly message: string;
  readonly ms: number;
}

/** Runs one update against `transport` and checks the data directory is untouched. */
async function attempt(
  transport: ReleaseTransport,
  options: { timeoutMs?: number; signal?: AbortSignal; maxArtifactBytes?: number } = {},
): Promise<Outcome> {
  const data = tempDir("squeal-plugin-data-");
  put(data, "runtime/current.json", '{"schema":1,"version":"0.1.899"}\n');
  const stagingDir = join(data, "runtime", "staging");
  const before = snapshot(data);
  const started = Date.now();
  const error = await rejection(
    prepareRuntimeUpdate({
      transport,
      stagingDir,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      limits: {
        ...DEFAULT_RUNTIME_LIMITS,
        maxArtifactBytes: options.maxArtifactBytes ?? DEFAULT_RUNTIME_LIMITS.maxArtifactBytes,
      },
    }),
  );
  expect(snapshot(data)).toEqual(before);
  expect(existsSync(stagingDir)).toBe(false);
  const { code, transient, status, message } = error;
  return { code, transient, status, message, ms: Date.now() - started };
}

async function published(): Promise<ReleaseServer> {
  const server = await releaseServer();
  publish(server, A);
  return server;
}

describe("prepareRuntimeUpdate under network failure", () => {
  it("reports a refused connection as a transient network failure", async () => {
    const server = await releaseServer();
    await server.close();
    const outcome = await attempt(server.transport);
    expect(outcome).toMatchObject({ code: "network", transient: true });
    expect(outcome.message).toContain(`GET ${LATEST_RELEASE_URL} failed`);
    expect(outcome.message).toContain("ECONNREFUSED");
  });

  it("reports a transport that throws as a network failure", async () => {
    const offline: ReleaseTransport = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
    expect(await attempt(offline)).toMatchObject({ code: "network", transient: true });
  });

  it.each([
    [404, false],
    [403, false],
    [429, true],
    [503, true],
  ])("reports HTTP %i on the artifact, transient %s", async (status, transient) => {
    const server = await published();
    server.routes.set(releaseAssetUrl(TAG, RUNTIME_ARTIFACT_ASSET), send("no", status));
    expect(await attempt(server.transport)).toMatchObject({ code: "http", status, transient });
  });

  it("ends a stalled listing, descriptor or artifact at the deadline", async () => {
    for (const url of [
      LATEST_RELEASE_URL,
      releaseAssetUrl(TAG, RUNTIME_DESCRIPTOR_ASSET),
      releaseAssetUrl(TAG, RUNTIME_ARTIFACT_ASSET),
    ]) {
      const server = await published();
      server.routes.set(url, stall());
      const outcome = await attempt(server.transport, { timeoutMs: 300 });
      expect(outcome).toMatchObject({ code: "timeout", transient: true });
      expect(outcome.message).toBe(`GET ${url} timed out`);
      expect(outcome.ms).toBeLessThan(10_000);
    }
  });

  it("ends a transport that ignores the signal at the deadline", async () => {
    const never: ReleaseTransport = () => new Promise(() => undefined);
    const silent: ReleaseTransport = async () => ({
      status: 200,
      headers: { get: () => null },
      body: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) },
    });
    expect(await attempt(never, { timeoutMs: 200 })).toMatchObject({ code: "timeout" });
    expect(await attempt(silent, { timeoutMs: 200 })).toMatchObject({ code: "timeout" });
  });

  it("reports the caller's abort as aborted, not transient", async () => {
    const server = await published();
    server.routes.set(releaseAssetUrl(TAG, RUNTIME_ARTIFACT_ASSET), stall());
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    expect(await attempt(server.transport, { signal: controller.signal })).toMatchObject({
      code: "aborted",
      transient: false,
    });
  });

  it("refuses an artifact over its bound by content-length and while streaming", async () => {
    const server = await published();
    const declared = await attempt(server.transport, { maxArtifactBytes: 100 });
    expect(declared).toMatchObject({ code: "too-large", transient: false });
    expect(declared.message).toContain("bytes, over 100");
    server.requested.length = 0;
    server.routes.set(releaseAssetUrl(TAG, RUNTIME_ARTIFACT_ASSET), stream(4 * 2 ** 20));
    const streamed = await attempt(server.transport, { maxArtifactBytes: 2 ** 20 });
    expect(streamed).toMatchObject({ code: "too-large" });
    expect(streamed.message).toContain(`sent over ${2 ** 20} bytes`);
  });

  it("refuses an oversized descriptor and listing", async () => {
    const server = await published();
    server.routes.set(releaseAssetUrl(TAG, RUNTIME_DESCRIPTOR_ASSET), stream(128 * 1024));
    expect(await attempt(server.transport)).toMatchObject({ code: "too-large" });
    server.routes.set(LATEST_RELEASE_URL, stream(2 * 2 ** 20));
    expect(await attempt(server.transport)).toMatchObject({ code: "too-large" });
  });
});
