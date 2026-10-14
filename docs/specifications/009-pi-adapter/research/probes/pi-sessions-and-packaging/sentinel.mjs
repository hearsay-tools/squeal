// Throwaway detached child; controller always terminates it, with a 20-second fallback.
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], String(process.pid));
setInterval(() => writeFileSync(process.argv[2], String(Date.now())), 100);
setTimeout(() => process.exit(0), 20000);
