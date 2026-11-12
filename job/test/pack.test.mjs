import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { PALETTE } from "../lib/quantise.mjs";
import { pack, unpack, toPng } from "../lib/pack.mjs";

const CODES = PALETTE.map((c) => c.code);
const RGB_OF_CODE = Object.fromEntries(PALETTE.map((c) => [c.code, c.rgb]));

// The same "random" codes on every run.
function randomCodes(count, seed = 1) {
  let state = seed;
  const codes = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    codes[i] = CODES[Math.floor((state / 2 ** 32) * CODES.length)];
  }
  return codes;
}

// CRC-32 written out here, apart from the module's, so the two check each other.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A minimal PNG reader: checks the signature and every chunk's CRC, and returns the chunks.
function readChunks(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    const crc = png.readUInt32BE(at + 8 + length);
    assert.equal(crc, crc32(png.subarray(at + 4, at + 8 + length)), `CRC of ${type}`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  assert.equal(at, png.length, "no bytes after the last chunk");
  return chunks;
}

// Decodes an 8-bit indexed, unfiltered PNG (the only kind toPng writes) to [r, g, b] per pixel.
function decodePng(png) {
  const chunks = readChunks(png);
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "PLTE", "IDAT", "IEND"]);
  const [header, palette, data, end] = chunks.map((c) => c.data);
  assert.equal(header.length, 13);
  assert.equal(end.length, 0);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert.deepEqual([...header.subarray(8)], [8, 3, 0, 0, 0], "8 bits, indexed, deflate, no interlace");
  const rows = zlib.inflateSync(data);
  assert.equal(rows.length, height * (width + 1));
  const pixels = [];
  for (let y = 0; y < height; y++) {
    const start = y * (width + 1);
    assert.equal(rows[start], 0, `row ${y} is unfiltered`);
    for (let x = 0; x < width; x++) {
      const index = rows[start + 1 + x];
      assert.ok(index * 3 + 2 < palette.length, `pixel ${x}, ${y} is inside the palette`);
      pixels.push([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]]);
    }
  }
  return { width, height, palette, pixels };
}

test("two pixels per byte, the left pixel in the high nibble", () => {
  assert.deepEqual([...pack([3, 5], 2, 1)], [0x35]);
  assert.deepEqual([...pack([5, 3], 2, 1)], [0x53]);
  assert.deepEqual([...pack([0, 1, 2, 6], 4, 1)], [0x01, 0x26]);
});

test("rows go top to bottom", () => {
  // 2 wide, 3 tall: one byte per row.
  assert.deepEqual([...pack([1, 1, 3, 3, 0, 6], 2, 3)], [0x11, 0x33, 0x06]);
  // 4 wide, 2 tall.
  assert.deepEqual([...pack([0, 1, 2, 3, 5, 6, 0, 1], 4, 2)], [0x01, 0x23, 0x56, 0x01]);
});

test("800 x 480 packs to exactly 192,000 bytes and unpacks to the same codes", () => {
  const codes = randomCodes(800 * 480);
  const bytes = pack(codes, 800, 480);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 192000);
  const back = unpack(bytes, 800, 480);
  assert.ok(back instanceof Uint8Array);
  assert.equal(back.length, 384000);
  assert.deepEqual(back, codes);
});

test("every pair of colours survives the round trip", () => {
  const pairs = CODES.flatMap((left) => CODES.map((right) => [left, right])).flat();
  const bytes = pack(pairs, 2, pairs.length / 2);
  assert.deepEqual([...unpack(bytes, 2, pairs.length / 2)], pairs);
  bytes.forEach((byte, i) => assert.equal(byte, pairs[2 * i] * 16 + pairs[2 * i + 1]));
});

test("pack takes a plain array or a Buffer of codes", () => {
  assert.deepEqual([...pack([6, 2, 1, 0], 2, 2)], [0x62, 0x10]);
  assert.deepEqual([...pack(Buffer.from([6, 2, 1, 0]), 2, 2)], [0x62, 0x10]);
});

test("pack throws on an odd width", () => {
  assert.throws(() => pack(new Uint8Array(3), 3, 1), /width must be even/);
  assert.throws(() => pack(new Uint8Array(801 * 480), 801, 480), /width must be even/);
  // An odd width with an even number of pixels is still wrong: a byte would straddle two rows.
  assert.throws(() => pack(new Uint8Array(6), 3, 2), /width must be even/);
});

test("pack throws on a wrong length", () => {
  assert.throws(() => pack(new Uint8Array(7), 4, 2), /expected 8 codes/);
  assert.throws(() => pack(new Uint8Array(9), 4, 2), /expected 8 codes/);
  assert.throws(() => pack(new Uint8Array(0), 4, 2), /expected 8 codes/);
  assert.throws(() => pack(new Uint8Array(800 * 480), 480, 800 + 2), RangeError);
  assert.throws(() => pack(undefined, 4, 2), RangeError);
});

