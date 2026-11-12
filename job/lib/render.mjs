// The page -> an 800 x 480 screenshot, taken in the headless Chrome already on the machine.
//
// screenshot() serves the page's folder on 127.0.0.1, opens index.html?screen=1&data=<file> in Chrome, waits for
// the page to say it is drawn (document.documentElement.dataset.ready = "1"), takes a PNG of exactly 800 x 480
// and decodes it to RGBA with the small PNG reader below (node:zlib only, so the job needs no PNG dependency).

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

export const WIDTH = 800;
export const HEIGHT = 480;
export const READY_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------------------------------------------
// Chrome

const USUAL_CHROME_PATHS = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium-browser"],
};

/**
 * The Chrome to drive: the `chromePath` argument, else the CHROME_PATH environment variable, else the usual
 * location for the platform. Throws an error with `code: "NO_CHROME"` that names what it tried.
 */
export function findChrome(chromePath, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const asked = chromePath
    ? { path: chromePath, from: "the chromePath argument" }
    : env.CHROME_PATH
      ? { path: env.CHROME_PATH, from: "the CHROME_PATH environment variable" }
      : null;
  if (asked) {
    if (exists(asked.path)) return asked.path;
    throw noChrome(`No Chrome at ${asked.path} (from ${asked.from}).`);
  }
  const usual = USUAL_CHROME_PATHS[platform] ?? [];
  const found = usual.find((candidate) => exists(candidate));
  if (found) return found;
  const tried = usual.length ? `Tried: ${usual.join(", ")}.` : `No usual location is known for "${platform}".`;
  throw noChrome(`No Chrome found. ${tried} Set CHROME_PATH to a Chrome or Chromium program.`);
}

function noChrome(message) {
  return Object.assign(new Error(message), { code: "NO_CHROME" });
}

// ---------------------------------------------------------------------------------------------------------------
// A static file server for one folder, on 127.0.0.1 only

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Is `file` the folder `root` itself or something inside it? Both are absolute paths. */
function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Serves the files of `dir` (GET and HEAD only, no listings, nothing outside the folder, by name or through a
 * symlink) on 127.0.0.1 on a free port. Resolves to `{ origin, close }`.
 */
export async function serveDir(dir) {
  const root = await realpath(path.resolve(dir));

  const server = createServer(async (request, response) => {
    const send = (status, text) => {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : text);
    };
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return send(405, "Method not allowed");
      // The path is taken as sent ("/../x" is not tidied away first), decoded once, and must stay inside the folder.
      const rawPath = (request.url ?? "/").split(/[?#]/, 1)[0];
      let urlPath;
      try {
        urlPath = decodeURIComponent(rawPath);
      } catch {
        return send(400, "Bad request");
      }
      if (urlPath.includes("\0")) return send(400, "Bad request");
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const wanted = path.join(root, urlPath);
      if (!isInside(root, wanted)) return send(403, "Forbidden");
      let file;
      let info;
      try {
        file = await realpath(wanted);
        info = await stat(file);
      } catch {
        return send(404, "Not found");
      }
      if (!isInside(root, file)) return send(403, "Forbidden");
      if (!info.isFile()) return send(404, "Not found");
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": info.size,
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") return response.end();
      createReadStream(file)
        .on("error", () => response.destroy())
        .pipe(response);
    } catch {
      if (response.headersSent) response.destroy();
      else send(500, "Server error");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A tiny PNG reader: 8 bits per channel, RGB or RGBA, not interlaced, all five row filters. That is what Chrome
// writes for a screenshot; anything else is refused by name.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a PNG to `{ rgba: Uint8Array(width * height * 4), width, height }`. */
export function decodePng(data) {
  const png = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Not a PNG: the signature is wrong");

  let header = null;
  const compressed = [];
  let ended = false;
  for (let at = 8; at + 12 <= png.length && !ended; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (body.length !== length) throw new Error(`PNG cut short inside its ${type} chunk`);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("PNG has a malformed IHDR chunk");
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colourType: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") {
      compressed.push(body);
    } else if (type === "IEND") {
      ended = true;
    }
    at += 12 + length; // length, type, body, CRC (zlib's own checksum guards the pixels)
  }
  if (!header) throw new Error("PNG has no IHDR chunk");
  if (!ended) throw new Error("PNG cut short: no IEND chunk");

  const { width, height, bitDepth, colourType, interlace } = header;
  if (width === 0 || height === 0) throw new Error("PNG has no pixels");
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(
      `PNG kind not supported: bit depth ${bitDepth}, colour type ${colourType} (only 8-bit RGB and RGBA are read)`,
    );
  }
  if (interlace !== 0) throw new Error("PNG kind not supported: interlaced");

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`PNG pixel data is ${raw.length} bytes, expected ${(stride + 1) * height}`);
  }

  // Undo the row filters in place. Each row is one filter byte, then `stride` bytes.
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    const above = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[above + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[above + x - channels] : 0;
      let predicted;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = (left + up) >> 1;
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const dLeft = Math.abs(estimate - left);
          const dUp = Math.abs(estimate - up);
          const dUpLeft = Math.abs(estimate - upLeft);
          predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
          break;
        }
        default:
          throw new Error(`PNG row ${y} uses unknown filter ${filter}`);
      }
      pixels[row + x] = (raw[from + x] + predicted) & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  if (channels === 4) {
    rgba.set(pixels);
  } else {
    for (let i = 0, o = 0; i < pixels.length; i += 3, o += 4) {
      rgba[o] = pixels[i];
      rgba[o + 1] = pixels[i + 1];
      rgba[o + 2] = pixels[i + 2];
      rgba[o + 3] = 255;
    }
  }
  return { rgba, width, height };
}

