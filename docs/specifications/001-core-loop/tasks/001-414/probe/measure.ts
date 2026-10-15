// One idle waiter over the fixture for N seconds, as src/harness/shared/waiter.ts polls; prints its CPU (task 001-414).
import { join } from "node:path";
import { createDelivery } from "../../../../../../src/core/delivery/index.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/index.js";

const [dir, seconds = "20", owed = "0"] = process.argv.slice(2);
const store = openStore(join(dir!, ".git"), { busyTimeoutMs: 5_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const consumer = { worktreeId: "wt-main", sessionId: "s-probe", agentId: "main" };
const status = { build: async () => { throw new Error("unused"); } } as never;
const setup = createDelivery(store, { status });
if (store.consumers.get(consumer) === null) await setup.register(consumer);
const keys = store.testFileKeys.list("wt-main").slice(0, Number(owed));
store.testFileKeys.upsertMany(keys.map((k) => ({ ...k, pending: "queued" as const })));
await setup.endTurn(consumer);
const delivery = createDelivery(store, { status });
const wall = performance.now();
const cpu = process.cpuUsage();
const end = wall + Number(seconds) * 1000;
let chunks = 0;
while (performance.now() < end) {
  if (store.consumers.get(consumer) === null) throw new Error("unregistered");
  chunks++;
  const d = await delivery.waitForDelta(consumer, { timeoutMs: Math.min(1000, end - performance.now()) });
  if (d !== null) console.log("delta!", d.entries.length);
}
const used = process.cpuUsage(cpu);
const ms = performance.now() - wall;
console.log(JSON.stringify({ seconds: ms / 1000, cpuPct: (100 * (used.user + used.system) / 1000 / ms).toFixed(2), userMs: used.user / 1000, sysMs: used.system / 1000, chunks }));
store.close();
