import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { blobHash } from "../../hash/index.js";
import type { CodeLanguage, FileCount } from "../../types/code.js";
import type { RelativePath } from "../../types/index.js";
import type { PassContext } from "./pass.js";
import type { SourceFile } from "./types.js";

/** Spec 015 D4: blobs counted per slice; the daemon serves requests and starts tiers between slices. */
export const SLICE_FILES = 200;

/** A work set path still included: over the size limit, or to count. */
export interface FileEntry {
  readonly kind: "big" | "count";
  readonly path: RelativePath;
  readonly file: SourceFile;
  readonly language: CodeLanguage;
}

/** A work set path: no longer counted, or a file. */
export type Entry = { readonly kind: "gone"; readonly path: RelativePath } | FileEntry;

/**
 * D4's blob lookup and slices: each blob of the work set with no count at
 * this counter version is read and counted once, `sliceFiles` at a time, and
 * stored with one transaction per slice. A blob the disk no longer holds is
 * retried at the next pass; one the counter fails on stays uncounted
 * (`pending`); the paths of either keep their states as they were. A
 * symlink is no file to count (`links`): its target is counted at its own
 * path.
 */
export async function countMissing(
  ctx: PassContext,
  entries: readonly Entry[],
): Promise<{ counted: number; skipped: Set<RelativePath>; links: Set<RelativePath> }> {
  const { store, counter } = ctx;
  const byBlob = new Map<string, FileEntry[]>();
  for (const e of entries) {
    if (e.kind !== "count") continue;
    const key = `${e.file.hash}\0${e.language}`;
    byBlob.set(key, [...(byBlob.get(key) ?? []), e]);
  }
  const missing = [...byBlob.values()].filter(
    ([e]) => e !== undefined && store.counts.get(e.file.hash, e.language, counter.version) === null,
  );
  const skipped = new Set<RelativePath>();
  const links = new Set<RelativePath>();
  let counted = 0;
  const size = ctx.sliceFiles ?? SLICE_FILES;
  for (let start = 0; start < missing.length; start += size) {
    if (start > 0) await nextTurn();
    const slice = missing.slice(start, start + size);
    // One file at a time: each read gives the event loop a turn, so no stretch holds more than one count.
    const counts: Awaited<ReturnType<typeof countOne>>[] = [];
    for (const [e] of slice) counts.push(e === undefined ? null : await countOne(ctx, e));
    store.transaction(() => {
      slice.forEach((group, i) => {
        const count = counts[i];
        if (count === "link") for (const e of group) links.add(e.path);
        if (count === "link") return;
        if (count === "moved") for (const e of group) ctx.retry.add(e.path);
        if (count === undefined || count === null || count === "moved") {
          for (const e of group) skipped.add(e.path);
          return;
        }
        store.counts.put(count, ctx.now());
        counted++;
      });
    });
  }
  return { counted, skipped, links };
}

const decoder = new TextDecoder();

/** As `hashFile`'s: a symlink at the last component is never followed, a fifo never blocks. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** A regular file's bytes, `link` for anything else, `null` when it is gone. */
async function readRegular(path: string): Promise<Uint8Array | "link" | null> {
  const handle = await open(path, OPEN_FLAGS).catch((error: NodeJS.ErrnoException) =>
    error.code === "ELOOP" ? "link" : null,
  );
  if (handle === null || handle === "link") return handle;
  try {
    return (await handle.stat()).isFile() ? await handle.readFile() : "link";
  } finally {
    await handle.close();
  }
}

async function countOne(
  ctx: PassContext,
  e: FileEntry,
): Promise<FileCount | "moved" | "link" | null> {
  const bytes = await readRegular(join(ctx.root, e.path));
  if (bytes === "link") return bytes;
  if (bytes === null || blobHash(bytes, ctx.format) !== e.file.hash) return "moved";
  try {
    const { functions, errors } = await ctx.counter.count(decoder.decode(bytes), e.language);
    return {
      blob: e.file.hash,
      language: e.language,
      counterVersion: ctx.counter.version,
      functions,
      errors,
    };
  } catch (error) {
    ctx.log(`complexity: could not count ${e.path}: ${String(error)}`);
    return null;
  }
}