// ---------------------------------------------------------------------------------------------------------------
// The screenshot

function seconds(ms) {
  const n = ms / 1000;
  return `${n} ${n === 1 ? "second" : "seconds"}`;
}

/**
 * Photographs the page in `pageDir` at 800 x 480.
 *
 * @param {object} options
 * @param {string} options.pageDir     the folder holding index.html (and the data file)
 * @param {string} [options.dataFile]  the today.json to show, as a name relative to pageDir; left out, the page
 *                                     reads its own default
 * @param {string} [options.chromePath]      see findChrome()
 * @param {number} [options.readyTimeoutMs]  how long to wait for the page's ready flag (15 seconds)
 * @returns {Promise<{ rgba: Uint8Array, width: 800, height: 480 }>}
 */
export async function screenshot({ pageDir, dataFile, chromePath, readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
  if (!pageDir) throw new Error("screenshot() needs pageDir, the folder that holds index.html");
  if (!existsSync(path.join(pageDir, "index.html"))) throw new Error(`No index.html in ${pageDir}`);
  const executablePath = findChrome(chromePath);
  const { default: puppeteer } = await import("puppeteer-core");

  let server = null;
  let browser = null;
  try {
    server = await serveDir(pageDir);
    const url = new URL("/index.html", server.origin);
    url.searchParams.set("screen", "1");
    if (dataFile) url.searchParams.set("data", dataFile);

    const args = ["--hide-scrollbars", "--force-color-profile=srgb", "--force-device-scale-factor=1"];
    // Some Linux machines (containers, some CI images) cannot start Chrome's sandbox. The page is our own, served
    // from this machine, so the job may run without it there: CHROME_NO_SANDBOX=1.
    if (process.env.CHROME_NO_SANDBOX === "1") args.push("--no-sandbox");
    browser = await puppeteer.launch({
      executablePath,
      headless: true, // never a window
      args,
      defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    });

    const page = await browser.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push(`script error: ${error?.message ?? error}`));
    page.on("requestfailed", (request) => problems.push(`could not load ${request.url()}`));
    page.on("response", (response) => {
      // (Chrome asks for a favicon by itself; the page has none, and that is no problem.)
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        problems.push(`${response.status()} for ${response.url()}`);
      }
    });

    const response = await page.goto(url.href, { waitUntil: "load", timeout: 30_000 });
    if (!response || !response.ok()) {
      throw new Error(`Could not open the page: ${response ? response.status() : "no response"} for ${url.href}`);
    }

    try {
      await page.waitForFunction(() => document.documentElement.dataset.ready === "1", { timeout: readyTimeoutMs });
    } catch (error) {
      if (error?.name !== "TimeoutError") throw error;
      const seen = problems.length ? ` The page reported: ${problems.slice(0, 5).join("; ")}.` : "";
      throw Object.assign(
        new Error(
          `The page did not say it was drawn within ${seconds(readyTimeoutMs)}: ` +
            `document.documentElement.dataset.ready never became "1" (${url.pathname}${url.search}).${seen}`,
        ),
        { code: "PAGE_NOT_READY" },
      );
    }

    const png = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      captureBeyondViewport: false,
    });
    const picture = decodePng(png);
    if (picture.width !== WIDTH || picture.height !== HEIGHT) {
      throw new Error(`The screenshot came out ${picture.width} x ${picture.height}, not ${WIDTH} x ${HEIGHT}`);
    }
    return picture;
  } finally {
    // Always, also on errors: the browser first, then the server it was reading from.
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}
