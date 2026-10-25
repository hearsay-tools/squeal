// Throwaway probe (016-27), questions 3 to 5: every listed directory (a closure path ending in `/`) in a
// store's observed maps (`observed.<project>`), with the test files that list it. Read-only.
// Prints one JSON line per directory: { project, dir, readers: [test paths] }.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const byDir = new Map();
for (const { key, value } of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
  const project = key.slice("observed.".length);
  for (const [test, paths] of Object.entries(JSON.parse(value)))
    for (const p of paths) if (p.endsWith("/")) {
      const id = `${project}\0${p}`;
      byDir.set(id, [...(byDir.get(id) ?? []), test]);
    }
}
for (const [id, readers] of [...byDir].sort()) {
  const [project, dir] = id.split("\0");
  console.log(JSON.stringify({ project, dir, readers }));
}
