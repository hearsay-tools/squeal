# 011-314: notes of the worker (wave 75 W1)

Worker 76ccaac2, 2026-11-12. Commit `9a32d29e4`.

## What changed

`LineReader.push` (`src/core/runner-host/protocol.ts`) keeps the unfinished line as a list of chunks. It searches only the new chunk for `\n`, and joins the list once, when the line ends. `frameOf` and the throw on a marked line that does not parse are unchanged. The host side (`host.ts`) reads the daemon's lines with `readline`, which was already linear.

Bench (`research/probes/daemon-idle-cpu/line-reader-bench.ts`, 09:20:58Z, load average 13.9, 13.4, 12.8): 32 MB in 64 KB chunks 110 ms, 4 MB in 4 KB chunks 10 ms (bound 0.5 s); 32 MB in 4 KB chunks 99 ms. Before: 10,414 ms and 2,010 ms.

## Not verified here

The row's live check (a Vitest tier of 100+ files with coverage leaves no unread bytes on its host socket and holds no main thread at one core for over a minute) needs a daemon that runs this source. The daemon of this worktree runs the installed bundle 0.1.443 (`~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs`), so it still has the old reader. During this task its tier of `test/runner-host/protocol.test.ts` stayed "running" about a minute past its estimated end, which fits the old reader. Check the live criterion on a release that carries this commit.

## Coverage code and maps by file (out of scope)

One reason to send them by file remains, and it is a limit, not a cost. The whole coverage run is still one JSON string on the host (`JSON.stringify` in `encodeLine`) and one string in the daemon (the join). V8's longest string on Node 26 is 536,870,888 characters (`buffer.constants.MAX_STRING_LENGTH`). A run whose sources, maps and escaping pass that throws `RangeError: Invalid string length` on the host; the daemon gets no coverage for that tier. Squeal's own run is about 6.6 MB of source before maps (research section 1), so this needs a project roughly 30 to 80 times larger. *Inferred, not measured.* Peak memory is a second, smaller point: the daemon holds the chunks, the joined line and the parsed object at once, about three copies of the line.
