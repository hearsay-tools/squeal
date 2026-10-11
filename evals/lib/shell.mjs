// Shell text as an agent wrote it, split into simple commands (spec 006 D4). Not a shell: enough
// to find each command of a chain (`a && b; c | d`, subshells, `$(...)`), its words with quoted
// text kept whole, its redirections and its heredoc bodies. Codex wraps every command in
// `/bin/bash -lc '<script>'`; `simpleCommands` unwraps any `sh -c`-style wrapper and splits its
// script the same way, which the 005-06 prototype's regular expressions over raw text did not.
// Review wave 1, B2: each command also says whether it is established to have run, from the
// chain's operators, the blocks around it and the call's exit code. Review wave 1.5, B2: and
// whether an earlier `exit` or `exec`, or a failure under `set -e`, ends the shell before it.
// Review wave 1.6, B2: under `set -e` only a bare `true` or `:` is sure not to fail.

const SEPARATORS = new Set([";", "&", "|", "(", ")", "`", "\n"]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until"]);
const KEYWORDS_ALSO = new Set(["!", "{", "}", "time", "command", "exec", "builtin"]);
/** A block's keywords: those that open it, enter a body that may not run, and close it. */
const OPENS = new Set(["if", "while", "until", "for", "select", "case"]);
const BODIES = new Set(["then", "else", "elif", "do"]);
const CLOSES = new Set(["fi", "done", "esac"]);
const SHELL = /^(?:.*\/)?(?:ba|z|da)?sh$/;

/**
 * The simple commands in `text`, in the order they run: `{ words, redirects, heredocs,
 * established }`. Words have their quotes removed; leading `VAR=value` assignments, shell keywords
 * and wrappers such as `timeout`, `env` and `nice` are dropped; `bash -lc '<script>'` (any shell,
 * any `-c` flag cluster) and a shell reading a heredoc become the commands of their script. A
 * command substitution comes before the command holding it.
 *
 * `established` is `true` only for a command that ran whenever the text ran: not behind `&&` or
 * `||`, not in an `if`, loop or `case` body, not after a command that may have ended its shell.
 * `exit`, the call's exit code, establishes the last list of a chain: all of an `&&` chain when it
 * is 0, all of an `||` chain when it is not. `unreachable` is `true` for a command after an
 * established `exit` or `exec` of its shell: it never ran. After an `exit` or `exec` that may not
 * have run, or after a command that can fail while `set -e` (`set -o errexit`, `bash -e`) may be
 * on, a command is neither.
 */
export function simpleCommands(text, { exit = null, errexit = false } = {}) {
  const { commands, top } = tokenize(String(text));
  settle(top, exit);
  walk(top, errexit);
  const solo = commands.length === 1;
  return commands.flatMap((c, i) => {
    const established = isEstablished(c.el);
    const unreachable = isUnreachable(c.el);
    const words = strip(c.words);
    const script = shellScript(words, c, commands[i - 1]);
    if (script !== null) {
      const inner = { exit: solo ? exit : null, errexit: errexitFlags(words) };
      return simpleCommands(script, inner).map((ic) => ({
        ...ic,
        established: established && ic.established,
        unreachable: unreachable || ic.unreachable,
      }));
    }
    return words.length
      ? [{ words, redirects: c.redirects, heredocs: c.heredocs, established, unreachable }]
      : [];
  });
}

/** Whether a shell's own flags turn errexit on: `bash -e -c`, `sh -ec`, `bash -o errexit`. */
function errexitFlags(words) {
  const end = words.findIndex((w, j) => j > 0 && !w.startsWith("-") && words[j - 1] !== "-o");
  const flags = words.slice(1, end < 0 ? words.length : end);
  return flags.some(
    (w, j) => /^-[a-zA-Z]*e[a-zA-Z]*$/.test(w) || (w === "-o" && flags[j + 1] === "errexit"),
  );
}

/** The script a shell command runs: its `-c` argument, or the heredoc it reads on stdin. */
function shellScript(words, c, previous) {
  if (!SHELL.test(words[0] ?? "")) return null;
  const i = words.findIndex((w, j) => j > 0 && /^-[a-z]*c[a-z]*$/.test(w));
  if (i > 0) return words[i + 1] ?? null;
  if (!words.slice(1).every((w) => w.startsWith("-"))) return null; // `bash run.sh`
  if (c.heredocs[0] !== undefined) return c.heredocs[0];
  // `cat <<'EOF' | bash`
  const feeder = previous?.el === c.el && c.piped ? strip(previous.words) : [];
  return feeder[0] === "cat" && previous.heredocs[0] !== undefined ? previous.heredocs[0] : null;
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

/** Marks the text's last list established when the call's exit code proves every part of it ran. */
function settle(top, exit) {
  const last = top.lists.at(-1);
  if (!last || last.background || typeof exit !== "number") return;
  const ops = new Set(last.ops);
  if (ops.size !== 1) return;
  if ((ops.has("&&") && exit === 0) || (ops.has("||") && exit !== 0)) last.settled = true;
}

/**
 * Marks each element of `frame` and the frames inside it with `cut`, what may have ended the
 * shell before it: `none`; `maybe`, an `exit` or `exec` that may have run, or a command that can
 * fail under errexit; `never`, an established `exit` or `exec`. A subshell or substitution is a
 * shell of its own: its `exit` ends only itself, and it inherits errexit.
 */
function walk(frame, errexit) {
  let cut = "none";
  for (const el of frame.els) {
    el.cut = cut;
    for (const f of el.frames) walk(f, errexit);
    if (cut === "never") continue;
    const sure = cut === "none" && !el.block && (el.index === 0 || el.list.settled);
    const only = el.cmds.length === 1 && !el.list.background ? el.cmds[0].words : null;
    const flag = only ? setErrexit(only) : null;
    if (only && ends(only)) {
      cut = sure ? "never" : "maybe";
      continue;
    }
    // A `set` that fails changes nothing, so it ends the shell when errexit was already on.
    if (errexit && el.index === el.list.ops.length && !el.list.background && canFail(el))
      cut = "maybe";
    if (flag !== null) errexit = flag || (errexit && !sure);
  }
}

/** Ends its shell: `exit`, or `exec` running a program in the shell's place (not `exec 2>&1`). */
function ends(words) {
  let i = 0;
  const skip = (w) =>
    /^[A-Za-z_]\w*=/.test(w) || KEYWORDS.has(w) || (KEYWORDS_ALSO.has(w) && w !== "exec");
  while (words[i] !== undefined && skip(words[i])) i++;
  if (words[i] === "exit") return true;
  return words[i] === "exec" && words.slice(i + 1).some((w) => !w.startsWith("-"));
}

/** `set -e` or `set -o errexit`: `true`; `set +e` or `set +o errexit`: `false`; else `null`. */
function setErrexit(words) {
  const w = strip(words);
  if (w[0] !== "set") return null;
  let on = null;
  for (let i = 1; i < w.length && w[i] !== "--" && w[i] !== "-"; i++) {
    if (/^[-+]o$/.test(w[i])) {
      if (w[i + 1] === "errexit") on = w[i][0] === "-";
      i++;
    } else if (/^[-+][a-zA-Z]*e[a-zA-Z]*$/.test(w[i])) on = w[i][0] === "-";
  }
  return on;
}

/** The commands whose status is always 0, bare: no argument, assignment or redirection. */
const NEVER_FAILS = new Set(["true", ":"]);
/** Words that run nothing themselves: a block's keywords and braces, `!` and `time`. */
const INERT = new Set([...KEYWORDS, "!", "{", "}", "time"]);
/**
 * An element that can fail (review wave 1.6, B2): any but a bare `true` or `:`. A subshell or a
 * substitution can fail, a redirection can fail before its command starts, and every other
 * command, `set`, `export` and `unset` among them, can fail on its arguments.
 */
function canFail(el) {
  if (el.frames.length) return true;
  return el.cmds.some((c) => {
    if (c.redirected || c.heredocs.length) return true;
    const w = c.words.filter((x) => !INERT.has(x));
    return w.length > 0 && !(w.length === 1 && NEVER_FAILS.has(w[0]));
  });
}

/** An element ran: first in its list or in a settled list, outside a body, inside one that ran. */
function isEstablished(el) {
  if (el.cut !== "none" || el.block || (el.index > 0 && !el.list.settled)) return false;
  return el.frame.parent === null || isEstablished(el.frame.parent);
}

/** An element never ran: after an established end of its shell, or inside one that never ran. */
function isUnreachable(el) {
  return el.cut === "never" || (el.frame.parent !== null && isUnreachable(el.frame.parent));
}

/**
 * Splits shell text into raw commands, each with its element: `{ frame, list, index, block }`,
 * the pipeline it belongs to, at position `index` of an and-or `list` (`list.ops` holds the
 * `&&` and `||` between them) in a `frame` (the text, or a subshell or substitution run by the
 * element `frame.parent`), `block` when an `if`, loop or `case` body holds it. A frame lists its
 * elements in `els`; an element its commands in `cmds` and the frames it runs in `frames`.
 */
function tokenize(s) {
  const commands = [];
  const top = { parent: null, kind: null, lists: [], els: [] };
  let st = { frame: top, list: null, el: null, op: null };
  const frames = [];
  const blocks = [];
  let cmd = newCommand();
  let word = null;
  let pendingRedirect = null;
  const heredocQueue = [];
  const startEl = () => {
    if (st.op === "|" && st.el) {
      st.op = null;
      return st.el; // a pipeline is one element
    }
    if (st.list === null || (st.op !== "&&" && st.op !== "||")) {
      st.list = { ops: [], background: false, settled: false };
      st.frame.lists.push(st.list);
    } else st.list.ops.push(st.op);
    st.op = null;
    st.el = {
      frame: st.frame,
      list: st.list,
      index: st.list.ops.length,
      block: blocks.some((b) => b.body),
      cmds: [],
      frames: [],
    };
    st.frame.els.push(st.el);
    return st.el;
  };
  const ensureEl = () => {
    if (cmd.el !== null) return;
    cmd.piped = st.op === "|";
    cmd.el = startEl();
  };
  const keyword = (w) => {
    if (OPENS.has(w)) blocks.push({ body: w === "case" });
    if (w === "case") cmd.el.block = true;
    if (BODIES.has(w) && blocks.length) {
      blocks[blocks.length - 1].body = true;
      cmd.el.block = true;
    }
    if (CLOSES.has(w)) blocks.pop();
  };
  const endWord = () => {
    if (word === null) return;
    ensureEl();
    if (pendingRedirect !== null) {
      if (pendingRedirect.op.startsWith("<<") && pendingRedirect.op !== "<<<") {
        heredocQueue.push({ delimiter: word, strip: pendingRedirect.op === "<<-", cmd });
      } else cmd.redirects.push({ op: pendingRedirect.op, target: word });
      pendingRedirect = null;
    } else {
      if (cmd.words.length === 0) keyword(word);
      cmd.words.push(word);
    }
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (cmd.words.length || cmd.redirected) {
      commands.push(cmd);
      cmd.el.cmds.push(cmd);
    }
    cmd = newCommand();
  };
  const endList = (background) => {
    endCommand();
    if (st.list !== null && background) st.list.background = true;
    st = { ...st, list: null, el: null, op: null };
  };
  // A subshell is an element of its own; a substitution runs as part of the command holding it.
  const open = (kind) => {
    let parent;
    if (kind === "(") {
      endCommand();
      parent = startEl();
    } else {
      ensureEl();
      parent = cmd.el;
    }
    frames.push({ kind, st, cmd, word, pendingRedirect });
    const frame = { parent, kind, lists: [], els: [] };
    parent.frames.push(frame);
    st = { frame, list: null, el: null, op: null };
    cmd = newCommand();
    word = null;
    pendingRedirect = null;
  };
  const close = (kind) => {
    endCommand();
    const top = frames.at(-1);
    if (!top || (kind === "`") !== (top.kind === "`")) return; // `x)` of a `case`
    frames.pop();
    ({ st, cmd, word, pendingRedirect } = top);
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
    else if (s.startsWith("$((", i)) {
      const end = s.indexOf("))", i);
      const stop = end < 0 ? s.length : end + 2;
      word = (word ?? "") + s.slice(i, stop); // arithmetic, no command
      i = stop - 1;
    } else if ((ch === "$" || ch === "<" || ch === ">") && s[i + 1] === "(") {
      open("$(");
      i++;
    } else if (ch === ">" || ch === "<") {
      if (word !== null && /^\d+$/.test(word)) word = null; // the fd in `2>`
      endWord();
      ensureEl();
      cmd.redirected = true;
      let op = ch;
      while (/[<>&|-]/.test(s[i + 1] ?? "") && op.length < 3) op += s[++i];
      if (/^>&\d?$|^<&/.test(op) || /^>&$/.test(op)) {
        // `>&2`, `2>&1`: a duplicated fd, no file
        while (/\d|-/.test(s[i + 1] ?? "")) i++;
      } else pendingRedirect = { op: op.replace(/&$/, "") || ">" };
    } else if (ch === "&" && s[i + 1] === ">") {
      endWord();
      ensureEl();
      cmd.redirected = true;
      i++;
      if (s[i + 1] === ">") i++;
      pendingRedirect = { op: ">" };
    } else if (SEPARATORS.has(ch)) {
      if ((ch === "&" || ch === "|") && s[i + 1] === ch) {
        endCommand();
        st.op = ch + ch;
        i++;
      } else if (ch === "|") {
        endCommand();
        st.op = "|";
        if (s[i + 1] === "&") i++;
      } else if (ch === "(") open("(");
      else if (ch === ")") close(")");
      else if (ch === "`") {
        if (frames.at(-1)?.kind === "`") close("`");
        else open("`");
      } else if (ch === "\n" && st.op !== null && cmd.el === null && word === null) {
        // `a &&` continued on the next line
      } else endList(ch === "&");
      if (ch === "\n" && heredocQueue.length) i = readHeredocs(s, i + 1, heredocQueue) - 1;
    } else word = (word ?? "") + ch;
  }
  endCommand();
  return { commands, top };
}

function newCommand() {
  return { words: [], redirects: [], heredocs: [], el: null, piped: false, redirected: false };
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
