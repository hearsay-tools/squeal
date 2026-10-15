// Whether a child Node would run a `--require` preload, which runs before the
// recorder's `--import` (spec 001 D11 Fidelity; task 001-390; review 001-401,
// B2). Only what Node reads as an option counts: a `NODE_OPTIONS` token as
// Node splits it, an argument in Node's option region (before its entry, its
// `--` or its first other word), a Worker's `execArgv`, and the same in a
// shell's command as the shell passes words on. A `-r` after a child's entry
// is its program's, and `rm -r` is no Node's.
//
// Policy where the command cannot be read for certain (an expansion such as
// `$FLAGS`, a here-document, an unterminated quote, `cmd.exe`): a `-r` or
// `--require` anywhere in what could be Node's options counts. A `--require`
// recorder loses no reads; it costs only a parse of the nearest
// `package.json`, which a plain Node child does not make.
"use strict";

/** Node's options that take their value as the next argument (`node --help`, 24.21.0). */
const VALUED = new Set(
  [
    "-C --conditions -e --eval -p --print -pe --import --loader --experimental-loader",
    "--input-type --env-file --env-file-if-exists --title --inspect-port --debug-port",
    "--allow-fs-read --allow-fs-write --build-snapshot-config --cpu-prof-dir --cpu-prof-interval",
    "--cpu-prof-name --diagnostic-dir --disable-proto --disable-warning --dns-result-order",
    "--experimental-config-file --experimental-package-map --experimental-policy",
    "--experimental-sea-config --heap-prof-dir --heap-prof-interval --heap-prof-name",
    "--heapsnapshot-near-heap-limit --heapsnapshot-signal --icu-data-dir --inspect-publish-uid",
    "--localstorage-file --max-http-header-size --network-family-autoselection-attempt-timeout",
    "--openssl-config --policy-integrity --redirect-warnings --report-dir --report-directory",
    "--report-filename --report-signal --run --secure-heap --secure-heap-min --snapshot-blob",
    "--test-concurrency --test-global-setup --test-name-pattern --test-reporter",
    "--test-reporter-destination --test-shard --test-skip-pattern --test-timeout --tls-cipher-list",
    "--tls-keylog --trace-event-categories --trace-event-file-pattern --unhandled-rejections",
    "--use-largepages --v8-pool-size --watch-kill-signal --watch-path",
  ]
    .join(" ")
    .split(" "),
);
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "mksh", "ash"]);
const NODES = new Set(["node", "nodejs", "node.exe"]);
/** A `-r` or `--require` word anywhere: the unreadable forms' policy. */
const LOOSE = /(?:^|[\s"'])(?:--require|-r)(?:[\s="']|$)/;

const base = (word) => word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1);
const isNode = (word) => word === process.execPath || NODES.has(base(word).toLowerCase());
const isRequire = (word) =>
  word === "-r" || word === "--require" || word.startsWith("--require=") || word.startsWith("-r=");

/**
 * `NODE_OPTIONS` split as Node splits it (`tokenizeNodeOptions` in
 * `node-options.ts`), or `null` where Node reports an error.
 */
function tokenizeNodeOptions(value) {
  const tokens = [];
  let quoted = false;
  let fresh = true;
  for (let i = 0; i < value.length; i++) {
    let c = value[i];
    if (c === "\\" && quoted) {
      if (i + 1 === value.length) return null;
      c = value[++i];
    } else if (c === " " && !quoted) {
      fresh = true;
      continue;
    } else if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (fresh) tokens.push(c);
    else tokens[tokens.length - 1] += c;
    fresh = false;
  }
  return quoted ? null : tokens;
}

/** A token as `NODE_OPTIONS` reads it back (`quoteNodeOption` where it must). */
const asWritten = (token) => (/[ "]/.test(token) ? `"${token.replace(/["\\]/g, "\\$&")}"` : token);

/**
 * Whether Node's option region of `words`, each `{ text, expands }`, holds a
 * `--require`. A word that may expand, or follows an option Node's help does
 * not list, could be an option or its value, so the scan goes on past it.
 */
function regionRequires(words) {
  let unsure = false;
  for (let i = 0; i < words.length; i++) {
    const { text, expands } = words[i];
    if (expands) {
      unsure = true;
      continue;
    }
    if (text === "--") return false;
    if (!text.startsWith("-") || text === "-") {
      if (!unsure) return false;
      unsure = false;
      continue;
    }
    if (isRequire(text)) return true;
    const valued = VALUED.has(text);
    if (valued) i++;
    unsure = !valued && text.startsWith("--") && !text.includes("=");
  }
  return false;
}

/** Whether a command's `words`, the first a Node or one that may expand to it, hold a `--require`. */
function commandRequires(words) {
  const at = words.findIndex((w) => !w.expands && isNode(w.text));
  if (at !== -1) return regionRequires(words.slice(at + 1));
  return words.length > 0 && words[0].expands && regionRequires(words.slice(1));
}

/**
 * A POSIX shell command split into simple commands of words as the shell
 * passes them on: quotes removed, redirections dropped, an expansion marked
 * `expands`; `null` for what this does not read (a here-document, an
 * unterminated quote).
 */
function shellCommands(text) {
  const commands = [[]];
  let word = null;
  let expands = false;
  let target = false;
  const end = () => {
    if (word !== null && !target) commands[commands.length - 1].push({ text: word, expands });
    if (word !== null) target = false;
    word = null;
    expands = false;
  };
  const split = () => {
    end();
    if (commands[commands.length - 1].length > 0) commands.push([]);
  };
  const add = (s) => {
    word = (word ?? "") + s;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) return null;
      add(text.slice(i + 1, close));
      i = close;
    } else if (c === '"') {
      let j = i + 1;
      let s = "";
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === "\\" && '"\\$`\n'.includes(text[j + 1] ?? "")) s += text[++j];
        else {
          if (text[j] === "$" || text[j] === "`") expands = true;
          s += text[j];
        }
      }
      if (j >= text.length) return null;
      add(s);
      i = j;
    } else if (c === "\\") {
      if (i + 1 < text.length && text[i + 1] !== "\n") add(text[i + 1]);
      i++;
    } else if (c === "$" || c === "`") {
      expands = true;
      add(c);
    } else if (c === " " || c === "\t") {
      end();
    } else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      split();
    } else if (c === "<" || c === ">") {
      // `2>&1`, `>out`, `>> out`, `<in`: never a word of the command
      if (word !== null && /^\d+$/.test(word) && !expands) word = null;
      else end();
      let j = i + 1;
      while (j < text.length && /[<>&|-]/.test(text[j])) j++;
      if (text.slice(i, j).startsWith("<<")) return null;
      if (text[j - 1] === "&") while (j < text.length && /[\d-]/.test(text[j])) j++;
      else target = true;
      i = j - 1;
    } else if (c === "#" && word === null) {
      const newline = text.indexOf("\n", i);
      i = newline === -1 ? text.length : newline - 1;
    } else add(c);
  }
  end();
  return commands.filter((words) => words.length > 0);
}

/** Whether a shell running `command` would start a Node with a `--require`. */
function shellRequires(command) {
  const commands = shellCommands(command);
  if (commands === null) return LOOSE.test(command);
  return commands.some(commandRequires);
}

const plain = (args) => args.map((text) => ({ text: String(text), expands: false }));

/**
 * Whether running `file` with `args` (no `argv[0]`) starts a Node with a
 * `--require`: Node itself, a program that runs a Node it names (`env node`,
 * `npx node`), or a shell given a command with `-c`.
 */
function spawnRequires(file, args) {
  if (typeof file !== "string") return false;
  const strings = args.filter((a) => typeof a === "string");
  const name = base(file).toLowerCase();
  if (SHELLS.has(name)) {
    const at = strings.findIndex((a) => /^-[a-z]*c[a-z]*$/i.test(a));
    return at !== -1 && typeof strings[at + 1] === "string" && shellRequires(strings[at + 1]);
  }
  if (name === "cmd" || name === "cmd.exe") return strings.some((a) => LOOSE.test(a));
  return commandRequires(plain([file, ...strings]));
}

/** Whether a Worker's `execArgv`, all options, holds a `--require`. */
const optionsRequire = (execArgv) => regionRequires(plain(execArgv));

module.exports = {
  asWritten,
  optionsRequire,
  shellRequires,
  spawnRequires,
  tokenizeNodeOptions,
  isRequire,
};
