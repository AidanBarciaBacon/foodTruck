import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, quantise } from "../lib/quantise.mjs";

const CODE = Object.fromEntries(PALETTE.map((c) => [c.name, c.code]));
const RGB = Object.fromEntries(PALETTE.map((c) => [c.name, c.rgb]));
const NAME = Object.fromEntries(PALETTE.map((c) => [c.code, c.name]));

// A picture from a list of [r, g, b] or [r, g, b, a] pixels, `width` to a row.
function picture(pixels, width = pixels.length) {
  const rgba = new Uint8Array(pixels.length * 4);
  pixels.forEach(([r, g, b, a = 255], i) => rgba.set([r, g, b, a], i * 4));
  return { rgba, width, height: pixels.length / width };
}

// The name of the colour one pixel goes to.
function nameOf(pixel, options) {
  return NAME[quantise(picture([pixel]).rgba, 1, 1, options)[0]];
}

// The 256 steps from colour a to colour b, mixed in sRGB values as a browser mixes an anti-aliased edge.
function blends(a, b) {
  return Array.from({ length: 256 }, (_, t) => a.map((v, c) => Math.round(v + ((b[c] - v) * t) / 255)));
}

// The set of colour names a list of pixels goes to.
function namesOf(pixels) {
  const { rgba, width, height } = picture(pixels);
  return new Set([...quantise(rgba, width, height)].map((code) => NAME[code]));
}

function flat(pixel, width, height) {
  return picture(Array.from({ length: width * height }, () => pixel), width);
}

test("PALETTE is the contract's table", () => {
  assert.deepEqual(
    PALETTE.map((c) => [c.name, c.code, c.rgb]),
    [
      ["black", 0, [0x00, 0x00, 0x00]],
      ["white", 1, [0xff, 0xff, 0xff]],
      ["yellow", 2, [0xf5, 0xd0, 0x00]],
      ["red", 3, [0xd0, 0x02, 0x1b]],
      ["blue", 5, [0x1f, 0x4f, 0xd8]],
      ["green", 6, [0x1e, 0x8e, 0x3e]],
    ],
  );
});

test("returns one code per pixel, in order", () => {
  const { rgba } = picture([RGB.red, RGB.blue, RGB.white, RGB.black, RGB.green, RGB.yellow], 3);
  const codes = quantise(rgba, 3, 2);
  assert.ok(codes instanceof Uint8Array);
  assert.deepEqual([...codes], [3, 5, 1, 0, 6, 2]);
});

test("takes a Buffer as well as a Uint8Array", () => {
  const { rgba } = picture([RGB.green, RGB.yellow]);
  assert.deepEqual([...quantise(Buffer.from(rgba), 2, 1)], [6, 2]);
});

test("every palette colour maps to itself", () => {
  for (const { name, rgb } of PALETTE) {
    assert.equal(nameOf(rgb), name);
    assert.equal(nameOf(rgb, { dither: true }), name);
  }
});

test("mid greys go to black or white, never to a colour", () => {
  assert.equal(nameOf([64, 64, 64]), "black");
  assert.equal(nameOf([190, 190, 190]), "white");
  assert.ok(["black", "white"].includes(nameOf([128, 128, 128])));
  const all = Array.from({ length: 256 }, (_, v) => [v, v, v]);
  assert.deepEqual([...namesOf(all)].sort(), ["black", "white"]);
});

test("greys split into a dark run and a light run, near the middle", () => {
  const names = Array.from({ length: 256 }, (_, v) => nameOf([v, v, v]));
  const firstWhite = names.indexOf("white");
  assert.ok(firstWhite >= 110 && firstWhite <= 146, `first white grey is ${firstWhite}`);
  assert.ok(names.slice(0, firstWhite).every((n) => n === "black"));
  assert.ok(names.slice(firstWhite).every((n) => n === "white"));
});

test("a soft red edge between red and white goes to red or white only", () => {
  assert.deepEqual([...namesOf(blends(RGB.red, RGB.white))].sort(), ["red", "white"]);
  assert.equal(nameOf([220, 80, 95]), "red"); // mostly red
  assert.equal(nameOf([246, 205, 209]), "white"); // a faint pink
});

test("a light blue-ish pixel between blue and white goes to blue or white", () => {
  assert.deepEqual([...namesOf(blends(RGB.blue, RGB.white))].sort(), ["blue", "white"]);
  assert.equal(nameOf([75, 114, 224]), "blue"); // mostly blue
  assert.equal(nameOf([210, 221, 247]), "white"); // a faint blue
});

test("the edge of any colour against black or against white keeps to those two", () => {
  for (const ground of ["black", "white"]) {
    for (const { name, rgb } of PALETTE) {
      if (name === ground) continue;
      const got = [...namesOf(blends(rgb, RGB[ground]))].sort();
      assert.deepEqual(got, [name, ground].sort(), `${name} on ${ground}`);
    }
  }
});

