import type { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { apiKeyFor, openEndpoint, proxyFor, safeReason } from "./net.js";
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
 * from the environment and is never printed, nor is any text the server or
 * a proxy sent, but for a close frame's short reason (row 026-30: a close
 * the server started, or a drop, says why). Every stage has a deadline: opening and the upgrade share
 * `connectMs`, the close handshake after SSH's end has `closeMs`.
 */

/** The tunnel host of an instance when the config names none. */
export const TUNNEL_HOST_TEMPLATE = "{id}-22022.agent37.app";

/** The exit code ssh reads as "the ProxyCommand failed". */
export const TUNNEL_FAILED = 255;

const CONNECT_MS = 30_000;
const CLOSE_MS = 5_000;
/** Status 1000, a normal close. */
const NORMAL_CLOSE = Buffer.from([0x03, 0xe8]);
/** SSH's bytes held before the upgrade beyond which stdin pauses. */
const EARLY_LIMIT = 1 << 20;

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
  /** How long opening the connection and the upgrade's answer may take together. Default 30 s. */
  readonly connectMs?: number;
  /** How long the server may take to close once SSH ended its side. Default 5 s. */
  readonly closeMs?: number;
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
 * SSH's stdin is watched from the start, so stdin ending while the
 * connection opens settles the tunnel at once (0.1.619-r2 S1).
 */
export async function runTunnel(options: TunnelOptions): Promise<number> {
  const { host, port, env } = options;
  const connectMs = options.connectMs ?? CONNECT_MS;
  const deadline = Date.now() + connectMs;
  let apiKey: string;
  try {
    apiKey = apiKeyFor(options.keyEnv, proxyFor(host, port, env) !== null, env);
  } catch (error) {
    options.fail(`tunnel to ${host}:${port}: ${safeReason(error)}`);
    return TUNNEL_FAILED;
  }
  const opening = openEndpoint({ host, port, tls: true }, env, connectMs).then(({ socket }) => {
    const key = webSocketKey();
    socket.write(upgradeRequest(host, "/", key, { "X-Agent37-Key": apiKey }));
    return { socket, key };
  });
  return bridge(opening, options, deadline);
}

const ignore = () => {};

/** The longest close reason a server's close frame gets in the tunnel's line. */
const REASON_CHARS = 120;

/**
 * Row 026-30: why the server closed the WebSocket, from its close frame's
 * payload (RFC 6455 5.5.1): the status code, then the reason with control
 * characters dropped and at most `REASON_CHARS` long, so a reset the edge
 * sent names itself in ssh's stderr. A frame carries no header nor key.
 */
export function closedBy(payload: Buffer): string {
  if (payload.length < 2) return "server closed WebSocket (no status code)";
  const code = payload.readUInt16BE(0);
  const reason = payload
    .subarray(2)
    .toString("utf8")
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, REASON_CHARS)
    .trim();
  return reason === ""
    ? `server closed WebSocket (code ${code})`
    : `server closed WebSocket (code ${code}: ${reason})`;
}

interface Opening {
  readonly socket: Socket;
  readonly key: string;
}

/**
 * Bridges the socket `opening` resolves once the server upgrades it, which
 * it must do before `deadline`. Stdin's end, close or error is observed
 * before the socket exists; a socket that arrives after it is closed.
 */
