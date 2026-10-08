// The probes of review wave 12d (task 001-135). The driver links
// `data/alias.txt -> target.txt` and `data/linked -> real` after copying.
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, constants, openSync, readFileSync, readSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { SHARE_ENV, Worker } from "node:worker_threads";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const data = (path: string) => join(root, "data", path);
const firstLine = (fd: number) => {
  const buffer = Buffer.alloc(64);
  const read = readSync(fd, buffer, 0, buffer.length, 0);
  closeSync(fd);
  return buffer.subarray(0, read).toString().trim();
};

test("B2: reads through a file symlink and a directory symlink", () => {
  expect(readFileSync(data("alias.txt"), "utf8").trim()).toBe("target v1");
  expect(readFileSync(data("linked/inner.txt"), "utf8").trim()).toBe("inner v1");
});

test("B3: reads through r+, O_RDWR and a FileHandle opened r+", async () => {
  expect(firstLine(openSync(data("rplus.txt"), "r+"))).toBe("rplus v1");
  expect(firstLine(openSync(data("rdwr.txt"), constants.O_RDWR))).toBe("rdwr v1");
  const handle = await open(data("handle.txt"), "r+");
  try {
    expect((await handle.readFile("utf8")).trim()).toBe("handle v1");
  } finally {
    await handle.close();
  }
});

test("B4: a SHARE_ENV Worker and its Node child, stopped at its message", async () => {
  const worker = new Worker(join(root, "scripts/shared.cjs"), { env: SHARE_ENV });
  const message = await new Promise((resolve) => worker.once("message", resolve));
  await worker.terminate();
  expect(message).toBe("shared v1:descendant v1");
});

test("B6: a sync spawn Node rejects still throws", () => {
  const invalid = 5 as unknown as object;
  expect(() => spawnSync(process.execPath, ["-e", ""], invalid)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(() => execFileSync(process.execPath, ["-e", ""], invalid)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
});
