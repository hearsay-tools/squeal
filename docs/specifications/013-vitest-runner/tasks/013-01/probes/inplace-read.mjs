// 013-01 probe (question 3): can a reader see other bytes while another process rewrites a
// file in place with its own bytes, as `tsc` does (open with O_TRUNC, write, close; same inode)?
// argv: <dir> <rounds> <sizeKiB>; the writer is this script with argv[5] = "write".
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";

const [dir, rounds, kib, role] = process.argv.slice(2);
const file = `${dir}/out.js`;
const body = Buffer.from(`export const x = ${JSON.stringify("y".repeat(Number(kib) * 1024))};\n`);
if (role === "write") {
  for (let i = 0; i < Number(rounds); i++) {
    const fd = openSync(file, "w");
    writeSync(fd, body);
    closeSync(fd);
  }
} else {
  writeFileSync(file, body);
  const want = createHash("sha1").update(body).digest("hex");
  const inode = statSync(file).ino;
  const writer = spawn(process.execPath, [process.argv[1], dir, rounds, kib, "write"], { stdio: "inherit" });
  let done = false;
  writer.on("exit", () => { done = true; });
  let reads = 0, other = 0, empty = 0;
  const lengths = new Set();
  while (!done) {
    for (let i = 0; i < 20; i++) {
      const bytes = readFileSync(file);
      reads++;
      if (bytes.length === 0) empty++;
      if (createHash("sha1").update(bytes).digest("hex") !== want) { other++; lengths.add(bytes.length); }
    }
    await new Promise((r) => setImmediate(r));
  }
  console.log(JSON.stringify({ rounds: Number(rounds), sizeBytes: body.length, reads, otherBytes: other, empty, otherLengths: [...lengths].slice(0, 6), sameInode: statSync(file).ino === inode, endsSame: createHash("sha1").update(readFileSync(file)).digest("hex") === want }));
}
