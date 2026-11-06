// Throwaway probe for row 011-303 (issue #154): prints the Squeal hook
// messages and Squeal CLI calls of one Cezar run's transcript, with times.
// Read-only; it decompresses the brotli NDJSON in memory.
//
//   node transcript.mjs <run>.ndjson.br
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: node transcript.mjs <run>.ndjson.br");
  process.exit(2);
}
const lines = brotliDecompressSync(readFileSync(file)).toString("utf8").split("\n");
for (const line of lines) {
  if (line.trim() === "") continue;
  const event = JSON.parse(line);
  if (event.type !== "item.completed") continue;
  const item = event.item;
  if (item.kind === "hook") {
    const text = (item.entries ?? []).map((e) => e.text).join(" | ");
    if (/SQUEAL|lint|Squeal/.test(text)) {
      console.log(JSON.stringify({ ts: event.ts, hook: item.event, status: item.status, text }));
    }
  } else if (item.kind === "tool" && /squeal/.test(JSON.stringify(item.input ?? ""))) {
    console.log(
      JSON.stringify({ ts: event.ts, command: item.input?.command, exit: item.exitCode, output: item.output }),
    );
  }
}
