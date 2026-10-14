// THROWAWAY research probe: a unix-socket line echo server standing in for the Squeal daemon.
import * as net from "node:net";
import * as fs from "node:fs";
const path = process.argv[2];
try { fs.unlinkSync(path); } catch {}
net.createServer((s) => { let b = ""; s.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\n")) >= 0) { b = b.slice(i + 1); s.write("ok\n"); } }); }).listen(path);
setTimeout(() => process.exit(0), 120000).unref?.();
