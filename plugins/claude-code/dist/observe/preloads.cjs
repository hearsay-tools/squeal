// Whether a child Node would run a `--require` preload, which runs before the
// recorder's `--import` (spec 001 D11 Fidelity; task 001-390; reviews 001-401
// and wave-13bt, B2). Only what Node reads as an option counts: a
// `NODE_OPTIONS` token as Node splits it, an argument in Node's option region
// (before its entry, its `--` or its first other word), a Worker's
// `execArgv`, and the same for a Node in a shell command's command position
// as the shell passes its words on. A `-r` after a child's entry is its
// program's, and `printf %s node -r` or `rm -r` runs no Node's.
//
// A false `--require` changes a verdict (Node parses the nearest
// `package.json` for it), a false `--import` only loses the preload's reads.
// So where a command cannot be read for certain before it runs (an expansion
// such as `$FLAGS` or `"$(printf %s -r)"` in Node's options, a word that may
// split or glob, an unterminated quote, a wrapper's option this does not know,
// `cmd.exe`), the answer is no: the recorder stays an `--import`.
"use strict";

/**
 * Node's options that take the next argument as their value, without `=`
 * (`getCLIOptionsInfo` of 22.23.3 and 24.21.0: every string, number, host and
 * list option, and their aliases). Every other option is boolean: a V8 option
 * takes its value only after `=`, and one Node does not know makes it exit 9
 * with or without the recorder.
 */
const VALUED = new Set(
  [
    "-C --conditions -e --eval -p --print -pe --import --loader --experimental-loader",
    "--allow-fs-read --allow-fs-write --build-snapshot-config --cpu-prof-dir --cpu-prof-interval",
    "--cpu-prof-name --debug-port --diagnostic-dir --disable-proto --disable-warning",
    "--dns-result-order --env-file --env-file-if-exists --experimental-config-file",
    "--experimental-default-config-file --experimental-default-type --experimental-package-map",
    "--experimental-policy --experimental-sea-config --experimental-test-isolation",
    "--experimental-test-tag-filter --heap-prof-dir --heap-prof-interval --heap-prof-name",
    "--heapsnapshot-near-heap-limit --heapsnapshot-signal --icu-data-dir --input-type",
    "--inspect-port --inspect-publish-uid --localstorage-file --max-http-header-size",
    "--max-old-space-size-percentage --network-family-autoselection-attempt-timeout",
    "--openssl-config --policy-integrity --redirect-warnings --report-dir --report-directory",
    "--report-filename --report-signal --run --secure-heap --secure-heap-min --security-revert",
    "--security-reverts --snapshot-blob --stack-trace-limit --test-concurrency",
    "--test-coverage-branches --test-coverage-exclude --test-coverage-functions",
    "--test-coverage-include --test-coverage-lines --test-global-setup --test-isolation",
    "--test-name-pattern --test-random-seed --test-reporter --test-reporter-destination",
    "--test-rerun-failures --test-shard --test-skip-pattern --test-timeout --title",
    "--tls-cipher-list --tls-keylog --trace-event-categories --trace-event-file-pattern",
    "--trace-require-module --unhandled-rejections --use-largepages --v8-pool-size",
    "--watch-kill-signal --watch-path",
  ]
    .join(" ")
    .split(" "),
);
const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "mksh", "ash"]);
const NODES = new Set(["node", "nodejs", "node.exe"]);
/**
 * Programs that run the command after their options, each option they take
 * alone and each that takes the next word; any other option, unread.
 */
