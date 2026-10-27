import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import { updateRuntime } from "../../../../src/harness/codex/runtime-update/update.js";

// Two real processes use the real store/updater. Interception only sets the pause point.
const [mode, plugin, data, version, phase = "new", nextPlugin = plugin] = process.argv.slice(2);
if (!mode || !plugin || !data || !version) throw new Error("missing selection probe arguments");
const child = (operation: string) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        ...process.execArgv,
        process.argv[1] ?? "",
        operation,
        operation === "bootstrap" ? (nextPlugin ?? plugin) : plugin,
        data,
        version,
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    ),
  ) as unknown;
let other: unknown;
let triggered = false;
const read = fs.readFileSync;
const rename = fs.renameSync;
if (mode.startsWith("bootstrap-") || (mode === "update-bootstrap" && phase === "retained")) {
  fs.readFileSync = function (this: typeof fs, path, ...args) {
    const target = mode.startsWith("bootstrap-")
      ? join(plugin, "seed/runtime.json")
      : join(data, "versions", version, "runtime.json");
    if (!triggered && path === target) {
      triggered = true;
      other = child(mode === "bootstrap-update" ? "update" : "bootstrap");
    }
    return read.call(this, path, ...args);
  } as typeof fs.readFileSync;
} else if (mode === "update-bootstrap") {
  fs.renameSync = (from, to) => {
    if (!triggered && to === join(data, "versions", version)) {
      triggered = true;
      other = child("bootstrap");
    }
    return rename(from, to);
  };
}
syncBuiltinESMExports();
try {
  const result = mode.startsWith("bootstrap")
    ? selectRuntime({ pluginRoot: plugin, data, sessionId: "first-session" })
    : await updateRuntime({
        pluginRoot: plugin,
        data,
        explicit: true,
        tag: `squeal--v${version}`,
        transport: async (url) =>
          new Response(
            fs.readFileSync(
              join(data, url.endsWith(".json.gz") ? "artifact.gz" : "descriptor.json"),
            ),
          ),
      });
  console.log(JSON.stringify({ result, other, triggered, current: readCurrent(data) }));
} finally {
  fs.readFileSync = read;
  fs.renameSync = rename;
  syncBuiltinESMExports();
}
