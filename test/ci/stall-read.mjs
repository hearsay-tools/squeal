import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";

/*
 * Row 018-67: a preload (`--import`) that makes every open of a file named
 * `stall.txt` a read the operating system never ends. The read waits on the
 * fifo `SQUEAL_TEST_STALL_FIFO` names, opened for reading and writing so the
 * open itself returns, and nothing ever writes to it: the request holds one
 * of Node's thread pool threads and keeps the process alive, as a hung
 * network file system does. Every `node:fs/promises` importer sees it.
 */

const fifo = process.env.SQUEAL_TEST_STALL_FIFO;
const promises = fs.promises;
const open = promises.open;

promises.open = async (path, ...rest) => {
  if (fifo !== undefined && basename(String(path)) === "stall.txt") {
    const fd = fs.openSync(fifo, fs.constants.O_RDWR);
    await new Promise((resolve) => fs.read(fd, Buffer.alloc(1), 0, 1, null, resolve));
  }
  return open(path, ...rest);
};
syncBuiltinESMExports();