test("pack throws on a size that is not positive whole numbers", () => {
  assert.throws(() => pack(new Uint8Array(0), 0, 0), RangeError);
  assert.throws(() => pack(new Uint8Array(4), 2.5, 2), RangeError);
  assert.throws(() => pack(new Uint8Array(4), -2, -2), RangeError);
});

test("pack throws on a code that is not one of the six, and says where", () => {
  for (const bad of [4, 7, 8, 15, 16, 255]) {
    assert.throws(() => pack([0, 1, 2, bad], 2, 2), /is not a colour/, `code ${bad}`);
    assert.throws(() => pack([bad, 1, 2, 3], 2, 2), /is not a colour/, `code ${bad} on the left`);
  }
  assert.throws(() => pack([0, 1, 2, 4], 2, 2), /code 4 at x 1, y 1/);
  assert.throws(() => pack([0, 1, -1, 3], 2, 2), /is not a colour/);
  assert.throws(() => pack([0, 1, 2.5, 3], 2, 2), /is not a colour/);
  assert.throws(() => pack([0, 1, undefined, 3], 2, 2), /is not a colour/);
});

test("unpack throws on an odd width or a wrong length", () => {
  assert.throws(() => unpack(new Uint8Array(3), 3, 2), /width must be even/);
  assert.throws(() => unpack(new Uint8Array(3), 4, 2), /expected 4 bytes/);
  assert.throws(() => unpack(new Uint8Array(191999), 800, 480), /expected 192000 bytes/);
  assert.throws(() => unpack(new Uint8Array(192001), 800, 480), /expected 192000 bytes/);
});

test("unpack reads the high nibble as the left pixel", () => {
  assert.deepEqual([...unpack([0x35, 0x10], 2, 2)], [3, 5, 1, 0]);
});

test("toPng starts with the PNG signature and has the picture's size in IHDR", () => {
  const png = toPng(randomCodes(800 * 480, 2), 800, 480);
  assert.ok(Buffer.isBuffer(png));
  assert.equal(png.subarray(0, 8).toString("latin1"), "\x89PNG\r\n\x1a\n");
  // IHDR is always first: its length (13), its name, then width and height.
  assert.equal(png.readUInt32BE(8), 13);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 480);
});

test("toPng decodes back to the same pixels in the palette's colours", () => {
  const codes = randomCodes(800 * 480, 3);
  const { width, height, palette, pixels } = decodePng(toPng(codes, 800, 480));
  assert.equal(width, 800);
  assert.equal(height, 480);
  assert.deepEqual([...palette], PALETTE.flatMap((c) => c.rgb), "the palette is the six colours");
  assert.equal(pixels.length, codes.length);
  for (let i = 0; i < codes.length; i++) {
    const want = RGB_OF_CODE[codes[i]];
    const got = pixels[i];
    if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2]) {
      assert.fail(`pixel ${i}: code ${codes[i]} should be ${want}, the PNG has ${got}`);
    }
  }
});

test("toPng takes sizes pack cannot (odd width) and non-square pictures", () => {
  const codes = [0, 1, 2, 3, 5, 6, 6, 5, 3, 2, 1, 0, 0, 0, 1];
  const { width, height, pixels } = decodePng(toPng(codes, 5, 3));
  assert.equal(width, 5);
  assert.equal(height, 3);
  assert.deepEqual(pixels, codes.map((code) => RGB_OF_CODE[code]));
});

test("toPng throws on a wrong length or a code that is not one of the six", () => {
  assert.throws(() => toPng(new Uint8Array(7), 4, 2), /expected 8 codes/);
  assert.throws(() => toPng([0, 1, 4, 3], 2, 2), /code 4 at x 0, y 1/);
  assert.throws(() => toPng([0, 1, 7, 3], 2, 2), /is not a colour/);
  assert.throws(() => toPng([], 0, 0), RangeError);
});

test("toPng writes the same file on a Node without zlib.crc32", async () => {
  const codes = randomCodes(64 * 48, 4);
  const withBuiltIn = toPng(codes, 64, 48);
  const builtIn = zlib.crc32;
  zlib.crc32 = undefined;
  try {
    // A fresh copy of the module, loaded while zlib.crc32 is missing, so it takes its own table.
    const fresh = await import("../lib/pack.mjs?without-zlib-crc32");
    assert.notEqual(fresh.toPng, toPng);
    const withTable = fresh.toPng(codes, 64, 48);
    assert.deepEqual(withTable, withBuiltIn);
    decodePng(withTable);
  } finally {
    zlib.crc32 = builtIn;
  }
});
