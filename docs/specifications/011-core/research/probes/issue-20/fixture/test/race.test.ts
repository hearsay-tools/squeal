// Mirrors cezarion packages/web/e2e/new-task.e2e.ts:88: afterAll removes the
// file's own mkdtemp directory while a process the file started still writes
// into it. Nothing outside this file touches the directory.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let dir: string;
let writer: ChildProcess;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "i20-race-"));
  // A stand-in for the fixture server's children: keeps creating files.
  writer = spawn(
    process.execPath,
    [
      "-e",
      // Writes every few ms; on SIGTERM it flushes for 3 ms more, as a
      // server that writes its state on shutdown, then exits.
      `const fs=require("fs"),p=require("path");let i=0;
       const w=()=>{const d=p.join(process.argv[1],"w"+(i%8));
         try{fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,"f"+i++),"x")}catch{}};
       const t=setInterval(w,2);
       process.on("SIGTERM",()=>{clearInterval(t);const end=Date.now()+3;while(Date.now()<end)w();process.exit(0)});`,
      dir,
    ],
    { stdio: "ignore" },
  );
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(() => {
  // Signalled but not awaited, as a stop that returns before the children exit.
  writer.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
});

it("records where its temp directory is", () => {
  console.log(`I20 tmpdir=${tmpdir()} dir=${dir} pid=${process.pid}`);
  expect(dir.startsWith(tmpdir())).toBe(true);
});
