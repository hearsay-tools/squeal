import { basename } from "node:path";
import { parse } from "smol-toml";
import type { PytestConfigFile } from "./config.js";
import { readOptional } from "./site.js";

/**
 * One key of the project's pytest config as pytest reads it
 * (`_pytest/config/findpaths.py` `load_config_dict_from_file`, pytest
 * 9.1.1): a string in ini mode (`.ini`, `setup.cfg`, a TOML
 * `ini_options` scalar), a list of strings from a TOML `ini_options` list,
 * and the native TOML value in TOML mode (`pytest.toml`, `[tool.pytest]`).
 */
export type PytestConfigValue = string | readonly string[] | unknown;

/**
 * Spec 007 D1: "Its `testpaths`, `python_files`, `python_classes`,
 * `python_functions`, `addopts` and `pythonpath` are read for D3 and D6;
 * pytest still applies them itself." `undefined` when the file does not set
 * the key or holds no pytest config (a fallback `pyproject.toml`), and when
 * it cannot be read or parsed, which pytest reports itself.
 */
export function readConfigValue(
  config: PytestConfigFile,
  key: string,
  text: string | null = readOptional(config.path),
): PytestConfigValue | undefined {
  if (text === null || config.holds === "fallback") return undefined;
  const name = basename(config.path);
  if (name.endsWith(".toml")) return tomlValue(name, text, key);
  const section = name === "setup.cfg" ? "tool:pytest" : "pytest";
  return iniSections(text).get(section)?.get(key);
}

/**
 * A value of pytest's `args` ini type (`addopts`, `testpaths`,
 * `python_files`): a string split as `shlex.split` does, a list as it is.
 * `null` when the value is neither, or a string with an open quote.
 */
export function configArgs(value: PytestConfigValue | undefined): readonly string[] | null {
  if (value === undefined) return [];
  if (typeof value === "string") return shellSplit(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  return null;
}

function tomlValue(name: string, text: string, key: string): unknown {
  let doc: Record<string, unknown>;
  try {
    doc = parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const table =
    name === "pytest.toml" || name === ".pytest.toml"
      ? doc.pytest
      : (doc.tool as Record<string, unknown> | undefined)?.pytest;
  if (!isTable(table)) return undefined;
  const ini = table.ini_options;
  if (isTable(ini) && Object.keys(table).length === 1) {
    const value = ini[key];
    // ini mode: scalars become strings, lists stay lists.
    return value === undefined || Array.isArray(value) ? value : String(value);
  }
  return table[key];
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `iniconfig` as pytest calls it: `name = value` or `name: value` at column
 * 0, indented continuation lines joined with a newline, whole-line `#` and
 * `;` comments, no inline comments.
 */
function iniSections(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let section: Map<string, string> | null = null;
  let last: { values: Map<string, string>; name: string } | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const first = raw.trimStart()[0];
    if (first === undefined || first === "#" || first === ";") continue;
    const line = raw.trimEnd();
    if (line.startsWith("[")) {
      const header = line.split("#")[0]?.split(";")[0]?.trimEnd() ?? "";
      if (header.endsWith("]")) {
        section = new Map();
        sections.set(header.slice(1, -1), section);
        last = null;
        continue;
      }
    }
    if (/^\s/.test(line)) {
      if (last !== null) {
        const before = last.values.get(last.name) ?? "";
        last.values.set(last.name, before === "" ? line.trim() : `${before}\n${line.trim()}`);
      }
      continue;
    }
    const eq = line.indexOf("=");
    const at = eq >= 0 && !line.slice(0, eq).includes(":") ? eq : line.indexOf(":");
    if (at < 0 || section === null) continue;
    const name = line.slice(0, at).trim();
    section.set(name, line.slice(at + 1).trim());
    last = { values: section, name };
  }
  return sections;
}

/**
 * Python's `shlex.split` in POSIX mode: white space separates, single
 * quotes keep everything, double quotes let a backslash escape `"` and `\`,
 * a backslash outside quotes escapes any character. `null` on an open quote.
 */
export function shellSplit(text: string): readonly string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? "") + text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      word ??= "";
      for (i++; ; i++) {
        if (i >= text.length) return null;
        const d = text[i] as string;
        if (d === '"') break;
        const next = text[i + 1];
        if (d === "\\" && (next === '"' || next === "\\")) {
          word += next;
          i++;
        } else word += d;
      }
    } else if (c === "\\") {
      if (i + 1 < text.length) word = (word ?? "") + text[++i];
    } else word = (word ?? "") + c;
  }
  if (word !== null) words.push(word);
  return words;
}
