// Read-only runner: use the user's original regression files without installing Deno.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
const tests = [], workers = new Set();
globalThis.Deno = { readFileSync, test(name, fn) { tests.push({ name, fn }); } };
globalThis.Worker = class {
    constructor(url) {
        this.worker = new NodeWorker(new URL('./browser-worker.mjs', import.meta.url), { workerData: url });
        workers.add(this);
        this.worker.on('message', data => this.onmessage?.({ data }));
        this.worker.on('error', error => this.onerror?.(error));
    }
    postMessage(data) { this.worker.postMessage(data); }
    terminate() { workers.delete(this); return this.worker.terminate(); }
};
const root = process.argv[2];
if (!root) throw new Error('Usage: node run-original-tests.mjs ORIGINAL_ENGINE_ROOT [test.js ...]');
const files = process.argv.slice(3);
if (!files.length) files.push('lower_support_gap.test.js', 'support_starts.test.js', 'lower_layer_contact.test.js');
let failed = 0;
try {
    for (const file of files) await import(pathToFileURL(resolve(root, 'tests', file)).href);
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`PASS ${name}`); }
        catch (error) { ++failed; console.error(`FAIL ${name}\n${error.stack}`); }
    }
} finally { await Promise.all([...workers].map(w => w.terminate())); }
console.log(`${tests.length - failed} passed, ${failed} failed (Node compatibility runner, not Deno)`);
process.exitCode = failed ? 1 : 0;
