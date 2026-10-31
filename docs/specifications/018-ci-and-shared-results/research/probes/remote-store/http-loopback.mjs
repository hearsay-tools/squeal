// Throwaway probe (018-03). Floor cost of a remote lookup over HTTP on
// loopback (no network round trip), from a COPIED store. One process: a
// server holding one worktree's 1,358 keys and their slim rows, and a client
// that asks per key (1 and 8 in flight) and in one batched POST. Also gzip
// sizes of the batched reply. Real RTT is added in the findings by arithmetic.
// Usage: node http-loopback.mjs <copy/store.sqlite>
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const wt = db.prepare(`SELECT worktree_id, COUNT(*) n FROM test_file_keys WHERE key IS NOT NULL
  GROUP BY worktree_id ORDER BY n DESC LIMIT 1`).get();
const keys = db.prepare("SELECT key FROM test_file_keys WHERE worktree_id = ? AND key IS NOT NULL")
  .all(wt.worktree_id).map((r) => r.key);
const q = db.prepare(`SELECT c.kind, c.full_name, r.outcome, r.duration_ms, r.failure_id, r.commit_sha
  FROM results r JOIN checks c ON c.id = r.check_id WHERE r.key = ?`);
const rows = new Map(keys.map((k) => [k, q.all(k).map((x) => [x.kind, x.full_name, x.outcome, x.duration_ms, x.failure_id, x.commit_sha])]));
const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    const k = req.url.slice(3);
    const body = JSON.stringify(rows.get(k) ?? []);
    res.writeHead(rows.has(k) ? 200 : 404, { "content-type": "application/json" }).end(body);
    return;
  }
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const want = JSON.parse(data);
    const body = JSON.stringify(Object.fromEntries(want.filter((k) => rows.has(k)).map((k) => [k, rows.get(k)])));
    res.writeHead(200, { "content-type": "application/json" }).end(body);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const get = (k) => new Promise((ok, no) => http.get({ port, path: `/k/${k}`, agent }, (res) => { res.resume(); res.on("end", ok); }).on("error", no));
const post = (body) => new Promise((ok, no) => {
  const req = http.request({ port, method: "POST", path: "/batch", agent }, (res) => { let n = 0; res.on("data", (c) => (n += c.length)); res.on("end", () => ok(n)); });
  req.on("error", no); req.end(body);
});
const result = { keys: keys.length };
let t = performance.now();
for (const k of keys) await get(k);
result.sequentialGetMs = +(performance.now() - t).toFixed(1);
t = performance.now();
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (i < keys.length) await get(keys[i++]); }));
result.eightInFlightGetMs = +(performance.now() - t).toFixed(1);
const reqBody = JSON.stringify(keys);
t = performance.now();
result.batchReplyBytes = await post(reqBody);
result.batchPostMs = +(performance.now() - t).toFixed(1);
result.batchRequestBytes = reqBody.length;
result.batchReplyGzipBytes = gzipSync(JSON.stringify(Object.fromEntries(rows))).length;
// A reply that only says which keys passed whole (no rows): what a skip/lookup-only decision needs.
const verdicts = Object.fromEntries([...rows].map(([k, r]) => [k, r.every((x) => x[2] !== "fail") ? "pass" : "fail"]));
result.verdictOnlyGzipBytes = gzipSync(JSON.stringify(verdicts)).length;
console.log(JSON.stringify(result, null, 1));
agent.destroy(); server.close();
