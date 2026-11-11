// Throwaway (row 021-02). Runs on the remote. Reads "path marker" lines on stdin and prints
// "marker <epoch ms>" when the file under the root holds the marker. fs.watch on the parent
// directory (Mutagen writes by rename) plus a 25 ms re-check while a wait is open.
import { readFileSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
const root = process.argv[2];
let open = null;
function check() {
  if (!open) return;
  let text = "";
  try { text = readFileSync(open.file, "utf8"); } catch {}
  if (text.includes(open.marker)) {
    process.stdout.write(`${open.marker} ${Date.now()}\n`);
    open.watcher.close(); clearInterval(open.timer); open = null;
  }
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const [path, marker] = line.split(" ");
  const file = join(root, path);
  open = { file, marker, watcher: watch(dirname(file), check), timer: setInterval(check, 25) };
  check();
});