test("slightly off-colour pixels still go to their colour", () => {
  for (const { name, rgb } of PALETTE) {
    for (const nudge of [-6, 6]) {
      const near = rgb.map((v) => Math.min(255, Math.max(0, v + nudge)));
      assert.equal(nameOf(near), name, `${name} nudged by ${nudge}`);
    }
  }
});

test("alpha is laid over white", () => {
  assert.equal(nameOf([0, 0, 0, 0]), "white"); // fully see-through black is the white page
  assert.equal(nameOf([208, 2, 27, 0]), "white");
  assert.equal(nameOf([0, 0, 0, 40]), "white"); // a faint black is a light grey
  assert.equal(nameOf([0, 0, 0, 230]), "black");
  assert.equal(nameOf([208, 2, 27, 235]), "red");
  assert.equal(nameOf([208, 2, 27, 20]), "white");
  assert.equal(nameOf([31, 79, 216, 255]), "blue"); // opaque is untouched
  // Half see-through black is a mid grey: black or white, not a colour.
  assert.ok(["black", "white"].includes(nameOf([0, 0, 0, 128])));
  // The same over-white rule with dithering on.
  assert.equal(nameOf([0, 0, 0, 0], { dither: true }), "white");
});

test("alpha gives the same answer as the pixel already mixed with white", () => {
  for (const { rgb } of PALETTE) {
    for (const alpha of [0, 1, 64, 127, 128, 200, 254, 255]) {
      const mixed = rgb.map((v) => Math.round((v * alpha + 255 * (255 - alpha)) / 255));
      assert.equal(nameOf([...rgb, alpha]), nameOf(mixed), `${rgb} at alpha ${alpha}`);
    }
  }
});

test("dithering a flat 50% grey gives black and white only, about half of each", () => {
  const { rgba, width, height } = flat([128, 128, 128], 80, 60);
  const codes = quantise(rgba, width, height, { dither: true });
  assert.equal(codes.length, width * height);
  const counts = new Map();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  assert.deepEqual([...counts.keys()].sort(), [CODE.black, CODE.white]);
  const whiteShare = counts.get(CODE.white) / codes.length;
  assert.ok(whiteShare > 0.45 && whiteShare < 0.55, `white share is ${whiteShare}`);
});

test("dithering mixes finely: every 4 x 4 block of a 50% grey has both black and white", () => {
  const { rgba, width, height } = flat([128, 128, 128], 80, 60);
  const codes = quantise(rgba, width, height, { dither: true });
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      const block = new Set();
      for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) block.add(codes[y * width + x]);
      assert.equal(block.size, 2, `block at ${bx}, ${by}`);
    }
  }
});

test("dithering keeps the average colour of a flat area", () => {
  // Colours the palette can mix: a light grey, a pink (red and white), an orange (red and yellow).
  for (const pixel of [[200, 200, 200], [232, 128, 141], [226, 105, 14]]) {
    const { rgba, width, height } = flat(pixel, 96, 96);
    const codes = quantise(rgba, width, height, { dither: true });
    const sum = [0, 0, 0];
    for (const code of codes) RGB[NAME[code]].forEach((v, c) => (sum[c] += v));
    const mean = sum.map((v) => v / codes.length);
    mean.forEach((v, c) => {
      assert.ok(Math.abs(v - pixel[c]) < 4, `${pixel}: channel ${c} averages ${v.toFixed(1)}`);
    });
  }
});

test("dithering leaves a picture already in the six colours alone", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pixels = Array.from({ length: 40 * 30 }, () => PALETTE[Math.floor(random() * PALETTE.length)].rgb);
  const { rgba, width, height } = picture(pixels, 40);
  assert.deepEqual(quantise(rgba, width, height, { dither: true }), quantise(rgba, width, height));
});

test("without dithering a flat grey stays flat", () => {
  const { rgba, width, height } = flat([128, 128, 128], 16, 16);
  assert.equal(new Set(quantise(rgba, width, height)).size, 1);
  assert.equal(new Set(quantise(rgba, width, height, { dither: false })).size, 1);
});

test("handles the full 800 x 480 picture", () => {
  const rgba = new Uint8Array(800 * 480 * 4).fill(255);
  const codes = quantise(rgba, 800, 480);
  assert.equal(codes.length, 384000);
  assert.ok(codes.every((code) => code === CODE.white));
});

test("throws when the picture is not width x height x 4 bytes", () => {
  assert.throws(() => quantise(new Uint8Array(15), 2, 2), RangeError);
  assert.throws(() => quantise(new Uint8Array(16), 2, 3), RangeError);
  assert.throws(() => quantise(new Uint8Array(0), 0, 0), RangeError);
  assert.throws(() => quantise(new Uint8Array(16), 2.5, 2), RangeError);
});
