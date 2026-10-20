// 013-01 probe (question 3): read every emitted file in a loop while `tsc` rebuilds it with
// the same bytes; count reads whose bytes differ from the build before. argv: <project> <tsc>
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";

const [project, tsc] = process.argv.slice(2);
const dist = `${project}/dist`;
const files = readdirSync(dist).map((f) => `${dist}/${f}`);
const before = new Map(files.map((f) => [f, readFileSync(f)]));
const stats = new Map(files.map((f) => [f, statSync(f)]));
const child = spawn(tsc, ["-p", project], { stdio: "inherit" });
let done = false;
child.on("exit", () => { done = true; });
let reads = 0, other = 0, empty = 0;
const kinds = {};
while (!done) {
  for (const f of files) {
    const bytes = readFileSync(f);
    reads++;
    if (!bytes.equals(before.get(f))) {
      other++;
      if (bytes.length === 0) empty++;
      const k = f.replace(/^.*?(\.d\.ts|\.js\.map|\.js)$/, "$1");
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
  }
  await new Promise((r) => setImmediate(r));
}
let same = 0, moved = 0, inode = 0;
for (const f of files) {
  const s = statSync(f);
  if (readFileSync(f).equals(before.get(f))) same++;
  if (s.mtimeMs !== stats.get(f).mtimeMs) moved++;
  if (s.ino === stats.get(f).ino) inode++;
}
console.log(JSON.stringify({ files: files.length, reads, otherBytes: other, empty, byKind: kinds, endSameBytes: same, mtimeMoved: moved, sameInode: inode }));
