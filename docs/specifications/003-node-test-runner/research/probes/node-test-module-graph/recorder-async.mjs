// THROWAWAY probe. Observed graph through module.register (async hooks, off-thread).
// Edges are posted to the main thread over a MessagePort and written on exit.
import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";
import { writeFileSync, mkdirSync } from "node:fs";
const edges = [], loaded = [];
const { port1, port2 } = new MessageChannel();
port1.on("message", (m) => (m[0] === "e" ? edges.push(m.slice(1)) : loaded.push(m[1])));
port1.unref();
register("./recorder-async-hooks.mjs", { parentURL: import.meta.url, data: { port: port2 }, transferList: [port2] });
process.on("exit", () => {
  const dir = process.env.RECORD_DIR; if (!dir) return;
  // drain anything already delivered; messages still in flight are lost (that is the point of the probe)
  let m; while ((m = require_receive())) (m[0] === "e" ? edges.push(m.slice(1)) : loaded.push(m[1]));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${process.pid}.json`, JSON.stringify({ pid: process.pid, argv: process.argv, edges, loaded, failed: [] }));
});
import { receiveMessageOnPort } from "node:worker_threads";
function require_receive() { return receiveMessageOnPort(port1)?.message; }
