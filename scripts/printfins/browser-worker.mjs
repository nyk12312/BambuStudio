// Browser Worker compatibility for running the existing Deno tests under installed Node.
import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = globalThis;
globalThis.postMessage = data => parentPort.postMessage(data);
await import(workerData);
parentPort.on('message', data => globalThis.onmessage({ data }));
