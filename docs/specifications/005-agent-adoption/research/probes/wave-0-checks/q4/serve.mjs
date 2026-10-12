// Throwaway (005-04, question 4): serves this directory's scripts on 127.0.0.1 for the
// curl | sh probes. /cut/<file> sends the first half and then drops the connection.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = new URL(".", import.meta.url).pathname;
createServer((req, res) => {
  const cut = req.url.startsWith("/cut/");
  const name = req.url.replace(/^\/(cut\/)?/, "");
  let body;
  try { body = readFileSync(join(dir, name)); } catch { res.writeHead(404); return res.end("not found\n"); }
  if (!cut) { res.writeHead(200, { "content-type": "text/plain" }); return res.end(body); }
  res.writeHead(200, { "content-type": "text/plain", "content-length": body.length });
  res.write(body.subarray(0, Math.floor(body.length / 2)));
  setTimeout(() => res.socket.destroy(), 200);
}).listen(Number(process.argv[2] ?? 18765), "127.0.0.1");
