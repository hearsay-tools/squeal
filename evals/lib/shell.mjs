// Shell text as an agent wrote it, split into simple commands (spec 006 D4). Not a shell: enough
// to find each command of a chain (`a && b; c | d`, subshells, `$(...)`), its words with quoted
// text kept whole, its redirections and its heredoc bodies. Codex wraps every command in
// `/bin/bash -lc '<script>'`; `simpleCommands` unwraps any `sh -c`-style wrapper and splits its
// script the same way, which the 005-06 prototype's regular expressions over raw text did not.

const SEPARATORS = new Set([";", "&", "|", "(", ")", "`", "\n"]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until"]);
const KEYWORDS_ALSO = new Set(["!", "{", "}", "time", "command", "exec", "builtin"]);

/**
 * The simple commands in `text`, in order: `{ words, redirects, heredocs }`. Words have their
 * quotes removed; leading `VAR=value` assignments, shell keywords and wrappers such as `timeout`,
 * `env` and `nice` are dropped; `bash -lc '<script>'` (any shell, any `-c` flag cluster) becomes
 * the commands of its script.
 */
export function simpleCommands(text) {
  return tokenize(String(text)).flatMap((c) => {
    const words = strip(c.words);
    const script = shellScript(words);
    if (script !== null) return simpleCommands(script);
    return words.length ? [{ words, redirects: c.redirects, heredocs: c.heredocs }] : [];
  });
}

function shellScript(words) {
  if (!/^(?:.*\/)?(?:ba|z|da)?sh$/.test(words[0] ?? "")) return null;
  const i = words.findIndex((w, j) => j > 0 && /^-[a-z]*c[a-z]*$/.test(w));
  return i > 0 && words[i + 1] !== undefined ? words[i + 1] : null;
}

function strip(words) {
  let i = 0;
  for (;;) {
    const w = words[i];
    if (w === undefined) return [];
    if (/^[A-Za-z_]\w*=/.test(w) || KEYWORDS.has(w) || KEYWORDS_ALSO.has(w)) i++;
    else if (w === "env" || w === "nice") {
      i++;
      while (/^-|^[A-Za-z_]\w*=/.test(words[i] ?? "")) i++;
    } else if (w === "timeout") {
      i++;
      while (/^-/.test(words[i] ?? "")) i++;
      i++; // the duration
    } else return words.slice(i);
  }
}

/** Splits shell text into raw commands. Exported for tests through `simpleCommands` only. */
function tokenize(s) {
  const commands = [];
  let cmd = newCommand();
  let word = null;
  let pendingRedirect = null;
  const heredocQueue = [];
  const endWord = () => {
    if (word === null) return;
    if (pendingRedirect !== null) {
      if (pendingRedirect.op.startsWith("<<") && pendingRedirect.op !== "<<<") {
        heredocQueue.push({ delimiter: word, strip: pendingRedirect.op === "<<-", cmd });
      } else cmd.redirects.push({ op: pendingRedirect.op, target: word });
      pendingRedirect = null;
    } else cmd.words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (cmd.words.length || cmd.redirects.length) commands.push(cmd);
    cmd = newCommand();
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      if (s[i + 1] === "\n") i++;
      else word = (word ?? "") + (s[++i] ?? "");
    } else if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      const stop = end < 0 ? s.length : end;
      word = (word ?? "") + s.slice(i + 1, stop);
      i = stop;
    } else if (ch === '"') {
      let text = "";
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === "\\" && /["\\$`\n]/.test(s[i + 1] ?? "")) text += s[++i] === "\n" ? "" : s[i];
        else text += s[i];
      }
      word = (word ?? "") + text;
    } else if (ch === "#" && word === null) {
      while (i + 1 < s.length && s[i + 1] !== "\n") i++;
    } else if (ch === " " || ch === "\t" || ch === "\r") endWord();
    else if (ch === "$" && s[i + 1] === "(") {
      endCommand();
      i++;
    } else if (ch === ">" || (ch === "<" && s[i + 1] !== "(")) {
      if (word !== null && /^\d+$/.test(word)) word = null; // the fd in `2>`
      endWord();
      let op = ch;
      while (/[<>&|-]/.test(s[i + 1] ?? "") && op.length < 3) op += s[++i];
      if (/^>&\d?$|^<&/.test(op) || /^>&$/.test(op)) {
        // `>&2`, `2>&1`: a duplicated fd, no file
        while (/\d|-/.test(s[i + 1] ?? "")) i++;
      } else pendingRedirect = { op: op.replace(/&$/, "") || ">" };
    } else if (ch === "&" && s[i + 1] === ">") {
      endWord();
      i++;
      if (s[i + 1] === ">") i++;
      pendingRedirect = { op: ">" };
    } else if (SEPARATORS.has(ch)) {
      endCommand();
      if ((ch === "&" || ch === "|") && s[i + 1] === ch) i++;
      if (ch === "\n" && heredocQueue.length) i = readHeredocs(s, i + 1, heredocQueue) - 1;
    } else word = (word ?? "") + ch;
  }
  endCommand();
  return commands;
}

function newCommand() {
  return { words: [], redirects: [], heredocs: [] };
}

/** Reads the queued heredoc bodies starting at `start`; returns the index after the last one. */
function readHeredocs(s, start, queue) {
  let i = start;
  while (queue.length) {
    const h = queue.shift();
    const lines = [];
    for (;;) {
      if (i >= s.length) break;
      const nl = s.indexOf("\n", i);
      const line = s.slice(i, nl < 0 ? s.length : nl);
      i = nl < 0 ? s.length : nl + 1;
      if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delimiter) break;
      lines.push(line);
    }
    h.cmd.heredocs.push(lines.join("\n"));
  }
  return i;
}
