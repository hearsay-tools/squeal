import { line } from './serialize.mjs';
export default async function* reporter(events) {
  for await (const event of events) yield line(event);
}
