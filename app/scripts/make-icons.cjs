// Generates simple PNG app icons (no dependencies). Run: node scripts/make-icons.cjs
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const bg = [11, 107, 203], fg = [255, 255, 255], ok = [76, 194, 122];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const u = size / 16; // design grid 16x16
  // three stacked containers (rows y 4-6, 7-9, 10-12), check mark box at bottom right
  const boxes = [[3, 3.5, 13, 6], [3, 7, 13, 9.5], [3, 10.5, 13, 13]];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const gx = x / u, gy = y / u;
      let col = bg;
      for (const [x0, y0, x1, y1] of boxes) {
        if (gx >= x0 && gx < x1 && gy >= y0 && gy < y1) {
          // vertical corrugation lines
          col = (Math.floor((gx - x0) * 2) % 3 === 2) ? [220, 232, 245] : fg;
        }
      }
      // green check on the middle container
      const cx = gx - 9, cy = gy - 8.25;
      const onCheck = (Math.abs(cy - (-cx * 0.9 + 0.2)) < 0.45 && cx > -0.2 && cx < 2.2) || (Math.abs(cy - (cx * 0.9 + 0.2)) < 0.45 && cx > -1.6 && cx < 0.1);
      if (onCheck) col = ok;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const s of [180, 192, 512]) {
  fs.writeFileSync(path.join(__dirname, '..', 'public', `icon-${s}.png`), png(s));
}
console.log('icons written');
