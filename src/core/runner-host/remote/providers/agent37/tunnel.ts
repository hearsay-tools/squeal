import type { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { apiKeyFor, openEndpoint, proxyFor } from "./net.js";
import {
  encodeFrame,
  FrameDecoder,
  OPCODE,
  upgradeAnswer,
  upgradeRequest,
  webSocketKey,
} from "./websocket.js";

/*
 * Spec 026 D7.3.2, D12.6 (row 026-15): the SSH `ProxyCommand` of an
 * Agent37 machine. SSH reaches an instance only through a WebSocket to
 * `<id>-22022.agent37.app` carrying the workspace key in `X-Agent37-Key`;
 * the vendor's `agent37 tunnel` dials port 443 directly and so ignores
 * `HTTPS_PROXY` (research `agent37-sandboxes.md` Q3). This one goes
 * through the proxy when one applies, then bridges SSH's stdin and stdout
 * to binary frames, honouring backpressure both ways. The key comes only
 * from the environment and is never printed.
 */

/** The tunnel host of an instance when the config names none. */
export const TUNNEL_HOST_TEMPLATE = "{id}-22022.agent37.app";

/** The exit code ssh reads as "the ProxyCommand failed". */
export const TUNNEL_FAILED = 255;

export interface TunnelOptions {
  readonly host: string;
  readonly port: number;
  /** The variable holding the API key (`apiKeyEnv`). */
  readonly keyEnv: string;
  readonly env: NodeJS.ProcessEnv;
  /** SSH's bytes to the instance: the tunnel's stdin. */
  readonly input: Readable;
  /** The instance's bytes to SSH: the tunnel's stdout. */
  readonly output: Writable;
  /** One line of why the tunnel failed, for stderr. */
  readonly fail: (message: string) => void;
  readonly connectMs?: number;
}

/** An instance id as Agent37 makes them: letters and digits, one word of a host name. */
export function validInstanceId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/i.test(id);
}

/** `template` with `{id}` replaced by `id`. */
export function tunnelHost(template: string, id: string): string {
  return template.replaceAll("{id}", id);
}

/**
 * Opens the tunnel and bridges until either side ends. Resolves the exit
 * code: 0 when the stream ended, `TUNNEL_FAILED` when it never opened.
 */
export async function runTunnel(options: TunnelOptions): Promise<number> {
  const { host, port, env } = options;
  let socket: Socket;
  let key: string;
  try {
    const proxied = proxyFor(host, port, env) !== null;
    const apiKey = apiKeyFor(options.keyEnv, proxied, env);
    socket = (await openEndpoint({ host, port, tls: true }, env, options.connectMs ?? 30_000))
      .socket;
    key = webSocketKey();
    socket.write(upgradeRequest(host, "/", key, { "X-Agent37-Key": apiKey }));
  } catch (error) {
    options.fail(`tunnel to ${host}:${port}: ${(error as Error).message}`);
    return TUNNEL_FAILED;
  }
  return bridge(socket, key, options);
}

function bridge(socket: Socket, key: string, options: TunnelOptions): Promise<number> {
  const { input, output, host } = options;
  return new Promise((resolve) => {
    let open = false;
    let ended = false;
    let head: Buffer = Buffer.alloc(0);
    const decoder = new FrameDecoder();
    const finish = (code: number, why?: string) => {
      if (ended) return;
      ended = true;
      if (why !== undefined) options.fail(`tunnel to ${host}: ${why}`);
      input.removeListener("data", send);
      input.destroy();
      socket.destroy();
      resolve(code);
    };
    const send = (chunk: Buffer) => {
      if (!socket.write(encodeFrame(OPCODE.binary, chunk))) input.pause();
    };
    const receive = (bytes: Buffer) => {
      let frames: ReturnType<FrameDecoder["push"]>;
      try {
        frames = decoder.push(bytes);
      } catch (error) {
        finish(TUNNEL_FAILED, (error as Error).message);
        return;
      }
      for (const frame of frames) {
        if (frame.opcode === OPCODE.close) {
          socket.end(encodeFrame(OPCODE.close, frame.payload.subarray(0, 2)));
          finish(0);
          return;
        }
        if (frame.opcode === OPCODE.ping) socket.write(encodeFrame(OPCODE.pong, frame.payload));
        else if (frame.opcode <= OPCODE.binary && frame.payload.length > 0) {
          if (!output.write(frame.payload)) socket.pause();
        }
      }
    };
    output.on("drain", () => socket.resume());
    output.on("error", () => finish(0));
    socket.on("drain", () => input.resume());
    socket.on("error", (error) => finish(open ? 0 : TUNNEL_FAILED, error.message));
    socket.on("close", () =>
      finish(open ? 0 : TUNNEL_FAILED, open ? undefined : "closed during the upgrade"),
    );
    socket.on("data", (chunk: Buffer) => {
      if (open) return receive(chunk);
      head = Buffer.concat([head, chunk]);
      const answer = upgradeAnswer(head, key);
      if (answer === null) {
        if (head.length > 65_536) finish(TUNNEL_FAILED, "no end to the upgrade answer");
        return;
      }
      if ("refused" in answer) return finish(TUNNEL_FAILED, `refused: ${answer.refused}`);
      open = true;
      head = Buffer.alloc(0);
      input.on("data", send);
      input.on("end", () => {
        // SSH closed its side: a normal close, then the server's close ends the bridge.
        socket.end(encodeFrame(OPCODE.close, Buffer.from([0x03, 0xe8])));
      });
      if (answer.rest.length > 0) receive(answer.rest);
    });
  });
}
