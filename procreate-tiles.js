/* Decodes Apple's LZ4 block framing into one bounded tile. */
(function (root) {
  'use strict';
  const invalid = () => new Error('Dlaždice Procreate má poškozenou kompresi LZ4.');

  function lz4Block(input, output, start, end) {
    let read = 0, written = start;
    function extend(length) {
      if (length !== 15) return length;
      let next;
      do {
        if (read >= input.length) throw invalid();
        next = input[read++];
        length += next;
        if (length > end - start) throw invalid();
      } while (next === 255);
      return length;
    }
    while (read < input.length) {
      const token = input[read++];
      const literals = extend(token >> 4);
      if (read + literals > input.length || written + literals > end) throw invalid();
      output.set(input.subarray(read, read + literals), written);
      read += literals;
      written += literals;
      if (read === input.length) break;
      if (read + 2 > input.length) throw invalid();
      const distance = input[read] | input[read + 1] << 8;
      read += 2;
      const length = extend(token & 15) + 4;
      // Apple can reference bytes decoded by an earlier block of this tile.
      if (!distance || written - distance < 0 || written + length > end) throw invalid();
      for (let i = 0; i < length; i++, written++) output[written] = output[written - distance];
    }
    if (written !== end) throw invalid();
  }

  function lz4(input, expectedSize) {
    const output = new Uint8Array(expectedSize);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    let read = 0, written = 0;
    while (read + 4 <= input.length) {
      const kind = view.getUint32(read);
      read += 4;
      if (kind === 0x62763424 && read === input.length && written === output.length) return output;
      const compressed = kind === 0x62763431;
      if ((!compressed && kind !== 0x6276342d) || read + 8 > input.length) throw invalid();
      const plainSize = view.getUint32(read, true);
      const packedSize = view.getUint32(read + 4, true);
      read += 8;
      if (!compressed && plainSize !== packedSize) throw invalid();
      if (!plainSize || !packedSize || read + packedSize > input.length || written + plainSize > expectedSize) throw invalid();
      const bytes = input.subarray(read, read + packedSize);
      if (compressed) lz4Block(bytes, output, written, written + plainSize);
      else output.set(bytes, written);
      read += packedSize;
      written += plainSize;
    }
    throw invalid();
  }

  const api = { lz4 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProcreateTiles = api;
})(globalThis);
