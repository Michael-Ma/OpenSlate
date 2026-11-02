import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { centerCropPng, pngCenterCropDimensions } from '../dist/index.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc(bytes) {
  let n = 0xffffffff;
  for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4); return out;
}
const channels = color => ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[color];
const value = (x, y, c, depth) => (x * 7 + y * 13 + c * 37) % (2 ** depth);
const paeth = (a, b, c) => {
  const p = a + b - c, ds = [a, b, c].map(v => Math.abs(p - v)); return [a, b, c][ds.indexOf(Math.min(...ds))];
};
function png(width, height, { color = 2, depth = 8, filter = 0, interlace = false, transparency = false } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = depth; header[9] = color; header[12] = Number(interlace);
  const parts = [signature, chunk('IHDR', header), chunk('tEXt', Buffer.from('note\0drop this'))];
  if (color === 3) parts.push(chunk('PLTE', Buffer.from(Array.from({ length: 3 * 2 ** depth }, (_, i) => i % 256))));
  if (transparency) parts.push(chunk('tRNS', color === 3 ? Buffer.from([0, 100]) : Buffer.alloc(color === 0 ? 2 : 6)));
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = [], count = channels(color), bpp = Math.max(1, Math.ceil(count * depth / 8));
  for (const [x0, y0, dx, dy] of passes) {
    const xs = Array.from({ length: Math.max(0, Math.ceil((width - x0) / dx)) }, (_, x) => x0 + x * dx);
    let previous = Buffer.alloc(Math.ceil(xs.length * count * depth / 8));
    if (!xs.length) continue;
    for (let y = y0; y < height; y += dy) {
      const row = Buffer.alloc(previous.length);
      xs.forEach((x, i) => {
        for (let c = 0; c < count; c++) {
          const n = value(x, y, c, depth), position = i * count + c;
          if (depth === 16) row.writeUInt16BE(n, position * 2);
          else if (depth === 8) row[position] = n;
          else row[Math.floor(position * depth / 8)] |= n << (8 - depth - position * depth % 8);
        }
      });
      const filtered = Buffer.alloc(row.length + 1); filtered[0] = filter;
      for (let i = 0; i < row.length; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = previous[i], c = i >= bpp ? previous[i - bpp] : 0;
        filtered[i + 1] = (row[i] - [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
      }
      rows.push(filtered); previous = row;
    }
  }
  const compressed = deflateSync(Buffer.concat(rows)), split = Math.floor(compressed.length / 2);
  return Buffer.concat([...parts, chunk('IDAT', compressed.subarray(0, split)), chunk('IDAT', compressed.subarray(split)), chunk('IEND', Buffer.alloc(0))]);
}
function decode(bytes) {
  const chunks = []; let offset = 8;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(bytes.readUInt32BE(offset + 8 + size), crc(bytes.subarray(offset + 4, offset + 8 + size)));
    chunks.push({ type, data }); offset += 12 + size;
  }
  const header = chunks[0].data;
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4), depth: header[8], color: header[9], interlace: header[12],
    chunks, pixels: inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data))) };
}
function assertPixels(result, left, top) {
  const { width, height, depth, color, pixels, interlace } = decode(result), count = channels(color), stride = 1 + Math.ceil(width * count * depth / 8);
  assert.equal(interlace, 0); assert.equal(pixels.length, stride * height);
  for (let y = 0; y < height; y++) {
    assert.equal(pixels[y * stride], 0);
    for (let x = 0; x < width; x++) for (let c = 0; c < count; c++) {
      const position = x * count + c, byte = y * stride + 1 + Math.floor(position * depth / 8);
      const actual = depth === 16 ? pixels.readUInt16BE(byte) : depth === 8 ? pixels[byte]
        : (pixels[byte] >> (8 - depth - position * depth % 8)) & (2 ** depth - 1);
      assert.equal(actual, value(x + left, y + top, c, depth), `pixel ${x},${y},${c}`);
    }
  }
}

