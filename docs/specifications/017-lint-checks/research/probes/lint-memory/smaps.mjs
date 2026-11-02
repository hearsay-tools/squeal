// Throwaway probe for research 017-26: /proc/<pid>/smaps of this process split by kind, MiB.
// heap256: anonymous 256 KiB mappings (V8's regular pages, 011-53's method); glibc: [heap];
// anonOther: every other anonymous mapping (V8 large objects and code, thread stacks, other
// mallocs); file: file-backed (node's binary, shared libraries, mapped files).
import { readFileSync } from "node:fs";

export function smaps(pid = "self") {
  const out = { heap256: 0, glibc: 0, anonOther: 0, file: 0 };
  let kind = "anonOther";
  for (const line of readFileSync(`/proc/${pid}/smaps`, "utf8").split("\n")) {
    const m = /^([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)$/.exec(line);
    if (m) {
      const size = Number.parseInt(m[2], 16) - Number.parseInt(m[1], 16);
      const name = m[4].trim();
      if (m[3] !== "0" && name.startsWith("/")) kind = "file";
      else if (name === "[heap]") kind = "glibc";
      else if (name === "" && size === 256 * 1024) kind = "heap256";
      else kind = "anonOther";
    } else if (line.startsWith("Rss:")) out[kind] += Number(line.split(/\s+/)[1]);
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] / 1024);
  return out;
}
