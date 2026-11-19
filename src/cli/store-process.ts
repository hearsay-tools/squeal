import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { daemonLogLine } from "../core/daemon/log-file.js";
import { startStoreProcess } from "../core/store-process/server.js";
import { writerScript } from "../core/store-process/writer.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { CliIo } from "./main.js";

const USAGE = "usage: squeal store-process <common dir> --store code\n";

/**
 * `squeal store-process <common dir> --store code` (spec 021 D22, row
 * 021-36), hidden: a daemon starts it, detached, when it needs to write
 * `code.sqlite` and none serves. It serves until its last client's grace
 * passed or the file's schema is newer than its own. Exit code 0 when it
 * served or another one does, 1 when it could not serve, 2 on a usage error.
 */
export async function storeProcessCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [dir, flag, file] = args;
  if (
    dir === undefined ||
    !isAbsolute(dir) ||
    flag !== "--store" ||
    file !== "code" ||
    args.length !== 3
  ) {
    io.stderr(USAGE);
    return 2;
  }
  let commonDir: AbsolutePath;
  try {
    commonDir = realpathSync(dir);
  } catch (error) {
    io.stderr(`squeal store-process: cannot read ${dir}: ${String(error)}\n`);
    return 2;
  }
  const log = (line: string) => io.stderr(`${daemonLogLine(line)}\n`);
  const started = await startStoreProcess({
    commonDir,
    log,
    writer: writerScript(),
    ...(io.env === undefined ? {} : { env: io.env as NodeJS.ProcessEnv }),
  });
  if (typeof started === "string") return started === "lost-lock" ? 0 : 1;
  const stop = () => void started.stop();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const end = await started.ended;
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  log(`store process: ended (${end})`);
  return 0;
}
