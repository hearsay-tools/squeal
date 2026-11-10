import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseExceptions } from "../core/code/gate/exceptions.js";
import type { ExceptionEntry } from "../core/code/gate/types.js";

/*
 * Spec 020 D8 (row 020-09): the file `squeal code --base --exceptions`
 * reads. The consumer built it from evidence it verified; a file that
 * cannot be read or parsed is a usage error (exit 2).
 */

/**
 * D8: the entries of the file `--exceptions` names, relative to `cwd`; or
 * why it gives none: it cannot be read, does not parse or is not
 * `squeal-code-exceptions/1`. Read before any test runs.
 */
export async function exceptionsOf(
  cwd: string,
  file: string | undefined,
): Promise<readonly ExceptionEntry[] | undefined | { readonly error: string }> {
  if (file === undefined) return undefined;
  let text: string;
  try {
    text = await readFile(resolve(cwd, file), "utf8");
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    return { error: `--exceptions ${file}: cannot be read: ${reason}` };
  }
  const entries = parseExceptions(text);
  return "error" in entries ? { error: `--exceptions ${file}: ${entries.error}` } : entries;
}
