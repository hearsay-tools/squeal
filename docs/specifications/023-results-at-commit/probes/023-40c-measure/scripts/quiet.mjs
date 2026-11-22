// Waits until the machine is quiet: under 0.2 s of busy CPU (all CPUs) in each
// of three 2 s windows, or argv[2] seconds pass. Prints the wait in ms.
import { readFileSync } from "node:fs";
const limit = Number(process.argv[2] ?? 180) * 1000;
const busy = () => {
  const f = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  return (f[0] + f[1] + f[2] + f[5] + f[6] + f[7]) * 10; // ms (USER_HZ 100)
};
const t0 = Date.now();
let quiet = 0;
let last = busy();
while (quiet < 3 && Date.now() - t0 < limit) {
  await new Promise((r) => setTimeout(r, 2000));
  const now = busy();
  quiet = now - last < 200 ? quiet + 1 : 0;
  last = now;
}
console.log(`quiet wait ${Date.now() - t0} ms${quiet < 3 ? " (limit)" : ""}`);
