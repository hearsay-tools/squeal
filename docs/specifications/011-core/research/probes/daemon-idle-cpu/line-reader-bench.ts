// Throwaway probe (row 011-313). Times the daemon's LineReader.push
// (src/core/runner-host/protocol.ts) on one protocol line of SIZE MB that
// arrives in CHUNK-byte chunks, as a host's `coverage` event would.
// Usage (repo root): node_modules/.bin/tsx <this>
import { LineReader, encodeLine } from "../../../../../../src/core/runner-host/protocol.js";

function once(sizeMb: number, chunk: number): { ms: number; msPerMb: number } {
  const payload = { ev: "note", text: "x".repeat(sizeMb * 1024 * 1024) };
  const line = encodeLine(payload);
  const reader = new LineReader();
  const t0 = performance.now();
  let got = 0;
  for (let at = 0; at < line.length; at += chunk) got += reader.push(line.slice(at, at + chunk)).length;
  const ms = performance.now() - t0;
  if (got !== 1) throw new Error(`expected one message, got ${got}`);
  return { ms: Math.round(ms), msPerMb: Math.round(ms / sizeMb) };
}
for (const [mb, chunk] of [[1, 65536], [2, 65536], [4, 65536], [8, 65536], [16, 65536], [32, 65536], [1, 4096], [2, 4096], [4, 4096]] as const) {
  console.log(JSON.stringify({ mb, chunk, ...once(mb, chunk) }));
}
