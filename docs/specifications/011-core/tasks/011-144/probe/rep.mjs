export default async function* (source) { for await (const e of source) yield JSON.stringify({type: e.type, name: e.data?.name, nesting: e.data?.nesting, skip: e.data?.skip}) + "\n"; }
