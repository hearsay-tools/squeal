#!/bin/sh
# Throwaway probe (row 011-313). Runs the daemon's full check (PRAGMA
# integrity_check(10), the script of src/core/daemon/full-check.ts) at nice 10
# on a COPY of a store, and prints its wall time, CPU and read counts from its
# own /proc/self/io. Usage: sh integrity-io.sh <copy of store.sqlite>
exec nice -n 10 node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const t0 = Date.now();
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const rows = db.prepare("PRAGMA integrity_check(10)").all();
const io = Object.fromEntries(fs.readFileSync("/proc/self/io", "utf8").trim().split("\n").map((l) => l.split(": ")));
const cpu = process.cpuUsage();
console.log(JSON.stringify({ result: rows.map((r) => r.integrity_check), wallS: (Date.now() - t0) / 1000,
  cpuS: (cpu.user + cpu.system) / 1e6, userS: cpu.user / 1e6, systemS: cpu.system / 1e6,
  readCalls: Number(io.syscr), readBytes: Number(io.rchar), diskBytes: Number(io.read_bytes),
  bytesPerRead: Math.round(Number(io.rchar) / Number(io.syscr)) }));
' "$1"
