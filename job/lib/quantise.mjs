// Any RGBA picture -> the screen's six colours.
// The colours and their codes are the table in docs/software/CONTRACT.md ("today.bin").

function colour(name, code, rgb) {
  return Object.freeze({ name, code, rgb: Object.freeze(rgb) });
}

export const PALETTE = Object.freeze([
  colour("black", 0, [0x00, 0x00, 0x00]),
  colour("white", 1, [0xff, 0xff, 0xff]),
  colour("yellow", 2, [0xf5, 0xd0, 0x00]),
  colour("red", 3, [0xd0, 0x02, 0x1b]),
  colour("blue", 5, [0x1f, 0x4f, 0xd8]),
  colour("green", 6, [0x1e, 0x8e, 0x3e]),
]);

// The distance between two colours.
//
// It is a squared distance in a luma-weighted space, on the sRGB values as they are (not linear light):
//
//   distance = dY^2 + CHROMA_WEIGHT * ((dR - dY)^2 + (dG - dY)^2 + (dB - dY)^2)
//
// where Y is the Rec. 601 luma (0.299 R + 0.587 G + 0.114 B) and dR, dG, dB, dY are the differences between
// the two colours. The first term is the difference in brightness, the rest the difference in colourfulness,
// counted four times over.
//
// Why this one: the page is text and flat shapes, so what matters is the anti-aliased pixels along an edge,
// each a blend of the two colours on either side. A browser blends in sRGB values, so in this space (a linear
// change of sRGB) a blend lies on the straight line between its two colours, and a grey has no colourfulness
// at all. Counting colourfulness four times keeps the dark, weakly coloured blue and green away from the
// greys: every grey goes to black or white, splitting at 128, and every blend of a colour with black or white
// goes to one of those two.
//
// Measured over all 256 blends of each pair of palette colours:
// - plain squared distance in sRGB sends 104 of the 256 greys to green and 3 to blue;
// - squared distance in linear light is worse: greys go to green, blue and yellow, and red-to-white edges
//   pick up yellow;
// - Oklab needs its colour axes weighted about 12 times before greys stay grey, and still sends
//   black-to-yellow edges through green;
// - this measure with a weight of 3 or 4 has no stray colour on any pair that includes black or white, nor
//   on yellow-red, yellow-green and blue-green. At 2, black-to-yellow edges pick up green; from 5 up,
//   blue-to-green edges pick up black. 4 rather than 3 leaves more margin for slightly off-colour pixels.
//
// What no per-pixel measure can fix: the blends of yellow with blue, red with blue, and red with green pass
// through dull, near-grey colours, so those edges get some black or white pixels. The page should not put
// those pairs side by side.
const CHROMA_WEIGHT = 4;

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// Each palette colour in that space, four numbers per colour: Y, R - Y, G - Y, B - Y.
const PALETTE_SPACE = new Float64Array(PALETTE.length * 4);
PALETTE.forEach(({ rgb: [r, g, b] }, i) => {
  const y = LUMA_R * r + LUMA_G * g + LUMA_B * b;
  PALETTE_SPACE.set([y, r - y, g - y, b - y], i * 4);
});

// The index in PALETTE of the colour nearest to (r, g, b). A tie goes to the earlier colour.
function nearest(r, g, b) {
  const y = LUMA_R * r + LUMA_G * g + LUMA_B * b;
  const cr = r - y;
  const cg = g - y;
  const cb = b - y;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = i * 4;
    const dy = y - PALETTE_SPACE[p];
    const dr = cr - PALETTE_SPACE[p + 1];
    const dg = cg - PALETTE_SPACE[p + 2];
    const db = cb - PALETTE_SPACE[p + 3];
    const distance = dy * dy + CHROMA_WEIGHT * (dr * dr + dg * dg + db * db);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

// One channel of a pixel laid over white, as the browser would show it on a white page.
function overWhite(value, alpha) {
  return alpha === 255 ? value : Math.round((value * alpha + 255 * (255 - alpha)) / 255);
}

function checkPicture(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`quantise: width and height must be positive whole numbers, got ${width} x ${height}`);
  }
  if (!rgba || rgba.length !== width * height * 4) {
    throw new RangeError(
      `quantise: expected ${width * height * 4} bytes of RGBA for ${width} x ${height}, got ${rgba?.length}`,
    );
  }
}

function quantiseNearest(rgba, width, height) {
  const codes = new Uint8Array(width * height);
  // A page has a handful of distinct colours, so remember the answer for each.
  const seen = new Map();
  for (let i = 0, p = 0; i < codes.length; i++, p += 4) {
    const a = rgba[p + 3];
    const r = overWhite(rgba[p], a);
    const g = overWhite(rgba[p + 1], a);
    const b = overWhite(rgba[p + 2], a);
    const key = (r << 16) | (g << 8) | b;
    let code = seen.get(key);
    if (code === undefined) {
      code = PALETTE[nearest(r, g, b)].code;
      seen.set(key, code);
    }
    codes[i] = code;
  }
  return codes;
}

// Floyd-Steinberg error diffusion, serpentine (rows alternate left-to-right and right-to-left, which avoids
// the diagonal "worm" patterns of a one-way scan). The error is spread in sRGB values, like the distance
// above and like the usual e-paper tools, so a flat 50% grey (128) comes out half black and half white.
function quantiseDithered(rgba, width, height) {
  const codes = new Uint8Array(width * height);
  // The error owed to this row and to the next one, three channels per pixel.
  let thisRow = new Float64Array(width * 3);
  let nextRow = new Float64Array(width * 3);
  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0;
    const step = leftToRight ? 1 : -1;
    for (let n = 0, x = leftToRight ? 0 : width - 1; n < width; n++, x += step) {
      const p = (y * width + x) * 4;
      const e = x * 3;
      const a = rgba[p + 3];
      // Clamp, so that a colour the palette cannot reach does not build up an ever-growing error.
      const r = Math.min(255, Math.max(0, overWhite(rgba[p], a) + thisRow[e]));
      const g = Math.min(255, Math.max(0, overWhite(rgba[p + 1], a) + thisRow[e + 1]));
      const b = Math.min(255, Math.max(0, overWhite(rgba[p + 2], a) + thisRow[e + 2]));
      const chosen = PALETTE[nearest(r, g, b)];
      codes[y * width + x] = chosen.code;
      const ahead = x + step;
      const behind = x - step;
      const hasAhead = ahead >= 0 && ahead < width;
      const hasBehind = behind >= 0 && behind < width;
      for (let c = 0; c < 3; c++) {
        const error = (c === 0 ? r : c === 1 ? g : b) - chosen.rgb[c];
        if (hasAhead) {
          thisRow[ahead * 3 + c] += (error * 7) / 16;
          nextRow[ahead * 3 + c] += error / 16;
        }
        if (hasBehind) nextRow[behind * 3 + c] += (error * 3) / 16;
        nextRow[e + c] += (error * 5) / 16;
      }
    }
    [thisRow, nextRow] = [nextRow, thisRow];
    nextRow.fill(0);
  }
  return codes;
}

// rgba: width * height * 4 bytes, rows top to bottom. Alpha is taken as opaque over white.
// Returns one colour code per pixel (the codes of PALETTE: 0, 1, 2, 3, 5, 6).
// Without dither, each pixel takes its nearest palette colour: right for the page, which is drawn in the six
// colours already. With dither, the error is spread to the neighbours: for photos and logos.
export function quantise(rgba, width, height, { dither = false } = {}) {
  checkPicture(rgba, width, height);
  return dither ? quantiseDithered(rgba, width, height) : quantiseNearest(rgba, width, height);
}
