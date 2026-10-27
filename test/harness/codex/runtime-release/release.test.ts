import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createReleaseDescriptor,
  LATEST_RELEASE_URL,
  prepareRuntimeUpdate,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  releaseAssetUrl,
  resolveRuntimeRelease,
  serializeReleaseDescriptor,
  validateRuntimeTree,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";
import { put, rejection, snapshot } from "./fixture.js";
import { COMMIT, listing, publish, releaseServer, send } from "./server.js";

/*
 * Row 002-30 (spec 002 D8): the latest release is resolved once and every
 * download is bound to its tag; the staged root is complete and validated,
 * and nothing outside the staging directory changes. A descriptor from
 * another release or an artifact that does not match it is refused.
 */

const A = "0.1.900";
const B = "0.1.901";

/** A plugin data directory holding a retained version and a current selection. */
function dataDir(): { data: string; stagingDir: string } {
  const data = tempDir("squeal-plugin-data-");
  put(data, "versions/0.1.899/runtime.json", "{}\n");
  put(data, "runtime/current.json", '{"schema":1,"version":"0.1.899"}\n');
  return { data, stagingDir: join(data, "runtime", "staging") };
}

describe("prepareRuntimeUpdate", () => {
  it("stages the latest release from its exact tag and changes nothing else", async () => {
    const server = await releaseServer();
    const { tag, sha256 } = publish(server, A);
    const { data, stagingDir } = dataDir();
    const before = snapshot(data);

    const prepared = await prepareRuntimeUpdate({ transport: server.transport, stagingDir });
    expect(server.requested).toEqual([
      LATEST_RELEASE_URL,
      `https://github.com/hearsay-tools/squeal/releases/download/squeal--v${A}/${RUNTIME_DESCRIPTOR_ASSET}`,
      `https://github.com/hearsay-tools/squeal/releases/download/squeal--v${A}/${RUNTIME_ARTIFACT_ASSET}`,
    ]);
    expect({ ...prepared, root: undefined, cleanup: undefined }).toEqual({
      root: undefined,
      cleanup: undefined,
      version: A,
      releaseTag: tag,
      releaseCommit: COMMIT,
      sha256,
    });
    expect(prepared.root.startsWith(`${stagingDir}/`)).toBe(true);
    expect(validateRuntimeTree(prepared.root, { expectedVersion: A }).version).toBe(A);
    const outside = new Map(
      [...snapshot(data)].filter(([path]) => !path.startsWith("runtime/staging/")),
    );
    expect(outside).toEqual(before);

    prepared.cleanup();
    expect(snapshot(data)).toEqual(before);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it("keeps every download on the resolved tag when latest moves meanwhile", async () => {
    const server = await releaseServer();
    publish(server, A);
    publish(server, B, false);
    const latestA = server.routes.get(LATEST_RELEASE_URL);
    server.routes.set(LATEST_RELEASE_URL, (request, response) => {
      latestA?.(request, response);
      server.routes.set(LATEST_RELEASE_URL, send(listing(`squeal--v${B}`)));
    });
    const prepared = await prepareRuntimeUpdate({
      transport: server.transport,
      stagingDir: dataDir().stagingDir,
    });
    expect(prepared.version).toBe(A);
    expect(server.requested.filter((url) => url === LATEST_RELEASE_URL)).toHaveLength(1);
    expect(server.requested.slice(1).every((url) => url.includes(`/download/squeal--v${A}/`))).toBe(
      true,
    );
  });

  it("resolves a release without downloading its artifact, then prepares that release", async () => {
    const server = await releaseServer();
    publish(server, A);
    const release = await resolveRuntimeRelease({ transport: server.transport });
    expect(release.tag).toBe(`squeal--v${A}`);
    expect(release.descriptor.version).toBe(A);
    expect(server.requested).toHaveLength(2);
    publish(server, B);
    const prepared = await prepareRuntimeUpdate({
      transport: server.transport,
      release,
      stagingDir: dataDir().stagingDir,
    });
    expect(prepared.version).toBe(A);
    expect(server.requested.slice(2)).toEqual([
      releaseAssetUrl(release.tag, RUNTIME_ARTIFACT_ASSET),
    ]);
  });

  it("prepares an exact tag without asking for the latest release", async () => {
    const server = await releaseServer();
    publish(server, A);
    publish(server, B);
    const prepared = await prepareRuntimeUpdate({
      transport: server.transport,
      tag: `squeal--v${A}`,
      stagingDir: dataDir().stagingDir,
    });
    expect(prepared.version).toBe(A);
    expect(server.requested).not.toContain(LATEST_RELEASE_URL);
  });

  it.each([
    ["an unsafe tag", { tag: "squeal--v0.1.900/../../x" }, "release", "not a Squeal release tag"],
    ["a foreign tag", { tag: "v1.0.0" }, "release", "not a Squeal release tag"],
  ])("refuses %s before any request", async (_name, extra, code, text) => {
    const server = await releaseServer();
    const { stagingDir } = dataDir();
    const error = await rejection(
      prepareRuntimeUpdate({ transport: server.transport, stagingDir, ...extra }),
    );
    expect({ code: error.code, message: error.message }).toEqual({
      code,
      message: expect.stringContaining(text),
    });
    expect(server.requested).toEqual([]);
    expect(existsSync(stagingDir)).toBe(false);
  });
});

describe("prepareRuntimeUpdate refuses a release that does not hold together", () => {
  async function refused(setup: (server: Awaited<ReturnType<typeof releaseServer>>) => void) {
    const server = await releaseServer();
    setup(server);
    const { data, stagingDir } = dataDir();
    const before = snapshot(data);
    const error = await rejection(
      prepareRuntimeUpdate({ transport: server.transport, stagingDir }),
    );
    expect(snapshot(data)).toEqual(before);
    expect(existsSync(stagingDir)).toBe(false);
    return { error, requested: server.requested };
  }

  it("a latest release without runtime assets, before downloading anything", async () => {
    const { error, requested } = await refused((server) => {
      server.routes.set(LATEST_RELEASE_URL, send(listing(`squeal--v${A}`, ["install.sh"])));
    });
    expect([error.code, error.message]).toEqual([
      "release",
      `release squeal--v${A} has no Codex runtime assets`,
    ]);
    expect(requested).toEqual([LATEST_RELEASE_URL]);
  });

  it("a draft, a malformed listing and a listing that is not JSON", async () => {
    const draft = await refused((server) => {
      const text = JSON.parse(listing(`squeal--v${A}`));
      server.routes.set(LATEST_RELEASE_URL, send(JSON.stringify({ ...text, draft: true })));
    });
    expect(draft.error.message).toContain("draft or prerelease");
    const nameless = await refused((server) => server.routes.set(LATEST_RELEASE_URL, send("{}")));
    expect(nameless.error.code).toBe("release");
    const html = await refused((server) => server.routes.set(LATEST_RELEASE_URL, send("<html>")));
    expect(html.error.message).toContain("did not answer JSON");
  });

  it("a descriptor copied from another release", async () => {
    const { error } = await refused((server) => {
      const b = publish(server, B, false);
      publish(server, A);
      const copied = createReleaseDescriptor({
        version: B,
        sha256: b.sha256,
        releaseCommit: COMMIT,
      });
      server.routes.set(
        releaseAssetUrl(`squeal--v${A}`, RUNTIME_DESCRIPTOR_ASSET),
        send(serializeReleaseDescriptor(copied)),
      );
      server.routes.set(releaseAssetUrl(`squeal--v${A}`, RUNTIME_ARTIFACT_ASSET), send(b.artifact));
    });
    expect([error.code, error.message]).toEqual([
      "descriptor",
      `descriptor names release squeal--v${B}, downloaded from squeal--v${A}`,
    ]);
  });

  it("an artifact replaced after its descriptor was published", async () => {
    const { error } = await refused((server) => {
      const b = publish(server, B, false);
      publish(server, A);
      server.routes.set(releaseAssetUrl(`squeal--v${A}`, RUNTIME_ARTIFACT_ASSET), send(b.artifact));
    });
    expect(error.code).toBe("integrity");
  });

  it("a descriptor whose artifact holds another version", async () => {
    const { error } = await refused((server) => {
      const b = publish(server, B, false);
      publish(server, A);
      const lying = createReleaseDescriptor({
        version: A,
        sha256: b.sha256,
        releaseCommit: COMMIT,
      });
      server.routes.set(
        releaseAssetUrl(`squeal--v${A}`, RUNTIME_DESCRIPTOR_ASSET),
        send(serializeReleaseDescriptor(lying)),
      );
      server.routes.set(releaseAssetUrl(`squeal--v${A}`, RUNTIME_ARTIFACT_ASSET), send(b.artifact));
    });
    expect([error.code, error.message]).toEqual([
      "runtime",
      `artifact holds runtime ${B}, expected ${A}`,
    ]);
  });
});
