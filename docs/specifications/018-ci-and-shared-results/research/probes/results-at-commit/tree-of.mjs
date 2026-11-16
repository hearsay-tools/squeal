// Throwaway: `git ls-tree -r -z --full-tree <commit>` as Map(path -> blob); null when absent.
import { execFileSync } from "node:child_process";
export function blobsOf(repo, commit) {
  let out;
  try {
    out = execFileSync("git", ["-C", repo, "ls-tree", "-r", "-z", "--full-tree", commit], { encoding: "utf8", maxBuffer: 1 << 30 });
  } catch {
    return null;
  }
  const t = new Map();
  for (const e of out.split("\0")) {
    const tab = e.indexOf("\t");
    if (tab < 0) continue;
    const [, type, obj] = e.slice(0, tab).split(" ");
    if (type === "blob") t.set(e.slice(tab + 1), obj);
  }
  return t;
}