const WRAPPERS = new Map([
  [
    "env",
    {
      flags: ["-i", "-", "--ignore-environment", "-0", "--null", "-v", "--debug"],
      valued: ["-u", "--unset", "-C", "--chdir"],
    },
  ],
  ["exec", { flags: ["-c", "-l"], valued: ["-a"] }],
  ["command", { flags: ["-p"], valued: [] }],
  ["nohup", { flags: [], valued: [] }],
  ["npx", { flags: [], valued: [] }],
]);
/** A shell's reserved words that a command may follow. */
const RESERVED = new Set(["!", "{", "if", "then", "else", "elif", "while", "until", "do", "time"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

const base = (word) => word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1);
const isNode = (word) => word === process.execPath || NODES.has(base(word).toLowerCase());
const isRequire = (word) =>
  word === "-r" || word === "--require" || word.startsWith("--require=") || word.startsWith("-r=");
/** An option's name as Node looks it up: `_` read as `-`. */
const nameOf = (word) => (word.startsWith("--") ? word.replace(/_/g, "-") : word);

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
 * Whether Node's option region of `words`, each `{ text, known, single }`,
 * holds a `--require`: `known` when the shell's expansions cannot change its
 * text, `single` when it stays one word. A word not both where an option may
 * stand, or not single where a value does, ends the reading with no.
 */
function regionRequires(words) {
  for (let i = 0; i < words.length; i++) {
    const { text, known, single } = words[i];
    if (!known || !single || text === "--" || text === "--prof-process") return false;
    // the entry: what follows is the program's
    if (!text.startsWith("-") || text === "-") return false;
    if (isRequire(nameOf(text))) return true;
    if (!text.includes("=") && VALUED.has(nameOf(text))) {
      i++;
      if (i < words.length && !words[i].single) return false;
    }
  }
  return false;
}

/**
 * Whether a command's `words` start a Node with a `--require`: the Node in
 * command position, after assignments, a shell's reserved words and the
 * programs that run a command (`env node`, `npx node`).
 */
function commandRequires(words) {
  let i = 0;
  const known = () => i < words.length && words[i].known;
  while (known() && (ASSIGNMENT.test(words[i].text) || RESERVED.has(words[i].text))) i++;
  while (known() && WRAPPERS.has(base(words[i].text))) {
    const name = base(words[i].text);
    const wrapper = WRAPPERS.get(name);
    i++;
    for (; known() && words[i].text.startsWith("-"); i++) {
      const { text } = words[i];
      if (text === "--") {
        i++;
        break;
      }
      if (wrapper.valued.includes(text)) i++;
      else if (
        !wrapper.flags.includes(text) &&
        !wrapper.valued.some((v) => text.startsWith(`${v}=`))
      )
        return false;
    }
    while (name === "env" && known() && ASSIGNMENT.test(words[i].text)) i++;
  }
  return known() && words[i].single && isNode(words[i].text) && regionRequires(words.slice(i + 1));
}

/**
 * A POSIX shell command split into simple commands of words as the shell
 * passes them on: quotes removed, redirections and here-document bodies
 * dropped, each word `known` unless it expands and `single` unless an
 * unquoted expansion or pattern may make it none or several; `null` for what
 * this does not read (an unterminated quote or here-document).
 */
function shellCommands(text) {
  const commands = [[]];
  let word = null;
  let known = true;
  let single = true;
  let target = false;
  /** The here-documents whose bodies start at the next newline: `[delimiter, tabs stripped]`. */
  let heredocs = [];
  const end = () => {
    if (word !== null && !target) commands[commands.length - 1].push({ text: word, known, single });
    if (word !== null) target = false;
    word = null;
    known = true;
    single = true;
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
          if (text[j] === "$" || text[j] === "`") known = false;
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
      known = false;
      single = false;
      add(c);
    } else if (c === "*" || c === "?" || c === "[" || c === "{") {
      single = false;
      add(c);
    } else if (c === " " || c === "\t") {
      end();
    } else if (c === "\n") {
      split();
      for (const [delimiter, tabs] of heredocs) {
        for (;;) {
          if (i + 1 >= text.length) return null;
          const next = text.indexOf("\n", i + 1);
          const line = text.slice(i + 1, next === -1 ? text.length : next);
          i = next === -1 ? text.length : next;
          if ((tabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
        }
      }
      heredocs = [];
    } else if (c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      split();
    } else if (c === "<" || c === ">") {
      // `2>&1`, `>out`, `>> out`, `<in`, `<<EOF`: never a word of the command
      if (word !== null && /^\d+$/.test(word) && known) word = null;
      else end();
      let j = i + 1;
      while (j < text.length && /[<>&|]/.test(text[j])) j++;
      const operator = text.slice(i, j);
      if (operator === "<<") {
        const tabs = text[j] === "-";
        if (tabs) j++;
        while (text[j] === " " || text[j] === "\t") j++;
        const start = j;
        while (j < text.length && !/[\s;&|<>()]/.test(text[j])) j++;
        const delimiter = text.slice(start, j).replace(/["'\\]/g, "");
        if (delimiter === "") return null;
        heredocs.push([delimiter, tabs]);
      } else if (operator.endsWith("&") && operator !== "&") {
        while (j < text.length && /[\d-]/.test(text[j])) j++;
      } else target = true;
      i = j - 1;
    } else if (c === "#" && word === null) {
      const newline = text.indexOf("\n", i);
      i = newline === -1 ? text.length : newline - 1;
    } else add(c);
  }
  end();
  return heredocs.length > 0 ? null : commands.filter((words) => words.length > 0);
}

/** Whether a shell running `command` would start a Node with a `--require`; no where it is unread. */
function shellRequires(command) {
  const commands = shellCommands(command);
  return commands?.some(commandRequires) ?? false;
}

const plain = (args) => args.map((text) => ({ text: String(text), known: true, single: true }));

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
  // `cmd.exe`'s command is not read
  if (name === "cmd" || name === "cmd.exe") return false;
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