function bridge(
  opening: Promise<Opening>,
  options: TunnelOptions,
  deadline: number,
): Promise<number> {
  const { input, output, host } = options;
  const closeMs = options.closeMs ?? CLOSE_MS;
  return new Promise((resolve) => {
    let socket: Socket | undefined;
    let key = "";
    let open = false;
    let closing = false;
    let ended = false;
    let head: Buffer = Buffer.alloc(0);
    /** SSH's bytes before the upgrade, sent once it is through. */
    let early: Buffer[] = [];
    let earlyBytes = 0;
    let closeTimer: NodeJS.Timeout | undefined;
    const decoder = new FrameDecoder();
    const removals: (() => void)[] = [];
    const on = <A extends unknown[]>(
      emitter: EventEmitter,
      event: string,
      listener: (...args: A) => void,
    ) => {
      emitter.on(event, listener as (...args: unknown[]) => void);
      removals.push(() => emitter.removeListener(event, listener as (...args: unknown[]) => void));
    };
    const finish = (code: number, why?: string) => {
      if (ended) return;
      ended = true;
      clearTimeout(upgradeTimer);
      clearTimeout(closeTimer);
      for (const remove of removals) remove();
      // A destroyed socket or a closed stdout may still report an error: it changes nothing now.
      socket?.on("error", ignore);
      output.on("error", ignore);
      input.destroy();
      socket?.destroy();
      if (why !== undefined) options.fail(`tunnel to ${host}: ${why}`);
      resolve(code);
    };
    const upgradeTimer = setTimeout(
      () => finish(TUNNEL_FAILED, "no upgrade answer in time"),
      Math.max(0, deadline - Date.now()),
    );
    const send = (chunk: Buffer): boolean => {
      const more = (socket as Socket).write(encodeFrame(OPCODE.binary, chunk));
      if (!more) input.pause();
      return more;
    };
    const fromSsh = (chunk: Buffer) => {
      if (open) {
        send(chunk);
        return;
      }
      early.push(chunk);
      earlyBytes += chunk.length;
      if (earlyBytes > EARLY_LIMIT) input.pause();
    };
    const sshEnded = () => {
      // Before the upgrade there is nothing to close: SSH has gone, and so does the tunnel.
      if (!open || socket === undefined) return finish(0);
      if (closing) return;
      closing = true;
      socket.end(encodeFrame(OPCODE.close, NORMAL_CLOSE));
      closeTimer = setTimeout(() => finish(0), closeMs);
    };
    const receive = (bytes: Buffer) => {
      let frames: ReturnType<FrameDecoder["push"]>;
      try {
        frames = decoder.push(bytes);
      } catch {
        finish(TUNNEL_FAILED, "an undecodable WebSocket frame");
        return;
      }
      for (const frame of frames) {
        if (ended) return;
        const to = socket as Socket;
        if (frame.opcode === OPCODE.close) {
          if (closing) return finish(0);
          to.end(encodeFrame(OPCODE.close, frame.payload.subarray(0, 2)));
          finish(0, closedBy(frame.payload));
          return;
        }
        if (frame.opcode === OPCODE.ping) to.write(encodeFrame(OPCODE.pong, frame.payload));
        else if (frame.opcode <= OPCODE.binary && frame.payload.length > 0) {
          if (!output.write(frame.payload)) to.pause();
        }
      }
    };
    const upgrade = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const answer = upgradeAnswer(head, key);
      if (answer === null) {
        if (head.length > 65_536) finish(TUNNEL_FAILED, "no end to the upgrade answer");
        return;
      }
      if ("refused" in answer) return finish(TUNNEL_FAILED, `refused: ${answer.refused}`);
      clearTimeout(upgradeTimer);
      open = true;
      head = Buffer.alloc(0);
      let more = true;
      for (const chunk of early) more = send(chunk);
      early = [];
      if (more) input.resume();
      if (answer.rest.length > 0) receive(answer.rest);
    };
    const attach = (opened: Opening) => {
      if (ended) {
        // Stdin ended, or the deadline passed, while the connection opened.
        opened.socket.on("error", ignore);
        opened.socket.destroy();
        return;
      }
      socket = opened.socket;
      key = opened.key;
      const to = socket;
      on(output, "drain", () => to.resume());
      on(to, "drain", () => input.resume());
      on(to, "error", (error: Error) => finish(open ? 0 : TUNNEL_FAILED, safeReason(error)));
      on(to, "close", () => {
        if (!open) return finish(TUNNEL_FAILED, "closed during the upgrade");
        // Row 026-30: a drop SSH did not ask for says so; the close SSH's end asked for stays silent.
        finish(0, closing ? undefined : "connection closed by peer");
      });
      on(to, "data", (chunk: Buffer) => (open ? receive(chunk) : upgrade(chunk)));
    };
    on(output, "error", () => finish(0));
    on(input, "data", fromSsh);
    on(input, "end", sshEnded);
    on(input, "close", sshEnded);
    on(input, "error", sshEnded);
    // An end emitted before these listeners existed is read from the stream's state.
    if (input.destroyed || input.readableEnded) sshEnded();
    opening.then(attach, (error: unknown) => {
      if (ended) return;
      ended = true;
      clearTimeout(upgradeTimer);
      for (const remove of removals) remove();
      output.on("error", ignore);
      input.destroy();
      options.fail(`tunnel to ${host}:${options.port}: ${safeReason(error)}`);
      resolve(TUNNEL_FAILED);
    });
  });
}
