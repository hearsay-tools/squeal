import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import type { AbsolutePath } from "../../../core/types/index.js";

/** What the interpreter says about itself, for D2's environment hash. */
export interface InterpreterInfo {
  /** The binary's real path, links followed: uv's carries the patch version. */
  readonly realPath: AbsolutePath;
  /** `sys.version`. */
  readonly version: string;
  /** `sys.implementation.name`, such as `cpython`. */
  readonly implementation: string;
  /** `sys.implementation.cache_tag`, such as `cpython-313`. */
  readonly cacheTag: string;
}

export type InterpreterQuery =
  | ({ readonly ok: true } & InterpreterInfo)
  | { readonly ok: false; readonly error: string };

const QUERY_TIMEOUT_MS = 30_000;
const QUERY =
  "import sys, json; print(json.dumps([sys.version, sys.implementation.name, sys.implementation.cache_tag]))";

const cache = new Map<AbsolutePath, { readonly stat: string; readonly info: InterpreterInfo }>();

/**
 * Spec 007 D2: "the interpreter's real path, `sys.version`, implementation
 * and cache tag, asked once with `-I -S` (16 ms) and again when the
 * binary's stat changes". `-I` ignores every `PYTHON*` variable and the
 * user site, `-S` skips `site`, so neither the daemon's environment nor
 * the environment's `.pth` files can change the answer. A failure is not
 * cached.
 */
export async function queryInterpreter(python: AbsolutePath): Promise<InterpreterQuery> {
  let realPath: AbsolutePath;
  let stat: string;
  try {
    realPath = realpathSync(python);
    stat = statKey(realPath);
  } catch (error) {
    return { ok: false, error: `cannot run ${python}: ${(error as Error).message}` };
  }
  const cached = cache.get(realPath);
  if (cached?.stat === stat) return { ok: true, ...cached.info };
  const answer = await run(python);
  if (!answer.ok) return answer;
  const info: InterpreterInfo = { realPath, ...answer.info };
  cache.set(realPath, { stat, info });
  return { ok: true, ...info };
}

function statKey(path: AbsolutePath): string {
  const s = statSync(path, { bigint: true });
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}

function run(
  python: AbsolutePath,
): Promise<
  | { readonly ok: true; readonly info: Omit<InterpreterInfo, "realPath"> }
  | { readonly ok: false; readonly error: string }
> {
  return new Promise((done) => {
    execFile(
      python,
      ["-I", "-S", "-c", QUERY],
      { env: {}, timeout: QUERY_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        const parsed = error === null ? parse(stdout) : null;
        if (parsed !== null) done({ ok: true, info: parsed });
        else {
          const reason =
            error?.message.split("\n")[0] ?? `unexpected output ${JSON.stringify(stdout)}`;
          done({ ok: false, error: `cannot run ${python}: ${reason}` });
        }
      },
    );
  });
}

function parse(stdout: string): Omit<InterpreterInfo, "realPath"> | null {
  try {
    const value: unknown = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    if (!Array.isArray(value) || value.length !== 3) return null;
    if (!value.every((part) => typeof part === "string")) return null;
    const [version, implementation, cacheTag] = value as [string, string, string];
    return { version, implementation, cacheTag };
  } catch {
    return null;
  }
}
