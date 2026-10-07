// THROWAWAY probe. A node:test reporter that prints the shape of every test:coverage event.
export default async function* (source) {
  for await (const ev of source) {
    if (ev.type !== "test:coverage") continue;
    const s = ev.data.summary;
    yield JSON.stringify({ keys: Object.keys(ev.data), nesting: ev.data.nesting, file: ev.data.file ?? null, workingDirectory: s.workingDirectory,
      files: s.files.map((f) => f.path.replace(/.*fixtures\/ref\//, "")), fileKeys: Object.keys(s.files[0] ?? {}) }) + "\n";
  }
}
