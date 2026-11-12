// Throwaway probe (rows 011-313, 011-314). Times the daemon's LineReader.push
// (src/core/runner-host/protocol.ts) on one protocol line of SIZE MB that
// arrives in CHUNK-byte chunks, as a host's `coverage` event would.
// Row 011-314's bound: each line of `bounded` in under 0.5 s.
// Usage (repo root): node_modules/.bin/tsx <this>
import { loadavg } from "node:os";
import { LineReader, encodeLine } from "../../../../../../src/core/runner-host/protocol.js";

const boundMs = 500;

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

const bounded = [[32, 65536], [4, 4096]] as const;
const more = [[1, 65536], [2, 65536], [4, 65536], [8, 65536], [16, 65536], [1, 4096], [2, 4096], [16, 4096], [32, 4096]] as const;
console.log(JSON.stringify({ loadavg: loadavg().map((l) => Math.round(l * 10) / 10) }));
let failed = false;
for (const [mb, chunk] of bounded) {
  const result = once(mb, chunk);
  const pass = result.ms < boundMs;
  failed ||= !pass;
  console.log(JSON.stringify({ mb, chunk, ...result, boundMs, pass }));
}
for (const [mb, chunk] of more) console.log(JSON.stringify({ mb, chunk, ...once(mb, chunk) }));
if (failed) process.exitCode = 1;
