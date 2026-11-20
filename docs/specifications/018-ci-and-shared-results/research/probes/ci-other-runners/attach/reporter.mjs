// Throwaway reporter: one line per test:pass/test:fail with file and name.
export default async function* (source) {
  for await (const e of source) {
    if (e.type === "test:pass" || e.type === "test:fail") yield JSON.stringify({ type: e.type, file: e.data.file?.replace(/^.*\/fixture\//, ""), name: e.data.name, nesting: e.data.nesting, skip: e.data.skip ?? false, duration: e.data.details?.duration_ms }) + "\n";
  }
}
