// Throwaway (015-01): medians per mode from bench-loop.sh output, and each
// coverage run against the off run of its own round.
// node summarize-bench.mjs <bench.txt>
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const r = JSON.parse(line.match(/RESULT (\{.*\}) TIME/)[1]);
    const t = Object.fromEntries([...line.matchAll(/(\w+)=([\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
    return { ...r, round: t.round, load1: t.load1, wall: t.wall, cpu: t.user + t.sys, rss: t.maxrss_kb / 1024 };
  });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (x) => Math.round(x * 10) / 10;
for (const mode of ["off", "v8", "istanbul"]) {
  const m = rows.filter((r) => r.mode === mode);
  if (m.length === 0) continue;
  const ratios = m.map((r) => {
    const off = rows.find((o) => o.mode === "off" && o.round === r.round);
    return { wall: r.runMs / off.runMs, cpu: r.cpu / off.cpu };
  });
  console.log(
    `${mode} n=${m.length} load1=${m.map((r) => r.load1).join("/")} runS=${fmt(median(m.map((r) => r.runMs / 1000)))} ` +
      `cpuS(total)=${fmt(median(m.map((r) => r.cpu)))} mainCpuS=${fmt(median(m.map((r) => r.mainCpuMs / 1000)))} ` +
      `maxRssMb(largest process)=${Math.round(median(m.map((r) => r.rss)))} mainRssMb=${Math.round(median(m.map((r) => r.mainRssMb)))} ` +
      `wall/off median=${median(ratios.map((x) => x.wall)).toFixed(2)} [${ratios.map((x) => x.wall.toFixed(2)).join(" ")}] ` +
      `cpu/off median=${median(ratios.map((x) => x.cpu)).toFixed(2)} [${ratios.map((x) => x.cpu.toFixed(2)).join(" ")}] ` +
      `states=${[...new Set(m.map((r) => JSON.stringify(r.states) + r.failed.join()))].join(" | ")}` +
      (mode === "v8" ? ` convertS=${fmt(median(m.map((r) => r.convertMs / 1000)))}` : ""),
  );
}
const v8 = rows.find((r) => r.mode === "v8");
if (v8) {
  const raw = v8.rawBytes;
  const mapped = v8.mappedBytes;
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  console.log(
    `bytes per test file: raw v8 median=${Math.round(median(raw) / 1024)} KiB mean=${Math.round(sum(raw) / raw.length / 1024)} KiB; ` +
      `mapped istanbul median=${Math.round(median(mapped) / 1024)} KiB mean=${Math.round(sum(mapped) / mapped.length / 1024)} KiB; ` +
      `x950: raw ${Math.round((sum(raw) / raw.length) * 950 / 1048576)} MiB, mapped ${Math.round((sum(mapped) / mapped.length) * 950 / 1048576)} MiB`,
  );
}
