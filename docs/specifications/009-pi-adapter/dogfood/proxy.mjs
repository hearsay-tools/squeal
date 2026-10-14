// The model endpoint every dogfood session uses: forwards to cliproxy, adding the key from
// CLIPROXY_API_KEY (Pi holds a placeholder, so neither Pi nor the agent's bash ever sees it),
// and appends each request body to a JSONL log, the record of what reached the model.
// Headers are never logged. Usage: node proxy.mjs <port> <log.jsonl>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, log] = process.argv.slice(2);
const key = process.env.CLIPROXY_API_KEY;
if (!key || !port || !log) throw new Error("usage: CLIPROXY_API_KEY=… node proxy.mjs <port> <log>");
delete process.env.CLIPROXY_API_KEY;
const UPSTREAM = "https://cliproxy.home.jarka.pl";
let n = 0;

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const id = ++n;
  const started = Date.now();
  let parsed = null;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {}
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!["host", "authorization", "content-length", "connection"].includes(k)) headers[k] = v;
  }
  headers.authorization = `Bearer ${key}`;
  try {
    const up = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers,
      body: req.method === "GET" ? undefined : body,
    });
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" });
    let text = "";
    if (up.body) {
      for await (const c of up.body) {
        res.write(c);
        if (text.length < 200_000) text += Buffer.from(c).toString("utf8");
      }
    }
    res.end();
    appendFileSync(log, JSON.stringify({ n: id, at: new Date(started).toISOString(), ms: Date.now() - started, path: req.url, status: up.status, request: parsed, response: text.length < 200_000 ? text : null }) + "\n");
  } catch (e) {
    appendFileSync(log, JSON.stringify({ n: id, at: new Date(started).toISOString(), path: req.url, error: String(e) }) + "\n");
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
}).listen(Number(port), "127.0.0.1");
