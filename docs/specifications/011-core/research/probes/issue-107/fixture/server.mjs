import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

// A stand-in for `.ai/qa/build/cezar/dist/index.js --port N --no-open`: no end of its own,
// except a 20-minute safety exit so a forgotten probe never lingers.
const server = createServer((_, res) => res.end('ok'))
server.listen(0, '127.0.0.1', () => writeFileSync('.ai/qa/port', String(server.address().port)))
setTimeout(() => process.exit(0), 20 * 60_000).unref()
setInterval(() => {}, 60_000)
