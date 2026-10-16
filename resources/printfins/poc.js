let worker;
window.startPrintFins = request => {
    worker?.terminate();
    worker = new Worker('worker.mjs', { type: 'module' });
    worker.onmessage = ({ data }) => window.wx.postMessage(JSON.stringify(data));
    worker.onerror = error => window.wx.postMessage(JSON.stringify({ ok: false, error: error.message }));
    worker.postMessage(request);
};
window.wx.postMessage(JSON.stringify({ ready: true }));
