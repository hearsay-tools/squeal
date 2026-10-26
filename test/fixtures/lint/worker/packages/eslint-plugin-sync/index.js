// A synckit stand-in: a rule asks a worker thread to read a file and waits
// for the answer with Atomics.wait.
import { join } from "node:path";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";

let channel = null;

function readInWorker(file) {
  if (channel === null) {
    const { port1, port2 } = new MessageChannel();
    const done = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: { port: port2, done },
      transferList: [port2],
    });
    worker.unref();
    channel = { port: port1, done };
  }
  Atomics.store(channel.done, 0, 0);
  channel.port.postMessage(file);
  Atomics.wait(channel.done, 0, 0);
  return receiveMessageOnPort(channel.port).message;
}

export default {
  rules: {
    data: {
      meta: { schema: [] },
      create(context) {
        return {
          Program(node) {
            context.report({ node, message: readInWorker(join(context.cwd, "data.txt")) });
          },
        };
      },
    },
  },
};
