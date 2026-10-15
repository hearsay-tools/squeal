// Thirteen daemons' heartbeats, each every 5 s, staggered, on their own connection (task 001-414).
import { join } from "node:path";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/index.js";
const [dir, seconds = "25", n = "13"] = process.argv.slice(2);
const store = openStore(join(dir!, ".git"), { busyTimeoutMs: 5_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const ids = store.worktrees.list().map((w) => w.id).slice(0, Number(n));
for (const id of ids) store.worktrees.setDaemon(id, { socketPath: `/tmp/none-${id}.sock`, startedAt: Date.now(), heartbeatAt: Date.now(), heartbeatIntervalMs: 5000, squealVersion: "0.1.196" } as never);
let i = 0;
const timer = setInterval(() => store.worktrees.heartbeat(ids[i++ % ids.length]!, Date.now()), 5000 / ids.length);
setTimeout(() => { clearInterval(timer); console.log("writes", i); store.close(); }, Number(seconds) * 1000);
