// Throwaway. Reads `strace -f -e openat,execve` logs of e2e specs run in a scratch Squeal
// clone, maps each copied plugin root back to its source plugin (copyFileSync opens the
// source, then the destination, in one pid), and prints per spec which plugin files it
// opened from its copies. Usage: node trace-map.mjs <clone root> <trace files...>
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [clone, ...files] = process.argv.slice(2);
const src = new RegExp(`openat\\([^"]*"${clone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/plugins/([^/]+)/([^"]+)"`);
const open = /^(\d+)\s+openat\([^"]*"([^"]+)"([^)]*)\)/;
const out = {};
for (const file of files) {
  const lastSrc = new Map(); // pid -> [plugin, rel]
  const roots = new Map(); // copy root -> plugin
  const opened = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = open.exec(line);
    if (!m) continue;
    const [, pid, path, flags] = m;
    const s = src.exec(line);
    if (s) { lastSrc.set(pid, [s[1], s[2]]); continue; }
    if (/O_WRONLY|O_RDWR/.test(flags) && /O_CREAT/.test(flags) && lastSrc.has(pid)) {
      const [plugin, rel] = lastSrc.get(pid);
      if (path.endsWith(`/${rel}`)) roots.set(path.slice(0, -rel.length - 1), plugin);
      lastSrc.delete(pid);
      continue;
    }
    if (!/O_WRONLY|O_RDWR|O_DIRECTORY/.test(flags)) opened.push(path);
  }
  const used = new Set();
  for (const path of opened) {
    for (const [root, plugin] of roots) {
      if (path.startsWith(`${root}/`)) used.add(`plugins/${plugin}/${path.slice(root.length + 1)}`);
    }
  }
  out[basename(file, ".txt")] = { copies: [...new Set(roots.values())].sort(), opened: [...used].sort() };
}
console.log(JSON.stringify(out, null, 1));
