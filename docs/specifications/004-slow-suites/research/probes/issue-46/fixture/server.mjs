// The synthetic shared environment: an HTTP server on a free port.
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const server = createServer((_, res) => res.end('ok'))
server.listen(0, '127.0.0.1', () => {
  writeFileSync(join(dirname(process.argv[2]), 'pid'), String(process.pid))
  writeFileSync(process.argv[2], String(server.address().port))
})
