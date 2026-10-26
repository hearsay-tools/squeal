import { readFileSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, RelativePath } from "../../types/index.js";
import { recordOf, scriptPath, sourceEntry } from "./record.js";
import type {
  CachedSourceMap,
  CoverageRecord,
  CoverageSource,
  ExecutedSource,
  V8Payload,
} from "./types.js";

/**
 * Row 015-86 (spec 015 D8): the record of one completed node:test file,
 * from the `NODE_V8_COVERAGE` file of its own process. Each script under
 * `root` and outside `node_modules` is a source. Under a loader, Node's
 * `source-map-cache` holds the executed code's line lengths and the map,
 * whose `sourcesContent` is the text the loader read, so the blob is of
 * those bytes. Without a map of its own, V8 ran the file as it is, which
 * is read now: a later edit re-keys the test file, so no result at its
 * current key names this run and the record is not kept. A source that
 * cannot be read is `unread`.
 */
export function ownRecord(
  root: AbsolutePath,
  payload: V8Payload,
  format: ObjectFormat,
  skip: (path: AbsolutePath) => boolean = () => false,
): CoverageRecord {
  const sources: CoverageSource[] = [];
  const unread: RelativePath[] = [];
  const cache = payload["source-map-cache"] ?? {};
  for (const script of payload.result) {
    const path = scriptPath(script.url);
    if (path === null || skip(path)) continue;
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("node_modules")) {
      continue;
    }
    const executed = ownSource(path, rel.split(sep).join("/"), script.url, cache[script.url]);
    if (executed === null) unread.push(rel.split(sep).join("/"));
    else sources.push(sourceEntry(script, executed.source, blobHash(executed.bytes, format)));
  }
  return recordOf(sources, unread);
}

/** What ran of one own script, and the bytes it ran from; `null` when they cannot be read. */
function ownSource(
  path: AbsolutePath,
  rel: RelativePath,
  url: string,
  cached: CachedSourceMap | undefined,
): { readonly source: ExecutedSource; readonly bytes: Buffer } | null {
  const map = cached?.data ?? null;
  const own = map !== null && typeof map.mappings === "string" && sourceOf(map, url) === url;
  const content = own ? map.sourcesContent?.[0] : undefined;
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : read(path);
  if (bytes === null) return null;
  if (!own || cached === undefined) {
    return {
      source: { path: rel, code: bytes.toString("utf8"), map: null, sha1: undefined },
      bytes,
    };
  }
  const text = typeof content === "string" ? content : bytes.toString("utf8");
  const source: ExecutedSource = {
    path: rel,
    code: "",
    map: { mappings: map.mappings, sourcesContent: [text] },
    sha1: undefined,
    lineLengths: cached.lineLengths,
  };
  return { source, bytes };
}

/** The map's first source as a URL; a map of another file is not this script's own. */
function sourceOf(map: NonNullable<CachedSourceMap["data"]>, url: string): string | null {
  const first = map.sources?.[0];
  if (typeof first !== "string") return null;
  try {
    return new URL(first, url).href;
  } catch {
    return null;
  }
}

function read(path: AbsolutePath): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
