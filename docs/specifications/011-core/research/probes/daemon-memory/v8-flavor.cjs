// Throwaway probe for research 011-53: does gc({flavor: "last-resort"}) give freed pages back
// where a plain forced GC does not? Run: node --expose-gc v8-flavor.cjs <regular|last-resort>
const fs = require("fs");
const priv = () => Math.round(+/RssAnon:\s+(\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1] / 1024);
const heap = () => Math.round(process.memoryUsage().heapTotal / 2 ** 20);
const flavor = process.argv[2];
const r = { flavor, start: priv() };
let keep = []; for (let i = 0; i < 3e6; i++) { keep.push({ i, s: "x" + i }); if (keep.length > 2e5) keep = []; } keep = null;
r.churned = priv(); r.heapChurned = heap();
const t = performance.now();
gc({ type: "major", execution: "sync", flavor });
r.pauseMs = Math.round(performance.now() - t); r.after = priv(); r.heapAfter = heap();
setTimeout(() => { r.after5s = priv(); console.log(JSON.stringify(r)); }, 5000);
