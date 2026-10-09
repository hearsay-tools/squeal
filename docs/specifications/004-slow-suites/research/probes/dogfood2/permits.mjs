// Who holds each slow-slot permit, read from /proc/locks (no lock is taken), one line
// per change: HH:MM:SS UTC, then permit file = holder pid and the worktree that pid's
// daemon serves. Read only. Usage: node permits.mjs <slot dir> <every s> <max s>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, every, max] = process.argv.slice(2);
const end = Date.now() + Number(max) * 1000;
const served = (pid) => {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").at(-2)?.replace(/^\/tmp\//, "") ?? "?"; } catch { return "?"; }
};
let last = "";
for (;;) {
  const locks = readFileSync("/proc/locks", "utf8").split("\n");
  const parts = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".lock")).sort()) {
    const ino = statSync(join(dir, f)).ino;
    const holders = locks
      .filter((l) => / WRITE /.test(l) && l.split(/\s+/)[5]?.endsWith(`:${ino}`))
      .map((l) => l.split(/\s+/)[4]);
    const uniq = [...new Set(holders)];
    parts.push(`${f}=${uniq.length ? uniq.map((p) => `${p}(${served(p)})`).join("+") : "free"}`);
  }
  const line = parts.join(" ");
  if (line !== last) console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  last = line;
  if (Date.now() > end) process.exit(0);
  await new Promise((r) => setTimeout(r, Number(every) * 1000));
}
