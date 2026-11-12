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

  it("reads a frame written right after stray bytes that lack a newline (review 0.1.434 S1)", () => {
    const reader = new LineReader();
    const frame = encodeLine({ id: 7, r: "reply" });
    // A native write or a child with inherited stdout, then the host's frame.
    expect(reader.push(`\u001b[2Kpartial progress ${frame}`)).toEqual([{ id: 7, r: "reply" }]);
    expect(reader.push("stray")).toEqual([]);
    expect(reader.push(encodeLine({ ev: "note", text: "n" }))).toEqual([{ ev: "note", text: "n" }]);
  });

  it("throws on a marked line that does not parse", () => {
    expect(() => new LineReader().push(`${MARKER}{"id":1,\n`)).toThrow();
  });

  it("gives the same messages for every chunk size", () => {
    const text = [
      "vite: optimizing\n",
      encodeLine({ id: 1, r: { files: ["a", "b"] } }),
      "\n\nstray ",
      encodeLine({ ev: "note", text: "n\nm" }),
      encodeLine({ id: 2, r: null }),
      `partial ${MARKER}{"id":3`,
    ].join("");
    const whole = new LineReader().push(text);
    expect(whole).toHaveLength(3);
    for (let size = 1; size <= text.length; size++) {
      const reader = new LineReader();
      const messages: unknown[] = [];
      for (let at = 0; at < text.length; at += size) {
        messages.push(...reader.push(text.slice(at, at + size)));
      }
      expect(messages, `chunks of ${size}`).toEqual(whole);
      // The unfinished line is kept: its end completes it.
      expect(reader.push(`,"r":0}\n`), `chunks of ${size}`).toEqual([{ id: 3, r: 0 }]);
    }
  });

  /*
   * Row 011-314: a long line costs time linear in its length. The reader
   * that joined the unfinished line with each chunk and split it all again
   * took about 2 s for a 4 MB line in 4 KB chunks, so it stops here within
   * the bound, at about a fifth of the line, instead of after half a minute.
   */
  it("reads a 16 MB line fed in 4 KB chunks as one message, in linear time", () => {
    const limitMs = 1500;
    const chunk = 4096;
    const text = "x".repeat(16 * 1024 * 1024);
    const line = encodeLine({ ev: "note", text });
    const reader = new LineReader();
    const messages: unknown[] = [];
    const started = performance.now();
    let at = 0;
    for (; at < line.length && performance.now() - started < limitMs; at += chunk) {
      messages.push(...reader.push(line.slice(at, at + chunk)));
    }
    const ms = Math.round(performance.now() - started);
    expect(at, `${at} of ${line.length} characters read in ${ms} ms`).toBeGreaterThanOrEqual(
      line.length,
    );
    expect(ms).toBeLessThan(limitMs);
    expect(messages).toHaveLength(1);
    const [message] = messages as { ev: string; text: string }[];
    expect(message?.ev).toBe("note");
    expect(message?.text === text).toBe(true);
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
