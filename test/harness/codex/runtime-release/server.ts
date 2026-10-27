import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";
import {
  createReleaseDescriptor,
  fetchTransport,
  LATEST_RELEASE_URL,
  packRuntime,
  type ReleaseTransport,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  releaseAssetUrl,
  releaseTagFor,
  serializeReleaseDescriptor,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { runtimeTree } from "./fixture.js";

/*
 * Row 002-30: a local HTTP server that answers the official release URLs.
 * The transport rewrites `https://<host>/<path>` to `http://127.0.0.1:<port>/
 * <host>/<path>` and records the official URL, so tests see exactly what
 * production would request while nothing leaves the host.
 */

export type Handler = (request: IncomingMessage, response: ServerResponse) => void;

export interface ReleaseServer {
  /** Official URLs requested, in order. */
  readonly requested: string[];
  /** Answers keyed by official URL; a missing key answers 404. */
  readonly routes: Map<string, Handler>;
  readonly transport: ReleaseTransport;
  /** The port, for a test that needs a refused connection after `close`. */
  readonly port: number;
  close(): Promise<void>;
}

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

export const send =
  (body: Buffer | string, status = 200): Handler =>
  (_request, response) => {
    response.writeHead(status, { "content-length": Buffer.byteLength(body) });
    response.end(body);
  };

/** Sends the head and `first` bytes of a body, then nothing more. */
export const stall =
  (first = "{"): Handler =>
  (_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(first);
  };

/** Streams `total` bytes in 64 KiB chunks with no `content-length`. */
export const stream =
  (total: number): Handler =>
  (_request, response) => {
    response.writeHead(200, { "transfer-encoding": "chunked" });
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let sent = 0;
    const pump = (): void => {
      while (sent < total) {
        sent += chunk.byteLength;
        if (!response.write(chunk)) return void response.once("drain", pump);
      }
      response.end();
    };
    pump();
  };

export async function releaseServer(): Promise<ReleaseServer> {
  const routes = new Map<string, Handler>();
  const requested: string[] = [];
  const server = createServer((request, response) => {
    const official = `https:/${request.url ?? "/"}`;
    (routes.get(official) ?? send("not found", 404))(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const transport: ReleaseTransport = (url, request) => {
    requested.push(url);
    return fetchTransport(url.replace(/^https:\//, `http://127.0.0.1:${port}`), request);
  };
  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return { requested, routes, transport, port, close };
}

/** The release listing GitHub's latest-release endpoint answers. */
export function listing(tag: string, assets = [RUNTIME_DESCRIPTOR_ASSET, RUNTIME_ARTIFACT_ASSET]) {
  return JSON.stringify({
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: assets.map((name) => ({ name, size: 1 })),
  });
}

export interface Published {
  readonly tag: string;
  readonly artifact: Buffer;
  readonly sha256: string;
}

/** Serves `version`'s descriptor and artifact under its tag; `latest` also lists it as latest. */
export function publish(server: ReleaseServer, version: string, latest = true): Published {
  const tag = releaseTagFor(version);
  const packed = packRuntime(runtimeTree(version));
  const descriptor = createReleaseDescriptor({
    version,
    sha256: packed.sha256,
    releaseCommit: COMMIT,
  });
  server.routes.set(
    releaseAssetUrl(tag, RUNTIME_DESCRIPTOR_ASSET),
    send(serializeReleaseDescriptor(descriptor)),
  );
  server.routes.set(releaseAssetUrl(tag, RUNTIME_ARTIFACT_ASSET), send(packed.artifact));
  if (latest) server.routes.set(LATEST_RELEASE_URL, send(listing(tag)));
  return { tag, artifact: packed.artifact, sha256: packed.sha256 };
}
