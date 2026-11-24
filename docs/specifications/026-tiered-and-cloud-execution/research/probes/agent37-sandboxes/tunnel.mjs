// Throwaway (026 agent37-sandboxes). An ssh ProxyCommand like `agent37 tunnel %h` (agent37
// CLI 0.4.1, src/cli.js runTunnel), but through the HTTPS_PROXY this host must use: CONNECT
// to <id>-22022.agent37.app:443, TLS (trusting NODE_EXTRA_CA_CERTS), WebSocket upgrade with
// an X-Agent37-Key placeholder the proxy replaces on the wire, then binary frames both ways.
//   ProxyCommand node tunnel.mjs %h
// It never reads, prints or stores a credential; the proxy URL is only parsed, never printed.
import { request } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const id = process.argv[2].split(".")[0];
const host = `${id}-22022.agent37.app`;
const proxy = new URL(process.env.HTTPS_PROXY);
const ca = [...rootCertificates];
for (const f of [process.env.NODE_EXTRA_CA_CERTS, process.env.SSL_CERT_FILE]) {
  if (f) try { ca.push(readFileSync(f, "utf8")); } catch {}
}
const fail = (m) => { process.stderr.write(`tunnel: ${m}\n`); process.exit(255); };

function frame(opcode, payload) {
  const mask = randomBytes(4);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, 0x80 | n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

function decode(buf) {
  const frames = [];
  let o = 0;
  while (buf.length - o >= 2) {
    const op = buf[o] & 15;
    let len = buf[o + 1] & 127;
    let p = o + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const masked = buf[o + 1] & 128;
    let mask;
    if (masked) { mask = buf.subarray(p, p + 4); p += 4; }
    if (buf.length - p < len) break;
    let payload = buf.subarray(p, p + len);
    if (masked) payload = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    frames.push({ op, payload });
    o = p + len;
  }
  return { frames, rest: buf.subarray(o) };
}

const auth = proxy.username ? { "Proxy-Authorization": "Basic " + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64") } : {};
const req = request({ host: proxy.hostname, port: proxy.port, method: "CONNECT", path: `${host}:443`, headers: { Host: `${host}:443`, ...auth } });
req.on("error", (e) => fail(`proxy: ${e.message}`));
req.on("connect", (res, raw) => {
  if (res.statusCode !== 200) fail(`proxy CONNECT ${res.statusCode}`);
  const key = randomBytes(16).toString("base64");
  const s = tlsConnect({ socket: raw, servername: host, ca, ALPNProtocols: ["http/1.1"] }, () => {
    s.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nX-Agent37-Key: placeholder\r\n\r\n`);
  });
  s.on("error", (e) => fail(e.message));
  let buf = Buffer.alloc(0);
  let open = false;
  s.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const lines = buf.subarray(0, end).toString("latin1").split("\r\n");
      const accept = lines.find((l) => /^sec-websocket-accept:/i.test(l))?.split(":")[1]?.trim();
      if (!lines[0].startsWith("HTTP/1.1 101") || accept !== createHash("sha1").update(key + GUID).digest("base64")) fail(`refused: ${lines[0]}`);
      open = true;
      buf = buf.subarray(end + 4);
      process.stdin.on("data", (c) => { if (!s.write(frame(2, c))) process.stdin.pause(); });
      s.on("drain", () => process.stdin.resume());
      process.stdin.on("end", () => s.end());
    }
    const d = decode(buf);
    buf = d.rest;
    for (const { op, payload } of d.frames) {
      if (op === 8) { s.destroy(); process.exit(0); }
      if (op === 9) s.write(frame(10, payload));
      else if (op <= 2 && payload.length) process.stdout.write(payload);
    }
  });
  s.on("close", () => process.exit(0));
});
req.end();
