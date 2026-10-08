const { deflateSync } = require('node:zlib');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const b of buffer) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(bytes));
  return Buffer.concat([size, bytes, crc]);
}
function trayIcon(editor = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(32 * (1 + 32 * 4));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const at = y * 129 + 1 + x * 4;
    const white = (x >= 9 && x <= 12 && y >= 7 && y <= 24) || (x >= 9 && x <= 23 && y >= 21 && y <= 24);
    pixels.set(white ? [255, 255, 255, 255] : editor ? [32, 139, 108, 255] : [52, 94, 219, 255], at);
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { trayIcon };
