import { generate } from './adapter.mjs';
self.onmessage = ({ data }) => {
    try { self.postMessage({ ok: true, ...generate(data) }); }
    catch (error) { self.postMessage({ ok: false, error: String(error.stack || error) }); }
};
