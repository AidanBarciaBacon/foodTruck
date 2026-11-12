// Six-colour picture -> today.bin (and back, and to a PNG for people).
// The packing is the one in docs/software/CONTRACT.md ("today.bin"): 4 bits per pixel, two pixels per byte,
// the left pixel in the high nibble, rows top to bottom, no header.

import zlib from "node:zlib";
import { PALETTE } from "./quantise.mjs";

// Colour code -> its place in PALETTE, or -1 for a code that is not a colour (4, and 7 to 15).
const INDEX_OF_CODE = new Int8Array(16).fill(-1);
PALETTE.forEach(({ code }, index) => {
  INDEX_OF_CODE[code] = index;
});

function checkSize(what, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`${what}: width and height must be positive whole numbers, got ${width} x ${height}`);
  }
}

function checkEvenWidth(what, width) {
  if (width % 2 !== 0) {
    throw new RangeError(`${what}: width must be even (two pixels per byte), got ${width}`);
  }
}

function checkLength(what, thing, data, expected, width, height) {
  if (!data || data.length !== expected) {
    throw new RangeError(`${what}: expected ${expected} ${thing} for ${width} x ${height}, got ${data?.length}`);
  }
}

// The place in PALETTE of the code at pixel i, or a thrown error naming the pixel.
function paletteIndex(what, codes, i, width) {
  const code = codes[i];
  const index = INDEX_OF_CODE[code];
  if (index === undefined || index < 0) {
    const valid = PALETTE.map((c) => c.code).join(", ");
    throw new RangeError(
      `${what}: code ${code} at x ${i % width}, y ${Math.floor(i / width)} is not a colour (the codes are ${valid})`,
    );
  }
  return index;
}

// codes: one colour code per pixel, rows top to bottom. Returns today.bin: width * height / 2 bytes.
export function pack(codes, width, height) {
  checkSize("pack", width, height);
  checkEvenWidth("pack", width);
  checkLength("pack", "codes", codes, width * height, width, height);
  const bytes = new Uint8Array((width * height) / 2);
  for (let i = 0; i < bytes.length; i++) {
    paletteIndex("pack", codes, 2 * i, width);
    paletteIndex("pack", codes, 2 * i + 1, width);
    bytes[i] = (codes[2 * i] << 4) | codes[2 * i + 1];
  }
  return bytes;
}

// The reverse of pack: one code per pixel. It reports whatever nibbles are in the file, colour or not, so a
// test can look inside a bad file; pack and toPng are the ones that refuse a code that is not a colour.
export function unpack(bytes, width, height) {
  checkSize("unpack", width, height);
  checkEvenWidth("unpack", width);
  checkLength("unpack", "bytes", bytes, (width * height) / 2, width, height);
  const codes = new Uint8Array(width * height);
  for (let i = 0; i < bytes.length; i++) {
    codes[2 * i] = bytes[i] >> 4;
    codes[2 * i + 1] = bytes[i] & 0x0f;
  }
  return codes;
}

// CRC-32 as PNG wants it. zlib.crc32 arrived in Node 20.15 and 22.2; older Node 20 gets the table.
let crcTable;
function tableCrc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : tableCrc32;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// One PNG chunk: length, type, data, then the CRC of type and data.
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(4 + body.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 4 + body.length);
  return out;
}

// codes: one colour code per pixel. Returns a PNG in the palette's CSS colours: 8 bits per pixel, indexed,
// with the six colours as its palette in PALETTE's order (so a pixel's byte is its colour's place in PALETTE,
// not its code).
export function toPng(codes, width, height) {
  checkSize("toPng", width, height);
  checkLength("toPng", "codes", codes, width * height, width, height);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // colour type: indexed
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method
  header[12] = 0; // not interlaced

  const palette = Buffer.from(PALETTE.flatMap((c) => c.rgb));

  // Each row is a filter byte (0: none) and then one byte per pixel.
  const rows = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width + 1) + 1;
    for (let x = 0; x < width; x++) {
      rows[start + x] = paletteIndex("toPng", codes, y * width + x, width);
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("PLTE", palette),
    // The default level: on a dithered picture the highest level takes eight times as long to save 5%.
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
