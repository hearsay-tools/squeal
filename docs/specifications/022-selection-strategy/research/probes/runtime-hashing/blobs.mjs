// Throwaway: reads many blobs through one `git cat-file --batch`.
import { spawn } from "node:child_process";
export function catFileBatch(cwd, oids) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`cat-file exit ${code}`));
      const buf = Buffer.concat(chunks);
      const out = new Map();
      let at = 0;
      for (const oid of oids) {
        const nl = buf.indexOf(10, at);
        const [name, type, size] = buf.subarray(at, nl).toString().split(" ");
        if (type === "missing" || name === undefined) throw new Error(`missing ${oid}`);
        const n = Number(size);
        out.set(oid, buf.subarray(nl + 1, nl + 1 + n));
        at = nl + 1 + n + 1;
      }
      resolve(out);
    });
    child.stdin.end(oids.join("\n") + "\n");
  });
}
