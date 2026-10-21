// Throwaway probe P1 (014-01): a server that binds at a staging name and renames
// it into place, as src/core/daemon/server.ts bindAt does. Prints what a reader
// that never connects can see: the file inode, /proc/net/unix, the pid's fds.
import { createServer } from "node:net";
import { mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const dir = process.argv[2];
mkdirSync(dir, { recursive: true, mode: 0o700 });
const staging = join(dir, ".0123456789abcdef");
const final = join(dir, "squeal-feedfacefeedface.sock");
const server = createServer(() => {});
server.listen(staging, () => {
  renameSync(staging, final);
  const fileIno = statSync(final).ino;
  const line = readFileSync("/proc/net/unix", "utf8").split("\n").find((l) => l.includes(dir));
  const sockIno = Number(line.trim().split(/\s+/)[6]);
  const fds = readdirSync(`/proc/${process.pid}/fd`).map((fd) => {
    try { return readlinkSync(`/proc/${process.pid}/fd/${fd}`); } catch { return ""; }
  });
  console.log(JSON.stringify({ fileIno, procNetUnix: line.trim(), sockIno,
    pidHoldsSockIno: fds.includes(`socket:[${sockIno}]`) }));
  const ss = execFileSync("ss", ["-xlpe", "src", staging], { encoding: "utf8" });
  console.log(ss.trim());
  const ssAll = execFileSync("ss", ["-xlpe"], { encoding: "utf8" }).split("\n").filter((l) => l.includes(dir));
  console.log("ss lines naming dir:", ssAll.length);
  server.close();
});
