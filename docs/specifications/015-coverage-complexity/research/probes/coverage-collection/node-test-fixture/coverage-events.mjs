// Throwaway (015-01): a node:test reporter that prints each test:coverage event's per-file functions.
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type !== "test:coverage") continue;
    for (const f of event.data.summary.files) {
      if (!f.path.endsWith("math.ts")) continue;
      yield `COVERAGE ${JSON.stringify({
        path: f.path.split("/").pop(),
        functions: f.functions.map((fn) => `${fn.name}@${fn.line}:${fn.count}`),
        branches: f.branches.map((b) => `${b.line}:${b.count}`),
        lines: f.lines.filter((l) => l.count > 0).map((l) => l.line),
      })}\n`;
    }
  }
}
