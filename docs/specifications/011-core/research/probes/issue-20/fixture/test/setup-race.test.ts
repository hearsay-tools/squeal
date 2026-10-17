// The same race in beforeAll (true setup): a leftover writer from a previous
// attempt is simulated by starting the writer, then clearing the directory to
// start clean. Its tests are then skipped.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";

let dir: string;
let writer: ChildProcess;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "i20-setup-"));
  writer = spawn(
    process.execPath,
    [
      "-e",
      `const fs=require("fs"),p=require("path");let i=0;
       for(;;){const d=p.join(process.argv[1],"w"+(i%8));
         try{fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,"f"+i++),"x")}catch{}}`,
      dir,
    ],
    { stdio: "ignore" },
  );
  await sleep(200);
  rmSync(join(dir, "w0"), { recursive: true, force: true });
});

afterAll(() => {
  writer?.kill("SIGKILL");
});

it("never reached when setup throws", () => {
  expect(true).toBe(true);
});
