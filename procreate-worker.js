'use strict';
importScripts('./vendor/procreate-zip.js', './vendor/procreate-lzo.js', './procreate-plist.js', './procreate-tiles.js', './procreate-file.js');

let session;
let queue = Promise.resolve();
const codecs = { lz4: ProcreateTiles.lz4, lzo: ProcreateLzo.lzo1xDecompress };
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'parse') {
        await session?.close();
        session = await ProcreateFile.parse(data.file, zip, ProcreatePlist);
        self.postMessage({ requestId: data.requestId, result: session.metadata });
      } else if (data.type === 'render') {
        if (!session) throw new Error('Nejdřív otevři dokument Procreate.');
        const buffer = await ProcreateFile.raster(session, data.nodeId, codecs, (w, h) => new OffscreenCanvas(w, h));
        self.postMessage({ requestId: data.requestId, result: buffer }, [buffer]);
      }
    } catch (error) {
      self.postMessage({ requestId: data.requestId, error: error.message || 'Soubor Procreate nelze načíst.' });
    }
  });
};
