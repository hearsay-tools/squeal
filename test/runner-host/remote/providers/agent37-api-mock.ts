import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import type { Certificates } from "./agent37-servers.js";

/*
 * Spec 026 row 026-15: a local Agent37 control plane as its docs describe
 * it (`instances/*.md`, fetched 2026-11-24), and a fake `ssh` that runs
 * the remote command in a directory of this machine. Nothing reaches the
 * network or the real `~/.ssh`.
 */

export interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface MockApi {
  readonly url: string;
  readonly calls: ApiCall[];
  /** Instances by id: their status. */
  readonly instances: Map<string, string>;
  /** How many `409 try_again` answers the next `start` calls get. */
  tryAgain: number;
  close(): Promise<void>;
}

let next = 0;

type Reply = readonly [status: number, body: unknown];

const NOT_FOUND: Reply = [404, { error: { code: "not_found", message: "No such instance." } }];

/** The mock's answer to `call`, changing its instances as Agent37 would. */
function answer(api: MockApi, call: ApiCall): Reply {
  const { instances } = api;
  if (call.method === "POST" && call.path === "/v1/instances") {
    const id = `mock${String(++next).padStart(6, "0")}`;
    instances.set(id, "running");
    return [201, { id, status: "running", url: `https://${id}.agent37.app` }];
  }
  const match = /^\/v1\/instances\/([a-z0-9]+)(\/(sleep|start))?$/.exec(call.path);
  const id = match?.[1] ?? "";
  const status = instances.get(id);
  if (match === null || status === undefined) return NOT_FOUND;
  const action = match[3];
  if (call.method === "GET" && action === undefined) return [200, { id, status }];
  if (call.method === "DELETE" && action === undefined) {
    instances.delete(id);
    return [200, { id, deleted: true }];
  }
  if (call.method === "POST" && action === "sleep") {
    if (status !== "running" && status !== "sleeping") {
      return [400, { error: { code: "invalid_request", message: `is ${status}` } }];
    }
    instances.set(id, "sleeping");
    return [200, { id, status: "sleeping" }];
  }
  if (call.method === "POST" && action === "start") {
    if (api.tryAgain > 0) {
      api.tryAgain--;
      return [409, { error: { code: "try_again", message: "Retry shortly." } }];
    }
    instances.set(id, "running");
    return [200, { id, status: "running" }];
  }
  return [405, { error: { code: "method_not_allowed", message: "" } }];
}

/** The mock on `127.0.0.1`: plain HTTP, or HTTPS with `certificates`. */
export async function mockAgent37Api(certificates?: Certificates): Promise<MockApi> {
  const sockets = new Set<Socket>();
  const api: MockApi = {
    url: "",
    calls: [],
    instances: new Map(),
    tryAgain: 0,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
  const listener = (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const call: ApiCall = {
        method: request.method ?? "",
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body: text === "" ? undefined : JSON.parse(text),
      };
      api.calls.push(call);
      const [status, reply] = answer(api, call);
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(reply));
    });
  };
  const server =
    certificates === undefined
      ? createHttpServer(listener)
      : createHttpsServer({ key: certificates.key, cert: certificates.cert }, listener);
  server.on("connection", (socket: Socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const host = certificates === undefined ? "127.0.0.1" : "localhost";
  Object.assign(api, { url: `${certificates === undefined ? "http" : "https"}://${host}:${port}` });
  return api;
}

/**
 * A fake `ssh` in `<dir>/bin`: it records its arguments as one JSON line
 * in `<dir>/ssh.jsonl`, skips its options as ssh would take them, and runs
 * the command with `sh -c` in `<dir>/home`, as a login would in its home.
 */
export function fakeSshAt(dir: string): { bin: string; home: string; argv: () => string[][] } {
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  const log = join(dir, "ssh.jsonl");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  const ssh = join(bin, "ssh");
  writeFileSync(
    ssh,
    [
      "#!/bin/sh",
      `${JSON.stringify(process.execPath)} -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\\n")' ${JSON.stringify(log)} "$@"`,
      'while [ $# -gt 0 ]; do case "$1" in -T) shift ;; -o|-i) shift 2 ;; *) break ;; esac; done',
      `cd ${JSON.stringify(home)} && HOME=${JSON.stringify(home)} exec sh -c "$2"`,
      "",
    ].join("\n"),
  );
  chmodSync(ssh, 0o755);
  return {
    bin,
    home,
    argv: () => {
      try {
        return readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as string[]);
      } catch {
        return [];
      }
    },
  };
}
