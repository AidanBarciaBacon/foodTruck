// lib/render.mjs: the PNG reader, the static server, finding Chrome, and the screenshot itself.
// The screenshot tests need a real Chrome and are skipped, with the reason, when none is found. No network.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { deflateSync } from "node:zlib";

import { decodePng, findChrome, screenshot, serveDir } from "../lib/render.mjs";

// --- a small PNG writer, for the reader's tests only ---------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  return dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
}

/** Writes a PNG. `filterOf(y)` picks each row's filter (0 to 4); `split` cuts the data into two IDAT chunks there. */
function encodePng(pixels, width, height, channels, options = {}) {
  const { filterOf = () => 0, bitDepth = 8, interlace = 0, colourType, split = 0 } = options;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filterOf(y);
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const at = (yy, xx) => (yy < 0 || xx < 0 ? 0 : pixels[yy * stride + xx]);
      const left = at(y, x - channels);
      const up = at(y - 1, x);
      const upLeft = at(y - 1, x - channels);
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      raw[y * (stride + 1) + 1 + x] = (pixels[y * stride + x] - predicted) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colourType ?? (channels === 4 ? 6 : 2);
  header[12] = interlace;
  const data = deflateSync(raw);
  const idats = split ? [data.subarray(0, split), data.subarray(split)] : [data];
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from("Comment\0a chunk the reader skips", "latin1")),
    ...idats.map((part) => chunk("IDAT", part)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Repeatable noise, so every filter has real work to undo. */
function noise(length, seed = 1) {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

describe("decodePng", () => {
  test("reads RGBA through each of the five row filters", () => {
    const [width, height] = [13, 11];
    const pixels = noise(width * height * 4, 7);
    for (let filter = 0; filter <= 4; filter++) {
      const decoded = decodePng(encodePng(pixels, width, height, 4, { filterOf: () => filter }));
      assert.equal(decoded.width, width);
      assert.equal(decoded.height, height);
      assert.ok(decoded.rgba instanceof Uint8Array);
      assert.deepEqual(Buffer.from(decoded.rgba), Buffer.from(pixels), `filter ${filter}`);
    }
  });

  test("reads RGB (alpha becomes 255), mixed filters, data split across IDAT chunks", () => {
    const [width, height] = [17, 10];
    const pixels = noise(width * height * 3, 99);
    const decoded = decodePng(encodePng(pixels, width, height, 3, { filterOf: (y) => y % 5, split: 20 }));
    assert.equal(decoded.rgba.length, width * height * 4);
    for (let i = 0; i < width * height; i++) {
      assert.deepEqual(
        [...decoded.rgba.subarray(i * 4, i * 4 + 4)],
        [pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], 255],
        `pixel ${i}`,
      );
    }
  });

  test("takes a plain Uint8Array as well as a Buffer", () => {
    const png = encodePng(new Uint8Array([10, 20, 30, 40]), 1, 1, 4);
    const view = new Uint8Array(png.length + 3);
    view.set(png, 3);
    assert.deepEqual([...decodePng(view.subarray(3)).rgba], [10, 20, 30, 40]);
  });

  test("refuses, by name, what it cannot read", () => {
    const one = new Uint8Array(8);
    assert.throws(() => decodePng(Buffer.from("not a png at all")), /Not a PNG/);
    assert.throws(() => decodePng(encodePng(one, 1, 1, 4, { interlace: 1 })), /interlaced/);
    assert.throws(() => decodePng(encodePng(one, 1, 1, 4, { bitDepth: 16 })), /bit depth 16/);
    assert.throws(() => decodePng(encodePng(one, 1, 1, 3, { colourType: 3 })), /colour type 3/);
    assert.throws(() => decodePng(encodePng(one, 1, 1, 4, { filterOf: () => 5 })), /unknown filter 5/);
    assert.throws(() => decodePng(encodePng(one, 1, 1, 4).subarray(0, 40)), /cut short/);
  });
});

describe("findChrome", () => {
  const none = () => false;

  test("takes the argument first, then CHROME_PATH, then the usual places", () => {
    const all = () => true;
    assert.equal(findChrome("/a/chrome", { env: { CHROME_PATH: "/b/chrome" }, platform: "linux", exists: all }), "/a/chrome");
    assert.equal(findChrome(undefined, { env: { CHROME_PATH: "/b/chrome" }, platform: "linux", exists: all }), "/b/chrome");
    assert.equal(findChrome(undefined, { env: {}, platform: "linux", exists: all }), "/usr/bin/google-chrome");
    assert.equal(
      findChrome(undefined, { env: {}, platform: "linux", exists: (file) => file === "/usr/bin/chromium-browser" }),
      "/usr/bin/chromium-browser",
    );
    assert.equal(
      findChrome(undefined, { env: {}, platform: "darwin", exists: all }),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  });

  test("says what it tried when there is none", () => {
    assert.throws(
      () => findChrome(undefined, { env: {}, platform: "linux", exists: none }),
      (error) =>
        error.code === "NO_CHROME" &&
        error.message.includes("/usr/bin/google-chrome") &&
        error.message.includes("/usr/bin/chromium-browser") &&
        error.message.includes("CHROME_PATH"),
    );
    assert.throws(
      () => findChrome(undefined, { env: { CHROME_PATH: "/nope/chrome" }, platform: "linux", exists: none }),
      (error) => error.code === "NO_CHROME" && /\/nope\/chrome .*CHROME_PATH/.test(error.message),
    );
    assert.throws(
      () => findChrome("/arg/chrome", { env: {}, platform: "darwin", exists: none }),
      (error) => error.code === "NO_CHROME" && /\/arg\/chrome .*chromePath/.test(error.message),
    );
  });
});

// --- things on disk ---------------------------------------------------------------------------------------------

let scratch;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "foodtruck-render-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** One raw HTTP request, so a path like "/../x" reaches the server as written. */
function rawGet(origin, rawPath, method = "GET") {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path: rawPath, method }, (response) => {
      const parts = [];
      response.on("data", (part) => parts.push(part));
      response.on("end", () =>
        resolve({ status: response.statusCode, type: response.headers["content-type"], body: Buffer.concat(parts).toString() }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("serveDir", () => {
  let server;
  before(async () => {
    const site = path.join(scratch, "site");
    await mkdir(path.join(site, "sub"), { recursive: true });
    await writeFile(path.join(site, "index.html"), "<p>hello</p>");
    await writeFile(path.join(site, "today.json"), '{"v":1}');
    await writeFile(path.join(site, "sub", "a b.txt"), "spaced");
    await writeFile(path.join(scratch, "secret.txt"), "outside the folder");
    await symlink(path.join(scratch, "secret.txt"), path.join(site, "link.txt"));
    server = await serveDir(site);
  });
  after(async () => {
    await server.close();
  });

  test("listens on 127.0.0.1 and serves the folder's files with their types", async () => {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await rawGet(server.origin, "/index.html?screen=1&data=today.json");
    assert.deepEqual([page.status, page.body], [200, "<p>hello</p>"]);
    assert.match(page.type, /^text\/html/);
    assert.equal((await rawGet(server.origin, "/")).body, "<p>hello</p>");
    const data = await rawGet(server.origin, "/today.json");
    assert.deepEqual([data.status, data.body], [200, '{"v":1}']);
    assert.match(data.type, /^application\/json/);
    assert.equal((await rawGet(server.origin, "/sub/a%20b.txt")).body, "spaced");
    const head = await rawGet(server.origin, "/index.html", "HEAD");
    assert.deepEqual([head.status, head.body], [200, ""]);
  });

  test("gives 404 for what is not there and for folders, 405 for anything but GET and HEAD", async () => {
    assert.equal((await rawGet(server.origin, "/missing.html")).status, 404);
    assert.equal((await rawGet(server.origin, "/sub")).status, 404);
    assert.equal((await rawGet(server.origin, "/index.html", "POST")).status, 405);
  });

  test("serves nothing outside the folder", async () => {
    for (const escape of ["/../secret.txt", "/%2e%2e/secret.txt", "/sub/../../secret.txt", "/..%2fsecret.txt", "/link.txt"]) {
      const response = await rawGet(server.origin, escape);
      assert.ok([403, 404].includes(response.status), `${escape} gave ${response.status}`);
      assert.doesNotMatch(response.body, /outside the folder/, escape);
    }
    assert.equal((await rawGet(server.origin, "/%zz")).status, 400);
  });
});

// --- the screenshot, in a real Chrome ---------------------------------------------------------------------------

let noChrome = false;
try {
  findChrome();
} catch (error) {
  noChrome = `skipped, no Chrome to test with: ${error.message}`;
}

describe("screenshot", () => {
  async function pageDir(name, html) {
    const dir = path.join(scratch, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), html);
    return dir;
  }

  test("photographs a solid red page at 800 x 480", { skip: noChrome }, async () => {
    const dir = await pageDir(
      "red",
      `<!doctype html><html><head><meta charset="utf-8">
       <style>html, body { margin: 0; width: 800px; height: 480px; background: #ff0000; overflow: hidden; }</style></head>
       <body><script>
         const query = new URLSearchParams(location.search);
         fetch(query.get("data")).then((r) => r.json()).then((data) => {
           if (query.get("screen") === "1" && data.ok) document.documentElement.dataset.ready = "1";
         });
       </script></body></html>`,
    );
    await writeFile(path.join(dir, "sample.json"), '{"ok":true}');

    const shot = await screenshot({ pageDir: dir, dataFile: "sample.json" });
    assert.equal(shot.width, 800);
    assert.equal(shot.height, 480);
    assert.ok(shot.rgba instanceof Uint8Array);
    assert.equal(shot.rgba.length, 800 * 480 * 4);
    const pixel = (x, y) => [...shot.rgba.subarray((y * 800 + x) * 4, (y * 800 + x) * 4 + 4)];
    assert.deepEqual(pixel(400, 240), [255, 0, 0, 255], "the centre pixel");
    assert.deepEqual(pixel(0, 0), [255, 0, 0, 255], "the top left pixel");
    assert.deepEqual(pixel(799, 479), [255, 0, 0, 255], "the bottom right pixel");
  });

  test("fails with a clear error when the page never says it is drawn", { skip: noChrome }, async () => {
    const dir = await pageDir("never-ready", "<!doctype html><html><body>never ready</body></html>");
    await assert.rejects(
      screenshot({ pageDir: dir, dataFile: "today.json", readyTimeoutMs: 500 }),
      (error) => {
        assert.equal(error.code, "PAGE_NOT_READY");
        assert.match(error.message, /did not say it was drawn within 0\.5 seconds/);
        assert.match(error.message, /dataset\.ready/);
        return true;
      },
    );
  });

  test("says so when there is no page to open", async () => {
    await assert.rejects(screenshot({ pageDir: path.join(scratch, "no-such-folder") }), /No index\.html in/);
  });
});
