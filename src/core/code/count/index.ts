import { blobHash } from "../../hash/blob.js";
import type { CodeLanguage, FileCount } from "../../types/code.js";
import type { FileHash } from "../../types/keys.js";
import { counterReady, withCodeTree } from "./parser.js";
import { PYTHON_RULES } from "./python.js";
import { TYPESCRIPT_RULES } from "./typescript.js";
import { countTree } from "./walk.js";

/*
 * Spec 015 D3: the counter. One file's text in, every function of it out,
 * with D2's identity, its range, body hash, CC and decision points by kind.
 * It runs in the daemon (D4); hooks only read the code store.
 */

/**
 * Moves when a counting rule, a naming rule, the body hash or a grammar
 * changes, so that a stored count is never read across a change of meaning
 * (D3).
 */
export const COUNTER_VERSION = 3;

/**
 * Counts `text` as `language`. `blob` is the key the count is stored under
 * (011 C3's file hash); without it, the git SHA-1 blob id of the text's
 * UTF-8 bytes. A file that does not parse completely still lists every
 * function the parser found, and its error ranges.
 */
export async function countFile(
  text: string,
  language: CodeLanguage,
  blob: FileHash = blobHash(new TextEncoder().encode(text), "sha1"),
): Promise<FileCount> {
  await counterReady();
  const rules = language === "python" ? PYTHON_RULES : TYPESCRIPT_RULES;
  const { functions, errors } = withCodeTree(language, text, (root) =>
    countTree(root, text, rules),
  );
  return { blob, language, counterVersion: COUNTER_VERSION, functions, errors };
}

export { counterReady } from "./parser.js";
