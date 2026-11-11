import { describe, expect, it } from "vitest";
import type { ExecutedSource } from "../../src/core/code/coverage/types.js";
import { decodeCoverageRun, encodeCoverageRun } from "../../src/core/runner-host/coverage-wire.js";
import { encodeLine, LineReader, MARKER } from "../../src/core/runner-host/protocol.js";

/*
 * Spec 021 D6 (row 021-11): one JSON object per line, each line starting
 * with a fixed marker, so a library's output on the host's stdout is never
 * read as a message.
 */

describe("runner host framing", () => {
  it("writes one marked line per message, and no value can hold the marker", () => {
    const line = encodeLine({ ev: "note", text: `a\nb ${MARKER}` });
    expect(line.startsWith(MARKER)).toBe(true);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(line.indexOf(MARKER, 1)).toBe(-1);
    expect(new LineReader().push(line)).toEqual([{ ev: "note", text: `a\nb ${MARKER}` }]);
  });

  it("skips lines without the marker and joins a line split across chunks", () => {
    const reader = new LineReader();
    const first = encodeLine({ id: 1, r: { files: ["a"] } });
    const second = encodeLine({ id: 2, r: null });
    const text = `vite: optimizing\n${first}stray console.log\n${second}`;
    const cut = text.indexOf("files") + 2;
    expect(reader.push(text.slice(0, cut))).toEqual([]);
    expect(reader.push(text.slice(cut))).toEqual([
      { id: 1, r: { files: ["a"] } },
      { id: 2, r: null },
    ]);
  });

  it("throws on a marked line that does not parse", () => {
    expect(() => new LineReader().push(`${MARKER}{"id":1,\n`)).toThrow();
  });
});

describe("coverage payloads over the protocol", () => {
  it("sends a source shared by two files once, and gives it back as one object", () => {
    const shared: ExecutedSource = { path: "src/a.ts", code: "x", map: null, sha1: "1" };
    const own: ExecutedSource = { path: "src/b.ts", code: "y", map: null, sha1: undefined };
    const run = {
      runId: "r1",
      files: [
        {
          testFile: { project: "", path: "test/a.test.ts" },
          payload: "/tmp/p1.json",
          sources: new Map([["/w/src/a.ts", shared]]),
        },
        {
          testFile: { project: "", path: "test/b.test.ts" },
          payload: "/tmp/p2.json",
          sources: new Map([
            ["/w/src/a.ts", shared],
            ["/w/src/b.ts", own],
          ]),
          children: { root: "/w", dir: "/tmp/c" },
        },
      ],
    };
    const wire = JSON.parse(JSON.stringify(encodeCoverageRun(run)));
    expect(wire.sources).toHaveLength(2);
    const back = decodeCoverageRun(wire);
    expect(back.runId).toBe("r1");
    expect(back.files.map((f) => [...f.sources.keys()])).toEqual([
      ["/w/src/a.ts"],
      ["/w/src/a.ts", "/w/src/b.ts"],
    ]);
    expect(back.files[0]?.sources.get("/w/src/a.ts")).toBe(
      back.files[1]?.sources.get("/w/src/a.ts"),
    );
    expect(back.files[1]?.children).toEqual({ root: "/w", dir: "/tmp/c" });
    expect(back.files[0]?.sources.get("/w/src/a.ts")).toEqual({ ...shared });
  });
});
