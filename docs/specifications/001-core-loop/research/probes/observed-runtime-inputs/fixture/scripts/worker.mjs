import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
parentPort.postMessage(readFileSync(new URL('../data/worker.txt', import.meta.url), 'utf8'));