for (const [aspect, source, size] of [['9:16', [1024, 1536], [864, 1536]], ['16:9', [1536, 1024], [1536, 864]]]) {
  test(`${aspect} uses the largest even exact-ratio crop`, () => {
    const result = centerCropPng(png(...source), aspect), decoded = decode(result.bytes);
    assert.deepEqual([decoded.width, decoded.height], size);
    assert.deepEqual(result.crop, { recipe: 'center-crop-v1', sourceWidth: source[0], sourceHeight: source[1], width: size[0], height: size[1] });
  });
}
test('odd dimensions floor the centred offset and preserve actual pixels', () => {
  const result = centerCropPng(png(43, 39), '9:16');
  assert.deepEqual(result.crop, { recipe: 'center-crop-v1', sourceWidth: 43, sourceHeight: 39, width: 18, height: 32 });
  assertPixels(result.bytes, 12, 3);
});
for (const [width, height, aspect] of [[18, 32, '9:16'], [9, 16, '9:16'], [32, 18, '16:9'], [37, 37, '1:1'], [37, 41, '1:1'], [43, 39, '4:3']]) {
  test(`unchanged ${width}x${height} for ${aspect} keeps every source byte`, () => {
    const source = png(width, height), result = centerCropPng(source, aspect);
    assert.equal(result.crop, undefined); assert.deepEqual(result.bytes, source);
  });
}
for (let filter = 0; filter <= 4; filter++) test(`PNG filter ${filter} is decoded before row cropping`, () => {
  assertPixels(centerCropPng(png(43, 39, { color: 6, filter }), '16:9').bytes, 5, 10);
});
for (const [color, depths] of [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]) {
  for (const depth of depths) test(`colour type ${color}, ${depth}-bit pixels survive ordinary and Adam7 crops`, () => {
    for (const interlace of [false, true]) {
      const result = centerCropPng(png(43, 39, { color, depth, interlace, filter: 4, transparency: [0, 2, 3].includes(color) }), '9:16');
      assertPixels(result.bytes, 12, 3);
      assert.deepEqual(decode(result.bytes).chunks.map(c => c.type), ['IHDR', ...(color === 3 ? ['PLTE'] : []),
        ...([0, 2, 3].includes(color) ? ['tRNS'] : []), 'IDAT', 'IEND']);
    }
  });
}
test('the same source bytes yield the same cropped PNG bytes without mutating input', () => {
  const source = png(43, 39, { color: 6, filter: 4 }), original = Buffer.from(source);
  const first = centerCropPng(source, '9:16'), second = centerCropPng(source, '9:16');
  assert.deepEqual(first, second); assert.deepEqual(source, original);
  assert.equal(createHash('sha256').update(first.bytes).digest('hex'), '3d059a0188a00e295192c51c9ca6d0e5ab62a508c7b1d57686dc0ff821f749b9');
});
test('invalid geometry, CRC, unknown critical chunks, truncated data and oversized inflation fail closed', () => {
  assert.throws(() => pngCenterCropDimensions(1, 1, '9:16'), { code: 'PNG_CROP_INVALID' });
  assert.throws(() => pngCenterCropDimensions(8193, 32, '9:16'), { code: 'PNG_CROP_INVALID' });
  const source = png(43, 39), badCrc = Buffer.from(source); badCrc[30] ^= 1;
  const badInflation = Buffer.concat([source.subarray(0, 33), chunk('IDAT', deflateSync(Buffer.alloc(1_000_000))), chunk('IEND', Buffer.alloc(0))]);
  const shortInflation = Buffer.concat([source.subarray(0, 33), chunk('IDAT', deflateSync(Buffer.alloc(1))), chunk('IEND', Buffer.alloc(0))]);
  const badCritical = Buffer.concat([source.subarray(0, 33), chunk('FAIL', Buffer.alloc(0)), source.subarray(33)]);
  for (const bytes of [badCrc, source.subarray(0, -1), badInflation, shortInflation, badCritical])
    assert.throws(() => centerCropPng(bytes, '9:16'), { code: 'PNG_CROP_INVALID' });
});
