#!/usr/bin/env node
// The whole morning job: today's trucks -> today.json -> the page -> a screenshot -> the six colours ->
// today.bin, today.png and status.json, all in dist/ (see docs/software/CONTRACT.md).
//
//   node build.mjs [--out <dir>] [--now <ISO time>] [--data <today.json>] [--market-dates a,b,c]
//
// It exits non-zero only when it could not produce the files at all. A feed that cannot be read still gives the
// "Couldn't read the truck list today" picture and exit 0, with a warning on stderr.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { screenshot as takeScreenshot } from "./lib/render.mjs";

const JOB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(JOB_DIR, "..");

export const WIDTH = 800;
export const HEIGHT = 480;
export const BIN_BYTES = (WIDTH * HEIGHT) / 2; // 192,000
export const DEFAULT_OUT = path.join(REPO_ROOT, "dist");
export const PAGE_FILES = ["index.html", "page.css", "page.js"];

const STATES = ["market", "no-market", "error"];
const PACIFIC = "America/Los_Angeles";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const USAGE = `Usage: node build.mjs [options]

  --out <dir>            where the files go (default: dist/ at the repo root)
  --now <ISO time>       run as if it were this moment, e.g. 2026-11-12T06:30:00-08:00
  --data <file>          skip the feed and show this today.json
  --market-dates a,b,c   with --data: the market days (YYYY-MM-DD) the next wake is worked out from
                         (default: none)
  --lib <dir>            for testing: read trucks, schedule, quantise and pack from this folder
  --page <dir>           for testing: copy the page from this folder
  --help                 this text

Environment: PAGE_URL (the address printed on the picture, default none), CHROME_PATH (the Chrome to use).`;

// ---------------------------------------------------------------------------------------------------------------
// Pure parts

/**
 * Reads the command line (without `node build.mjs`). Returns only the options that were given, as `build()`
 * takes them: `{ out, now, data, marketDates, lib, page, help }`. Throws on anything it does not understand.
 */
export function parseArgs(argv, { cwd = process.cwd() } = {}) {
  const names = {
    "--out": "out",
    "--now": "now",
    "--data": "data",
    "--market-dates": "marketDates",
    "--lib": "lib",
    "--page": "page",
  };
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;
    const equals = flag.startsWith("--") ? flag.indexOf("=") : -1;
    if (equals !== -1) {
      value = flag.slice(equals + 1);
      flag = flag.slice(0, equals);
    }
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    const name = names[flag];
    if (!name) throw new Error(`Unknown option: ${argv[i]}`);
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
    }
    if (name === "now") {
      const now = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(now.getTime())) {
        throw new Error(`--now needs an ISO time such as 2026-11-12T06:30:00-08:00, not "${value}"`);
      }
      options.now = now;
    } else if (name === "marketDates") {
      const dates = value
        .split(",")
        .map((date) => date.trim())
        .filter(Boolean);
      const bad = dates.find((date) => !DAY.test(date));
      if (bad) throw new Error(`--market-dates needs days as YYYY-MM-DD with commas between, not "${bad}"`);
      options.marketDates = dates;
    } else {
      if (value === "") throw new Error(`${flag} needs a value`);
      options[name] = path.resolve(cwd, value);
    }
  }
  if (options.marketDates && !options.data) {
    throw new Error("--market-dates only goes with --data (without it the market days come from the feed)");
  }
  return options;
}

/** The fingerprint of today.bin: the first 16 hex characters of its SHA-256. */
export function binHash(bin) {
  return createHash("sha256").update(bin).digest("hex").slice(0, 16);
}

/** status.json, exactly as the contract gives it. `now` is a Date; `nextWake` is Unix seconds. */
export function buildStatus({ today, bin, now, nextWake }) {
  if (!DAY.test(today?.date ?? "")) throw new Error(`today.json has a bad date: ${JSON.stringify(today?.date)}`);
  if (!STATES.includes(today.state)) throw new Error(`today.json has a bad state: ${JSON.stringify(today.state)}`);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("now must be a Date");
  if (!Number.isSafeInteger(nextWake) || nextWake <= 0) {
    throw new Error(`nextWake must be whole Unix seconds, not ${JSON.stringify(nextWake)}`);
  }
  return {
    v: 1,
    date: today.date,
    state: today.state,
    hash: binHash(bin),
    bytes: bin.length,
    generatedAt: Math.floor(now.getTime() / 1000),
    nextWake,
  };
}

/** A moment as a Pacific date and time, for the summary: "Mon, Nov 16, 2026, 7:00 AM PST". */
export function pacificLabel(unixSeconds) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
    .format(new Date(unixSeconds * 1000))
    .replace(/ /g, " ");
}

/**
 * The "error" today.json, made here only when the truck data could not even say that itself (loadToday threw,
 * which the contract says it does not do). Same fields and Pacific labels as the truck data's own.
 */
