// 011-162 probe, not product code (decision Q5, the reader). A line reader for the three parts
// of pnpm's installed `lock.yaml` a key reads (`importers`, each package's integrity, each
// snapshot's edges), compared with the `yaml` package's parse of the same file: equal output,
// and the time of each, best of 5.
//   node lockread.mjs <install-root>...
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/** `null` for a layout it does not know: the caller keeps the whole fingerprint. */
export function readLock(text) {
  const out = { importers: {}, integrity: {}, snapshots: {} };
  let section = null;
  let first = null;
  let second = null;
  let third = null;
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.slice(indent);
    if (indent === 0) {
      section = body.endsWith(":") ? body.slice(0, -1) : null;
      if (section === "lockfileVersion" || body.startsWith("lockfileVersion:")) {
        if (!/^lockfileVersion: '?9\.\d+'?$/.test(body)) return null;
      }
      continue;
    }
    if (section !== "importers" && section !== "packages" && section !== "snapshots") continue;
    // A sequence item (`transitivePeerDependencies`, `cpu`, `os`): no part a key reads.
    if (body.startsWith("- ")) {
      if (indent < 6) return null;
      continue;
    }
    const pair = split(body);
    if (pair === null) return null;
    const [key, value] = pair;
    if (indent === 2) {
      first = key;
      if (section === "importers") out.importers[key] = {};
      if (section === "snapshots") out.snapshots[key] = {};
      if (value !== "" && value !== "{}") return null;
    } else if (indent === 4) {
      second = key;
      if (section === "packages" && key === "resolution") {
        const integrity = /(?:^|[{,]\s*)integrity:\s*([^,}\s]+)/.exec(value)?.[1];
        if (integrity !== undefined) out.integrity[first] = integrity;
      } else if (section === "importers" || section === "snapshots") {
        if (value !== "") continue;
        (section === "importers" ? out.importers : out.snapshots)[first][key] = {};
      }
    } else if (indent === 6) {
      third = key;
      if (section === "snapshots" && second in out.snapshots[first]) out.snapshots[first][second][key] = value;
      if (section === "importers" && second in out.importers[first]) out.importers[first][second][key] = {};
    } else if (indent === 8 && section === "importers" && second in out.importers[first]) {
      out.importers[first][second][third][key] = value;
    }
  }
  return out;
}

/** `key: value` with YAML's plain, single- and double-quoted scalars; `null` otherwise. */
function split(body) {
  let key;
  let rest;
  if (body.startsWith("'")) {
    const end = /'(?!')/g;
    end.lastIndex = 1;
    let at = -1;
    for (let i = 1; i < body.length; i++) {
      if (body[i] === "'" && body[i + 1] === "'") i++;
      else if (body[i] === "'") {
        at = i;
        break;
      }
    }
    if (at === -1) return null;
    key = body.slice(1, at).replaceAll("''", "'");
    rest = body.slice(at + 1);
  } else if (body.startsWith('"')) {
    return null;
  } else {
    const at = body.indexOf(":");
    if (at === -1) return null;
    key = body.slice(0, at);
    rest = body.slice(at);
  }
  if (!rest.startsWith(":")) return null;
  return [key, unquote(rest.slice(1).trim())];
}

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** The same three parts from the `yaml` package's parse. */
function fromYaml(lock) {
  const out = { importers: {}, integrity: {}, snapshots: {} };
  for (const [path, importer] of Object.entries(lock.importers ?? {})) {
    out.importers[path] = {};
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (importer[field] === undefined) continue;
      out.importers[path][field] = Object.fromEntries(
        Object.entries(importer[field]).map(([n, s]) => [n, { specifier: String(s.specifier), version: String(s.version) }]),
      );
    }
  }
  for (const [id, entry] of Object.entries(lock.packages ?? {})) {
    if (entry?.resolution?.integrity !== undefined) out.integrity[id] = entry.resolution.integrity;
  }
  for (const [id, entry] of Object.entries(lock.snapshots ?? {})) {
    out.snapshots[id] = {};
    for (const field of ["dependencies", "optionalDependencies"]) {
      if (entry?.[field] !== undefined) {
        out.snapshots[id][field] = Object.fromEntries(Object.entries(entry[field]).map(([n, r]) => [n, String(r)]));
      }
    }
  }
  return out;
}

/** The line reader keeps every importer field; compare only those the key reads. */
function keyFields(read) {
  const importers = {};
  for (const [path, importer] of Object.entries(read.importers)) {
    importers[path] = {};
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (importer[field] !== undefined) importers[path][field] = importer[field];
    }
  }
  const snapshots = {};
  for (const [id, entry] of Object.entries(read.snapshots)) {
    snapshots[id] = {};
    for (const field of ["dependencies", "optionalDependencies"]) {
      if (entry[field] !== undefined) snapshots[id][field] = entry[field];
    }
  }
  return { importers, integrity: read.integrity, snapshots };
}

function best(fn) {
  let ms = Infinity;
  let value;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    value = fn();
    ms = Math.min(ms, performance.now() - t);
  }
  return [value, Math.round(ms * 10) / 10];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const root of process.argv.slice(2)) {
    const text = readFileSync(join(root, "node_modules/.pnpm/lock.yaml"), "utf8");
    const [lines, linesMs] = best(() => readLock(text));
    const [yaml, yamlMs] = best(() => fromYaml(parse(text)));
    const equal = lines !== null && JSON.stringify(keyFields(lines)) === JSON.stringify(yaml);
    console.log(JSON.stringify({ root, bytes: text.length, snapshots: Object.keys(yaml.snapshots).length, equal, lineReaderMs: linesMs, yamlMs }));
  }
}
