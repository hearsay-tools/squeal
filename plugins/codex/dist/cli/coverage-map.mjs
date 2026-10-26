import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/code/coverage/map-worker.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

// src/core/code/coverage/own.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

// src/core/hash/blob.ts
import { createHash } from "node:crypto";
import { constants } from "node:fs";

// src/core/fs/compare.ts
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// src/core/hash/blob.ts
function blobHash(bytes, format2) {
  return createHash(format2).update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
var OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// src/core/code/coverage/record.ts
import { createHash as createHash2 } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";

// src/core/code/coverage/ranges.ts
var Counts = class {
  #starts = [];
  #ends = [];
  #counts = [];
  constructor(functions, wrapper) {
    const ranges = functions.flatMap((fn) => fn.ranges).map((r) => ({ start: r.startOffset - wrapper, end: r.endOffset - wrapper, count: r.count })).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || b.end - a.end);
    const open = [];
    let at = Number.NEGATIVE_INFINITY;
    const emit = (to, count) => {
      if (to > at) {
        this.#starts.push(at);
        this.#ends.push(to);
        this.#counts.push(count);
      }
      at = Math.max(at, to);
    };
    const close = (until) => {
      for (let top = open.at(-1); top !== void 0 && top.end <= until; top = open.at(-1)) {
        emit(top.end, top.count);
        open.pop();
      }
    };
    for (const range of ranges) {
      close(range.start);
      const top = open.at(-1);
      if (top === void 0) at = range.start;
      else emit(range.start, top.count);
      open.push({
        end: top === void 0 ? range.end : Math.min(range.end, top.end),
        count: range.count
      });
    }
    close(Number.POSITIVE_INFINITY);
  }
  /** The count at `offset`; `null` outside every range. */
  at(offset) {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low <= high) {
      const mid = low + high >> 1;
      if ((this.#ends[mid] ?? 0) <= offset) low = mid + 1;
      else if ((this.#starts[mid] ?? 0) > offset) high = mid - 1;
      else return this.#counts[mid] ?? null;
    }
    return null;
  }
};

// src/core/code/coverage/sourcemap.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;
function decodeMappings(mappings) {
  const lines = [];
  let line = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let column = 0;
  const fields = [];
  let value = 0;
  let shift = 0;
  const endSegment = () => {
    if (fields.length >= 4) {
      column += fields[0] ?? 0;
      source += fields[1] ?? 0;
      sourceLine += fields[2] ?? 0;
      sourceColumn += fields[3] ?? 0;
      line.push([column, source, sourceLine, sourceColumn]);
    } else if (fields.length > 0) column += fields[0] ?? 0;
    fields.length = 0;
  };
  for (let i = 0; i < mappings.length; i++) {
    const code = mappings.charCodeAt(i);
    if (code === 59) {
      endSegment();
      lines.push(line);
      line = [];
      column = 0;
      continue;
    }
    if (code === 44) {
      endSegment();
      continue;
    }
    const digit = code < 128 ? DIGIT[code] ?? -1 : -1;
    if (digit < 0) throw new Error(`source map: not base64 at ${i}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  endSegment();
  lines.push(line);
  for (const segments of lines) segments.sort((a, b) => a[0] - b[0]);
  return lines;
}
var PositionMap = class {
  #lines;
  /** Vite maps a module to itself alone, its source 0; another source is not this module's. */
  #own = 0;
  constructor(map) {
    this.#lines = map === null || typeof map.mappings !== "string" ? null : decodeMappings(map.mappings);
  }
  /**
   * Every mapped position of generated `line` (0-based), whose text is
   * `text`: `[column, sourceLine, sourceColumn]`, all 0-based. Without a
   * map, the line's first character that is not white space.
   */
  *segments(line, text) {
    if (this.#lines === null) {
      const column = text.search(/\S/);
      if (column !== -1) yield [column, line, column];
      return;
    }
    for (const segment of this.#lines[line] ?? []) {
      if (segment[1] === this.#own) yield [segment[0], segment[2], segment[3]];
    }
  }
  /**
   * The source position of generated `(line, column)`: the last mapped
   * segment at or before it on its line, else the first after it; `null`
   * when the line maps nothing of the module's own source.
   */
  at(line, column) {
    if (this.#lines === null) return [line, column];
    let found;
    for (const segment of this.#lines[line] ?? []) {
      if (segment[1] !== this.#own) continue;
      if (segment[0] <= column) found = segment;
      else {
        found ??= segment;
        break;
      }
    }
    return found === void 0 ? null : [found[2], found[3]];
  }
};

// src/core/code/coverage/map.ts
function mapScript(script, source) {
  const counts = new Counts(script.functions, script.startOffset ?? 0);
  const positions = new PositionMap(source.map);
  const starts = source.lineLengths === void 0 ? lineStarts(source.code) : startsOf(source.lineLengths);
  const { lines, covered } = linesOf(source, starts, positions, counts);
  const functions = /* @__PURE__ */ new Map();
  const wrapper = script.startOffset ?? 0;
  for (const fn of script.functions) {
    const own = fn.ranges[0];
    if (own === void 0 || own.startOffset < wrapper) continue;
    const from = positionOf(starts, own.startOffset - wrapper);
    const to = positionOf(starts, Math.max(own.startOffset, own.endOffset - 1) - wrapper);
    const begin = positions.at(from[0], from[1]);
    const end = positions.at(to[0], to[1]);
    if (begin === null || end === null) continue;
    const hit = own.count > 0 ? 1 : 0;
    const entry = [
      begin[0] + 1,
      begin[1],
      end[0] + 1,
      end[1],
      hit
    ];
    functions.set(entry.join(":"), entry);
  }
  return { lines, covered, functions };
}
function linesOf(source, starts, positions, counts) {
  const { code } = source;
  const original = source.lineLengths === void 0 ? null : (source.map?.sourcesContent?.[0] ?? "").split("\n");
  const lines = /* @__PURE__ */ new Set();
  const covered = /* @__PURE__ */ new Set();
  for (let line = 0; line < starts.length; line++) {
    const start = starts[line] ?? 0;
    const text = original === null ? code.slice(start, starts[line + 1] ?? code.length) : "";
    for (const [column, sourceLine, sourceColumn] of positions.segments(line, text)) {
      const at = original === null ? text.charAt(column) : (original[sourceLine] ?? "").charAt(sourceColumn);
      if (CLOSING.test(at)) continue;
      const count = counts.at(start + column);
      if (count === null) continue;
      lines.add(sourceLine);
      if (count > 0) covered.add(sourceLine);
    }
  }
  return { lines, covered };
}
var CLOSING = /^[})\];,]$/;
function lineStarts(code) {
  const starts = [0];
  for (let at = code.indexOf("\n"); at !== -1; at = code.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}
function startsOf(lengths) {
  const starts = [0];
  for (const length of lengths.slice(0, -1)) starts.push((starts.at(-1) ?? 0) + length + 1);
  return starts;
}
function positionOf(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = low + high + 1 >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return [low, offset - (starts[low] ?? 0)];
}

// src/core/code/coverage/record.ts
var BLOB_CACHE_LIMIT = 2e4;
function buildRecord(file, payload, format2, blobs2, skip = () => false) {
  const sources = [];
  const unread = [];
  for (const script of payload) {
    const path = scriptPath(script.url);
    if (path === null || skip(path)) continue;
    const executed = file.sources.get(path);
    if (executed === void 0) continue;
    const blob = blobOf(path, executed, format2, blobs2);
    if (blob === null) {
      unread.push(executed.path);
      continue;
    }
    sources.push(sourceEntry(script, executed, blob));
  }
  return recordOf(sources, unread);
}
function sourceEntry(script, executed, blob) {
  const mapped = mapScript(script, executed);
  return {
    path: executed.path,
    blob,
    lines: bitset(mapped.lines),
    covered: bitset(mapped.covered),
    functions: [...mapped.functions.values()].sort(
      (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]
    )
  };
}
function recordOf(sources, unread) {
  sources.sort((a, b) => compare(a.path, b.path));
  return { v: 1, sources, unread: [...new Set(unread)].sort(compare) };
}
function encodeRecord(record) {
  return deflateRawSync(JSON.stringify(record));
}
function bitset(lines) {
  const bytes = new Uint8Array(lines.size === 0 ? 0 : (Math.max(...lines) >> 3) + 1);
  for (const line of lines) bytes[line >> 3] = (bytes[line >> 3] ?? 0) | 1 << (line & 7);
  return Buffer.from(bytes).toString("base64");
}
function scriptPath(url) {
  if (!url.startsWith("file://") || url.includes("?")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}
function blobOf(path, executed, format2, blobs2) {
  const sha1 = executed.sha1;
  if (sha1 === void 0) return null;
  const known = blobs2.get(sha1);
  if (known !== void 0) return known;
  const content = executed.map?.sourcesContent?.[0];
  for (const read2 of [() => readFileSync(path), () => Buffer.from(content ?? "", "utf8")]) {
    let bytes;
    try {
      bytes = read2();
    } catch {
      continue;
    }
    if (createHash2("sha1").update(bytes).digest("hex") !== sha1) continue;
    const blob = blobHash(bytes, format2);
    if (blobs2.size >= BLOB_CACHE_LIMIT) blobs2.clear();
    blobs2.set(sha1, blob);
    return blob;
  }
  return null;
}

// src/core/code/coverage/own.ts
function ownRecord(root, payload, format2, skip = () => false) {
  const sources = [];
  const unread = [];
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
    else sources.push(sourceEntry(script, executed.source, blobHash(executed.bytes, format2)));
  }
  return recordOf(sources, unread);
}
function ownSource(path, rel, url, cached) {
  const map = cached?.data ?? null;
  if (cached === void 0 || map === null || typeof map.mappings !== "string") {
    return asRun(path, rel);
  }
  if (sourceOf(map, url) !== url) return asRun(path, rel);
  const text = map.sourcesContent?.[0];
  if (typeof text !== "string") return null;
  const source = {
    path: rel,
    code: "",
    map: { mappings: map.mappings, sourcesContent: [text] },
    sha1: void 0,
    lineLengths: cached.lineLengths
  };
  return { source, bytes: Buffer.from(text, "utf8") };
}
function asRun(path, rel) {
  const bytes = read(path);
  if (bytes === null) return null;
  return { source: { path: rel, code: bytes.toString("utf8"), map: null, sha1: void 0 }, bytes };
}
function sourceOf(map, url) {
  const first = map.sources?.[0];
  if (typeof first !== "string") return null;
  try {
    return new URL(first, url).href;
  } catch {
    return null;
  }
}
function read(path) {
  try {
    return readFileSync2(path);
  } catch {
    return null;
  }
}

// src/core/code/coverage/map-worker.ts
var KEEP = 2;
var port = parentPort;
var { format } = workerData;
var blobs = /* @__PURE__ */ new Map();
var runs = /* @__PURE__ */ new Map();
var held = null;
var send = (message) => port?.postMessage(message);
port?.on("message", (message) => {
  try {
    if (message.type === "job") take(message);
    else given(message);
  } catch (error) {
    held = null;
    send({ type: "error", id: message.id, message: String(error) });
  }
});
function runOf(id) {
  const known = runs.get(id);
  if (known !== void 0) return known;
  const run = { given: /* @__PURE__ */ new Map(), absent: /* @__PURE__ */ new Set() };
  runs.set(id, run);
  for (const old of runs.keys()) {
    if (runs.size <= KEEP) break;
    runs.delete(old);
  }
  return run;
}
function take(job) {
  const payload = JSON.parse(readFileSync3(job.payload, "utf8"));
  if (job.ownRoot !== void 0) {
    const record = ownRecord(job.ownRoot, payload, format);
    send({ type: "record", id: job.id, record: encodeRecord(record) });
    return;
  }
  const scripts = [...payload.result];
  const run = runOf(job.sources);
  const paths = /* @__PURE__ */ new Set();
  for (const script of scripts) {
    const path = scriptPath(script.url);
    if (path !== null && !run.given.has(path) && !run.absent.has(path)) paths.add(path);
  }
  held = { job, scripts };
  if (paths.size > 0) send({ type: "need", id: job.id, paths: [...paths] });
  else finish();
}
function given(answer) {
  const run = runOf(answer.sources);
  for (const [path, source] of answer.given) run.given.set(path, source);
  for (const path of answer.absent) run.absent.add(path);
  finish();
}
function finish() {
  if (held === null) return;
  const { job, scripts } = held;
  held = null;
  const file = { testFile: job.testFile, payload: job.payload, sources: runOf(job.sources).given };
  send({
    type: "record",
    id: job.id,
    record: encodeRecord(buildRecord(file, scripts, format, blobs))
  });
}