export function errorToday(now, reason) {
  const format = (options) => new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, ...options });
  const parts = Object.fromEntries(
    format({
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "long",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const offset = parts.timeZoneName.replace("GMT", "") || "+00:00";
  const clock = format({ hour: "numeric", minute: "2-digit" }).format(now).replace(/ /g, " ");
  return {
    v: 1,
    date,
    weekday: parts.weekday,
    dateLabel: format({ weekday: "long", month: "short", day: "numeric" }).format(now),
    generatedAt: `${date}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
    updatedLabel: `Updated ${clock}`,
    state: "error",
    market: null,
    trucks: [],
    next: null,
    error: String(reason).slice(0, 200),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The job

const LIB_FILES = { loadToday: "trucks.mjs", nextWake: "schedule.mjs", quantise: "quantise.mjs", pack: "pack.mjs", toPng: "pack.mjs" };

/** The other parts' functions, by the contract's names: from `given` first, else imported from the `lib` folder. */
async function loadParts(lib, given, names) {
  const parts = {};
  for (const name of names) {
    if (given[name]) {
      parts[name] = given[name];
      continue;
    }
    const file = path.join(lib, LIB_FILES[name]);
    const module = await import(pathToFileURL(file).href);
    if (typeof module[name] !== "function") throw new Error(`${file} does not export ${name}()`);
    parts[name] = module[name];
  }
  return parts;
}

function checkToday(today, where) {
  if (!today || typeof today !== "object" || Array.isArray(today)) throw new Error(`${where} is not a today.json object`);
  if (!STATES.includes(today.state)) throw new Error(`${where} has a bad state: ${JSON.stringify(today.state)}`);
  if (!DAY.test(today.date ?? "")) throw new Error(`${where} has a bad date: ${JSON.stringify(today.date)}`);
  return today;
}

/**
 * Runs the whole job and writes the published files into `out`.
 *
 * @param {object} [options]
 * @param {string} [options.out]            the folder to write (default: dist/ at the repo root)
 * @param {Date}   [options.now]            the moment to run as (default: now)
 * @param {string} [options.data]           a today.json to show instead of reading the feed
 * @param {string[]} [options.marketDates]  with `data`: the market days for the next wake (default: none)
 * @param {string} [options.pageUrl]        the address printed on the picture (default: PAGE_URL, else "")
 * @param {string} [options.chromePath]     the Chrome to use (default: see lib/render.mjs)
 * @param {string} [options.lib]            for testing: the folder trucks, schedule, quantise and pack come from
 * @param {string} [options.page]           for testing: the folder the page is copied from
 * @param {object} [options.parts]          for testing: any of loadToday, nextWake, quantise, pack, toPng,
 *                                          screenshot as functions, used instead of the files
 * @returns {Promise<{ out: string, today: object, status: object }>}
 */
export async function build({
  out = DEFAULT_OUT,
  now = new Date(),
  data,
  marketDates,
  pageUrl,
  chromePath,
  lib = path.join(JOB_DIR, "lib"),
  page = path.join(JOB_DIR, "page"),
  parts: given = {},
  log = console.log,
  warn = console.error,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("now must be a Date");
  const screenshot = given.screenshot ?? takeScreenshot;
  const parts = await loadParts(lib, given, [...(data ? [] : ["loadToday"]), "nextWake", "quantise", "pack", "toPng"]);

  // 1. Today's trucks.
  let today;
  let dates;
  if (data) {
    today = checkToday(JSON.parse(await readFile(data, "utf8")), data);
    dates = marketDates ?? [];
  } else {
    try {
      const loaded = await parts.loadToday({ now });
      today = checkToday(loaded?.today, "What loadToday() returned");
      dates = Array.isArray(loaded.marketDates) ? loaded.marketDates : [];
    } catch (error) {
      today = errorToday(now, error?.message ?? error);
      dates = [];
    }
  }
  today = { ...today, pageUrl: pageUrl ?? (process.env.PAGE_URL || today.pageUrl || "") };
  if (today.state === "error") {
    warn(
      `Warning: the truck list could not be read (${today.error ?? "no reason given"}). ` +
        `The picture will say "Couldn't read the truck list today".`,
    );
  }

  // 2. The page and its data, as they will be published.
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "today.json"), `${JSON.stringify(today, null, 2)}\n`);
  for (const file of PAGE_FILES) await copyFile(path.join(page, file), path.join(out, file));

  // 3. Photograph that page reading that today.json, and turn it into the six colours.
  const shot = await screenshot({ pageDir: out, dataFile: "today.json", chromePath });
  if (shot.width !== WIDTH || shot.height !== HEIGHT || shot.rgba.length !== WIDTH * HEIGHT * 4) {
    throw new Error(`The screenshot is ${shot.width} x ${shot.height}, not ${WIDTH} x ${HEIGHT}`);
  }
  const codes = parts.quantise(shot.rgba, WIDTH, HEIGHT, { dither: false });
  const bin = parts.pack(codes, WIDTH, HEIGHT);
  if (!(bin instanceof Uint8Array) || bin.length !== BIN_BYTES) {
    throw new Error(`today.bin must be exactly ${BIN_BYTES} bytes, but pack() gave ${bin?.length ?? "nothing"}`);
  }
  const png = parts.toPng(codes, WIDTH, HEIGHT);
  if (!(png instanceof Uint8Array) || png.length === 0) throw new Error("toPng() gave no picture");

  // 4. When the truck wakes next, and the fingerprint. status.json goes last: the truck reads it first.
  const status = buildStatus({ today, bin, now, nextWake: parts.nextWake({ now, marketDates: dates }) });
  await writeFile(path.join(out, "today.bin"), bin);
  await writeFile(path.join(out, "today.png"), png);
  await writeFile(path.join(out, "status.json"), `${JSON.stringify(status, null, 2)}\n`);

  const count = Array.isArray(today.trucks) ? today.trucks.length : 0;
  log(
    [
      `Morning picture for ${today.date} written to ${out}`,
      `  state      ${today.state}, ${count} ${count === 1 ? "truck" : "trucks"}`,
      `  hash       ${status.hash} (today.bin, ${status.bytes} bytes)`,
      `  next wake  ${pacificLabel(status.nextWake)}`,
    ].join("\n"),
  );
  return { out, today, status };
}

// ---------------------------------------------------------------------------------------------------------------
// Run as a program

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    await build(options);
    return 0;
  } catch (error) {
    console.error(`The morning picture could not be made.\n${error?.stack ?? error}`);
    return 1;
  }
}

function isEntryPoint() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
