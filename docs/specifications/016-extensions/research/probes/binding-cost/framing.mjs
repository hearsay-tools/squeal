// Throwaway probe for 016-34: JSON-RPC 2.0 messages with LSP's
// `Content-Length` framing, as check-protocol-judgment.md divergence 4 names.
export function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** A stream `data` handler that calls `onMessage` once per complete frame. */
export function reader(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = /Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString("ascii"));
      if (header === null) throw new Error("frame without Content-Length");
      const start = end + 4;
      const length = Number(header[1]);
      if (buffer.length < start + length) return;
      const body = buffer.subarray(start, start + length).toString("utf8");
      buffer = buffer.subarray(start + length);
      onMessage(JSON.parse(body));
    }
  };
}
