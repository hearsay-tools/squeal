// Q3 (throwaway): oxlint's long-lived mode, `oxlint --lsp`, driven as an editor
// would (push diagnostics, run on type). Measures the server's CPU from
// /proc/<pid>/stat (utime + stime + cutime + cstime: tsgolint children it
// waited for count), its RSS, the time to the first diagnostics, and the CPU
// per edit. Then checks what it sees of edits on disk it was not told about.
// Usage: node lsp.mjs <project> <oxlint bin> <file> <edits> <typeAware 0|1> <out.json> [dep file]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [project, ox, rel, editsArg, ta, outFile, depRel] = process.argv.slice(2);
const TICK = 10; // ms per clock tick (CLK_TCK 100)
const child = spawn("nice", ["-n", "10", process.execPath, ox, "--lsp"], { cwd: project, stdio: ["pipe", "pipe", "pipe"], env: process.env });
// `nice` execs node, so child.pid is the server itself.
const serverPid = child.pid;
const cpu = () => {
  const pid = serverPid ?? child.pid;
  const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const f = st.slice(st.lastIndexOf(")") + 2).split(" ");
  return (Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14])) * TICK;
};
const rss = () => { const s = fs.readFileSync(`/proc/${serverPid ?? child.pid}/status`, "utf8"); return { rssMB: Math.round(Number(/VmRSS:\s+(\d+)/.exec(s)[1]) / 1024), hwmMB: Math.round(Number(/VmHWM:\s+(\d+)/.exec(s)[1]) / 1024) }; };

let buf = Buffer.alloc(0);
const waiters = [];
const notes = [];
child.stdout.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const h = buf.indexOf("\r\n\r\n");
    if (h < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.slice(0, h).toString())[1]);
    if (buf.length < h + 4 + len) return;
    const msg = JSON.parse(buf.slice(h + 4, h + 4 + len).toString());
    buf = buf.slice(h + 4 + len);
    if (msg.method === "workspace/configuration") send({ jsonrpc: "2.0", id: msg.id, result: msg.params.items.map(() => ({ run: "onType", typeAware: ta === "1" })) });
    else if (msg.id !== undefined && msg.method) send({ jsonrpc: "2.0", id: msg.id, result: null });
    for (const w of [...waiters]) if (w.test(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  }
});
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));
const send = (m) => { const s = JSON.stringify(m); child.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
const wait = (test, ms = 60000) => new Promise((resolve, reject) => { const w = { test, resolve }; waiters.push(w); setTimeout(() => reject(new Error("timeout")), ms).unref(); });
const uri = pathToFileURL(path.join(project, rel)).href;
const diag = (u) => (m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === u;
const codes = (m) => m.params.diagnostics.map((d) => `${d.code}|${d.message}|${d.range.start.line + 1}`).sort();

const t0 = performance.now();
const rootUri = pathToFileURL(project).href;
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "p" }], capabilities: { workspace: { configuration: true, didChangeWatchedFiles: { dynamicRegistration: true } } }, initializationOptions: [{ workspaceUri: rootUri, options: { run: "onType", typeAware: ta === "1" } }] } });
await wait((m) => m.id === 1);
send({ jsonrpc: "2.0", method: "initialized", params: {} });
const text0 = fs.readFileSync(path.join(project, rel), "utf8");
send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text: text0 } } });
const first = await wait(diag(uri));
const firstMs = Math.round(performance.now() - t0);
const firstCpu = cpu();
const afterFirst = rss();
const edits = [];
for (let i = 0; i < Number(editsArg); i++) {
  const text = i % 2 === 0 ? `${text0}\nconst probeUnused${i} = ${i};\n` : text0;
  const c0 = cpu(); const w0 = performance.now();
  send({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: i + 2 }, contentChanges: [{ text }] } });
  const m = await wait(diag(uri));
  edits.push({ cpuMs: cpu() - c0, wallMs: Math.round(performance.now() - w0), findings: m.params.diagnostics.length, load: os.loadavg()[0] });
}
// What the server sees of a dependency edited on disk without a notice.
let depCheck = null;
if (depRel) {
  const depPath = path.join(project, depRel);
  const before = fs.readFileSync(depPath, "utf8");
  const send1 = async (v, text) => { send({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: v }, contentChanges: [{ text }] } }); return codes(await wait(diag(uri))); };
  const a = await send1(1000, text0);
  fs.writeFileSync(depPath, before.replace(/export const (\w+)/, "export const $1Renamed"));
  const b = await send1(1001, text0 + "\n");
  fs.writeFileSync(depPath, before);
  const c = await send1(1002, text0);
  depCheck = { before: a, afterDepEdit: b, afterRevert: c };
}
// A JS plugin module edited on disk, then a watched-file notice for the root
// config (the server rebuilds its linter on any watched-file event).
// PLUGIN_EDIT="<file>|<from>|<to>|<watched file to announce>".
let pluginCheck = null;
if (process.env.PLUGIN_EDIT) {
  const [file, from, to, watched] = process.env.PLUGIN_EDIT.split("|");
  const fp = path.join(project, file);
  const orig = fs.readFileSync(fp, "utf8");
  const lintNow = async (v) => { send({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: v }, contentChanges: [{ text: text0 + (v % 2 ? "\n" : "") }] } }); return codes(await wait(diag(uri))); };
  const before = await lintNow(2001);
  fs.writeFileSync(fp, orig.replace(from, to));
  const afterEditNoNotice = await lintNow(2002);
  send({ jsonrpc: "2.0", method: "workspace/didChangeWatchedFiles", params: { changes: [{ uri: pathToFileURL(path.join(project, watched)).href, type: 2 }] } });
  await new Promise((r) => setTimeout(r, 1500));
  const afterNotice = await lintNow(2003);
  fs.writeFileSync(fp, orig);
  // A fresh CLI on the edited plugin, for comparison.
  fs.writeFileSync(fp, orig.replace(from, to));
  const { execFileSync } = await import("node:child_process");
  let cli = "";
  try { cli = execFileSync(process.execPath, [ox, "--format", "json", rel], { cwd: project, encoding: "utf8" }); } catch (e) { cli = e.stdout; }
  fs.writeFileSync(fp, orig);
  pluginCheck = { file, from, to, before, afterEditNoNotice, afterNotice, freshCli: JSON.parse(cli).diagnostics.filter((d) => d.filename === rel).map((d) => `${d.code}|${d.message}|${d.labels?.[0]?.span?.line}`).sort() };
}
const end = rss();
send({ jsonrpc: "2.0", id: 9, method: "shutdown" });
await wait((m) => m.id === 9).catch(() => {});
send({ jsonrpc: "2.0", method: "exit" });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = { project, rel, typeAware: ta === "1", firstMs, firstCpuMs: firstCpu, firstFindings: first.params.diagnostics.length, afterFirst, end, editCpuMs: { median: med(edits.map((e) => e.cpuMs)), min: Math.min(...edits.map((e) => e.cpuMs)), max: Math.max(...edits.map((e) => e.cpuMs)) }, editWallMs: { median: med(edits.map((e) => e.wallMs)), min: Math.min(...edits.map((e) => e.wallMs)), max: Math.max(...edits.map((e) => e.wallMs)) }, edits, depCheck, pluginCheck, stderrHead: stderr.slice(0, 400) };
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, edits: undefined }, null, 1));
setTimeout(() => { try { child.kill("SIGKILL"); } catch {} process.exit(0); }, 2000).unref();
