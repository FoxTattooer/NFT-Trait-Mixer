'use strict';
importScripts('./vendor/ag-psd.js', './psd-core.js');
agPsd.initializeCanvas((w, h) => new OffscreenCanvas(w, h), (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
let session;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'parse') {
        session = TraitPSD.parse(data.buffer, agPsd);
        self.postMessage({ requestId: data.requestId, result: session.metadata });
      } else if (data.type === 'render') {
        if (!session) throw new Error('Nejdřív otevři PSD.');
        const buffer = await TraitPSD.raster(session, data.nodeId, agPsd, (w, h) => new OffscreenCanvas(w, h));
        self.postMessage({ requestId: data.requestId, result: buffer }, [buffer]);
      }
    } catch (error) { self.postMessage({ requestId: data.requestId, error: error.message || 'PSD nelze načíst.' }); }
  });
};
