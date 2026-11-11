// Throwaway (021-01). Can a Squeal result travel through unchanged remote-cache servers?
// node protocols.mjs <bazel-remote port, AC validation on> <turborepo-remote-cache port> <turbo token> <data dir>
import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
const [bazelPort, turboPort, token, dir] = process.argv.slice(2);
const rows = readFileSync(`${dir}/import.ndjson`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const key = rows[0].key; // a Squeal check key: sha256 hex of one test file's content and environment
const file = rows.filter((r) => r.key === key).map(({ key: _k, ...r }) => r);
const json = Buffer.from(JSON.stringify({ format: "squeal-results/1", source: "ci run 1 at abc123", results: file }));
// Minimal protobuf encoding of build.bazel.remote.execution.v2.ActionResult:
// exit_code (4, varint), stdout_raw (5, bytes), execution_metadata (9) { worker (1, string) }.
const varint = (n) => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return Buffer.from(b); };
const field = (no, wire, payload) => Buffer.concat([varint((no << 3) | wire), wire === 2 ? Buffer.concat([varint(payload.length), payload]) : varint(payload)]);
const failed = file.some((r) => r.outcome === "fail");
const worker = Buffer.from("squeal ci record, run 1, commit abc123, node v26.13.0");
const actionResult = Buffer.concat([field(4, 0, failed ? 1 : 0), field(5, 2, json), field(9, 2, field(1, 2, worker))]);
const res = async (r) => `${r.status} ${(await r.arrayBuffer()).byteLength} B`;

console.log(`one file: ${file.length} results, ${json.length} B JSON, ActionResult ${actionResult.length} B`);
const b = `http://127.0.0.1:${bazelPort}`;
console.log("bazel-remote PUT /ac raw JSON (validation on):", await res(await fetch(`${b}/ac/${key}`, { method: "PUT", body: json })));
console.log("bazel-remote PUT /ac ActionResult:", await res(await fetch(`${b}/ac/${key}`, { method: "PUT", body: actionResult })));
const got = Buffer.from(await (await fetch(`${b}/ac/${key}`)).arrayBuffer());
console.log("bazel-remote GET /ac:", got.length, "B; same bytes:", got.equals(actionResult), "; holds the results JSON unchanged:", got.includes(json), "; holds the worker text:", got.includes(worker));
const ar2 = Buffer.concat([field(4, 0, 1), field(5, 2, Buffer.from("{}")), field(9, 2, field(1, 2, Buffer.from("a pull request")))]);
console.log("bazel-remote second PUT, other content:", await res(await fetch(`${b}/ac/${key}`, { method: "PUT", body: ar2 })),
  "-> GET now returns the second:", Buffer.from(await (await fetch(`${b}/ac/${key}`)).arrayBuffer()).equals(ar2));
console.log("bazel-remote GET /ac miss:", await res(await fetch(`${b}/ac/${"0".repeat(64)}`)));

const t = `http://127.0.0.1:${turboPort}/v8/artifacts`;
const q = "?teamId=squeal";
const auth = { authorization: `Bearer ${token}` };
const body = gzipSync(json);
console.log("turbo PUT artifact:", await res(await fetch(`${t}/${key}${q}`, { method: "PUT", headers: { ...auth, "content-type": "application/octet-stream", "x-artifact-duration": "1234", "x-artifact-tag": "sig" }, body })));
const g = await fetch(`${t}/${key}${q}`, { headers: auth });
const gb = Buffer.from(await g.arrayBuffer());
console.log("turbo GET artifact:", g.status, "duration header", g.headers.get("x-artifact-duration"), "tag", g.headers.get("x-artifact-tag"), "body round trip", gunzipSync(gb).equals(json));
console.log("turbo second PUT, other content:", await res(await fetch(`${t}/${key}${q}`, { method: "PUT", headers: { ...auth, "content-type": "application/octet-stream" }, body: gzipSync("{}") })),
  "-> GET returns the second:", gunzipSync(Buffer.from(await (await fetch(`${t}/${key}${q}`, { headers: auth })).arrayBuffer())).toString() === "{}");
console.log("turbo POST /v8/artifacts (batch query):", await res(await fetch(t + q, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ hashes: [key, "0".repeat(64)] }) })));
console.log("turbo GET without token:", await res(await fetch(`${t}/${key}${q}`)));
