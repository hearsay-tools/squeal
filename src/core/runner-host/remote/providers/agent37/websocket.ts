import { createHash, randomBytes } from "node:crypto";

/*
 * Spec 026 D7.3.2 (row 026-15): the RFC 6455 client side the SSH tunnel
 * needs and nothing more: the upgrade request and its check, masked
 * frames out, and a decoder for the server's frames in, whatever their
 * length form (7-bit, 16-bit or 64-bit) and however TCP splits them.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OPCODE = {
  continuation: 0,
  text: 1,
  binary: 2,
  close: 8,
  ping: 9,
  pong: 10,
} as const;

/** One frame from the server. */
export interface Frame {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
}

/** A fresh `Sec-WebSocket-Key`. */
export function webSocketKey(): string {
  return randomBytes(16).toString("base64");
}

/** The `Sec-WebSocket-Accept` a server answers `key` with. */
export function acceptOf(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/** The upgrade request for `path` on `host`, with `headers` beside the WebSocket ones. */
export function upgradeRequest(
  host: string,
  path: string,
  key: string,
  headers: Readonly<Record<string, string>>,
): string {
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Key: ${key}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/**
 * The server's answer at the head of `buffer`: `null` until its header
 * ended; else the bytes after it, or the reason it refused the upgrade.
 * A reason is fixed text and the 3-digit status, never the reason phrase
 * or a header: a server or a proxy could reflect a credential in them.
 */
export function upgradeAnswer(
  buffer: Buffer,
  key: string,
): null | { readonly rest: Buffer } | { readonly refused: string } {
  const end = buffer.indexOf("\r\n\r\n");
  if (end < 0) return null;
  const lines = buffer.subarray(0, end).toString("latin1").split("\r\n");
  const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines[0] ?? "")?.[1];
  if (status === undefined) return { refused: "not an HTTP response" };
  if (status !== "101") return { refused: `HTTP ${status}` };
  const accept = lines
    .find((line) => /^sec-websocket-accept:/i.test(line))
    ?.slice("sec-websocket-accept:".length)
    .trim();
  if (accept !== acceptOf(key))
    return { refused: "the server's Sec-WebSocket-Accept does not match" };
  return { rest: buffer.subarray(end + 4) };
}

/** A client frame: always final and masked, as RFC 6455 5.3 requires of a client. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length;
  let head: Buffer;
  if (n < 126) head = Buffer.from([0x80 | opcode, 0x80 | n]);
  else if (n < 65_536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) body[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
  return Buffer.concat([head, mask, body]);
}

/** Decodes the server's frames from bytes as they arrive. */
export class FrameDecoder {
  #buffer: Buffer = Buffer.alloc(0);

  /** The frames `chunk` completes; a partial frame waits for the next chunk. */
  push(chunk: Buffer): Frame[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const frames: Frame[] = [];
    let at = 0;
    const buffer = this.#buffer;
    while (buffer.length - at >= 2) {
      const first = buffer[at] ?? 0;
      const second = buffer[at + 1] ?? 0;
      let length = second & 0x7f;
      let p = at + 2;
      if (length === 126) {
        if (buffer.length - p < 2) break;
        length = buffer.readUInt16BE(p);
        p += 2;
      } else if (length === 127) {
        if (buffer.length - p < 8) break;
        const big = buffer.readBigUInt64BE(p);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("a WebSocket frame too long");
        length = Number(big);
        p += 8;
      }
      const masked = (second & 0x80) !== 0;
      const mask = masked ? buffer.subarray(p, p + 4) : null;
      if (masked) p += 4;
      if (buffer.length - p < length) break;
      let payload = buffer.subarray(p, p + length);
      if (mask !== null) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++)
          payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
      }
      frames.push({ fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload });
      at = p + length;
    }
    this.#buffer = at === 0 ? buffer : buffer.subarray(at);
    return frames;
  }
}
