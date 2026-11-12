// build.mjs: the parts that can be tested without the other modules, the feed or a browser. The command line,
// status.json, the stand-in "error" data, and the order of work with stand-in functions passed in.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BIN_BYTES, DEFAULT_OUT, binHash, build, buildStatus, errorToday, pacificLabel, parseArgs } from "../build.mjs";

const TODAY = {
  v: 1,
  date: "2026-11-12",
  weekday: "Thursday",
  dateLabel: "Thursday, Nov 12",
  generatedAt: "2026-11-12T06:31:04-08:00",
  updatedLabel: "Updated 6:31 AM",
  state: "market",
  market: { name: "Off the Grid: Levi's Plaza", hoursLabel: "11:00 AM – 2:00 PM" },
  trucks: [
    { name: "Big City Halal", food: "Halal" },
    { name: "Buri Buri", food: "Japanese" },
    { name: "J&D's BBQ", food: "BBQ" },
  ],
  next: { date: "2026-11-16", label: "Monday, Nov 16" },
  error: null,
};
const NOW = new Date("2026-11-12T06:31:04-08:00"); // 1794493864, the contract's example
const MONDAY_7AM = 1794841200; // 2026-11-16 07:00 PST, the contract's example

describe("parseArgs", () => {
  test("gives nothing when nothing is asked, so build() uses its defaults", () => {
    assert.deepEqual(parseArgs([]), {});
    assert.equal(path.basename(DEFAULT_OUT), "dist");
    assert.equal(path.dirname(DEFAULT_OUT), path.resolve(import.meta.dirname, "..", ".."));
  });

  test("reads every option, as --name value or --name=value", () => {
    const options = parseArgs(
      ["--out", "pictures", "--now=2026-11-12T06:30:00-08:00", "--data", "/tmp/sample.json", "--market-dates", "2026-11-12, 2026-11-16"],
      { cwd: "/work" },
    );
    assert.deepEqual(options, {
      out: "/work/pictures",
      now: new Date("2026-11-12T14:30:00Z"),
      data: "/tmp/sample.json",
      marketDates: ["2026-11-12", "2026-11-16"],
    });
    assert.ok(options.now instanceof Date);
    assert.deepEqual(parseArgs(["--lib=stubs", "--page", "../page"], { cwd: "/work/job" }), {
      lib: "/work/job/stubs",
      page: "/work/page",
    });
    assert.deepEqual(parseArgs(["--data", "a.json", "--market-dates", ""], { cwd: "/w" }), { data: "/w/a.json", marketDates: [] });
    assert.deepEqual(parseArgs(["--help"]), { help: true });
  });

  test("refuses what it does not understand", () => {
    assert.throws(() => parseArgs(["--fast"]), /Unknown option: --fast/);
    assert.throws(() => parseArgs(["extra"]), /Unknown option: extra/);
    assert.throws(() => parseArgs(["--out"]), /--out needs a value/);
    assert.throws(() => parseArgs(["--out="]), /--out needs a value/);
    assert.throws(() => parseArgs(["--now", "tomorrow"]), /--now needs an ISO time/);
    assert.throws(() => parseArgs(["--now", "2026-11-12"]), /--now needs an ISO time/);
    assert.throws(() => parseArgs(["--now", "2026-13-45T99:00:00Z"]), /--now needs an ISO time/);
    assert.throws(() => parseArgs(["--data", "a.json", "--market-dates", "Nov 12"]), /YYYY-MM-DD/);
    assert.throws(() => parseArgs(["--market-dates", "2026-11-12"]), /only goes with --data/);
  });
});

describe("buildStatus", () => {
  test("is the contract's status.json: these fields, in this order, with these types", () => {
    const bin = new Uint8Array(BIN_BYTES).fill(0x11);
    const status = buildStatus({ today: TODAY, bin, now: NOW, nextWake: MONDAY_7AM });
    assert.deepEqual(Object.keys(status), ["v", "date", "state", "hash", "bytes", "generatedAt", "nextWake"]);
    assert.deepEqual(status, {
      v: 1,
      date: "2026-11-12",
      state: "market",
      hash: createHash("sha256").update(bin).digest("hex").slice(0, 16),
      bytes: 192000,
      generatedAt: 1794493864,
      nextWake: 1794841200,
    });
    assert.match(status.hash, /^[0-9a-f]{16}$/);
    for (const field of ["v", "bytes", "generatedAt", "nextWake"]) assert.ok(Number.isInteger(status[field]), field);
    assert.deepEqual(JSON.parse(JSON.stringify(status)), status);
  });

  test("the hash is the first 16 hex characters of the SHA-256, and follows the picture", () => {
    assert.equal(binHash(Buffer.from("abc")), "ba7816bf8f01cfea"); // SHA-256("abc") = ba7816bf 8f01cfea 414140de ...
    const one = new Uint8Array(BIN_BYTES);
    const other = new Uint8Array(BIN_BYTES);
    other[BIN_BYTES - 1] = 1;
    assert.notEqual(binHash(one), binHash(other));
    assert.equal(binHash(one), binHash(new Uint8Array(BIN_BYTES)));
  });

  test("generatedAt is whole seconds, rounded down", () => {
    const status = buildStatus({ today: TODAY, bin: new Uint8Array(4), now: new Date(1794493864999), nextWake: MONDAY_7AM });
    assert.equal(status.generatedAt, 1794493864);
    assert.equal(status.bytes, 4);
  });

  test("refuses a today.json or a wake time it cannot vouch for", () => {
    const bin = new Uint8Array(4);
    assert.throws(() => buildStatus({ today: { ...TODAY, state: "closed" }, bin, now: NOW, nextWake: MONDAY_7AM }), /bad state/);
    assert.throws(() => buildStatus({ today: { ...TODAY, date: "Nov 12" }, bin, now: NOW, nextWake: MONDAY_7AM }), /bad date/);
    assert.throws(() => buildStatus({ today: TODAY, bin, now: NOW, nextWake: 1794841200.5 }), /nextWake/);
    assert.throws(() => buildStatus({ today: TODAY, bin, now: NOW, nextWake: undefined }), /nextWake/);
    assert.throws(() => buildStatus({ today: TODAY, bin, now: "2026-11-12", nextWake: MONDAY_7AM }), /now must be a Date/);
  });
});

describe("Pacific labels", () => {
  test("the summary's next wake reads as a Pacific date and time, winter and summer", () => {
    assert.equal(pacificLabel(MONDAY_7AM), "Mon, Nov 16, 2026, 7:00 AM PST");
    assert.equal(pacificLabel(Date.UTC(2026, 6, 6, 14, 0) / 1000), "Mon, Jul 6, 2026, 7:00 AM PDT");
  });

  test("errorToday is a full today.json in Pacific time", () => {
    assert.deepEqual(errorToday(NOW, "the feed answered 503"), {
      v: 1,
      date: "2026-11-12",
      weekday: "Thursday",
      dateLabel: "Thursday, Nov 12",
      generatedAt: "2026-11-12T06:31:04-08:00",
      updatedLabel: "Updated 6:31 AM",
      state: "error",
      market: null,
      trucks: [],
      next: null,
      error: "the feed answered 503",
    });
    // Late evening in UTC is still the same Pacific day; summer is seven hours behind.
    const summer = errorToday(new Date("2026-07-07T02:05:09Z"), "x");
    assert.equal(summer.date, "2026-07-06");
    assert.equal(summer.weekday, "Monday");
    assert.equal(summer.dateLabel, "Monday, Jul 6");
    assert.equal(summer.generatedAt, "2026-07-06T19:05:09-07:00");
    assert.equal(summer.updatedLabel, "Updated 7:05 PM");
    assert.equal(new Date(summer.generatedAt).getTime(), Date.parse("2026-07-07T02:05:09Z"));
  });
});

// build() itself, with stand-ins for the other parts passed in as functions: no feed, no browser, no files of theirs.
describe("build", () => {
  let scratch;
  let page;
  let n = 0;
  before(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "foodtruck-build-"));
    page = path.join(scratch, "page");
    await mkdir(path.join(page, "samples"), { recursive: true });
    for (const file of ["index.html", "page.css", "page.js"]) await writeFile(path.join(page, file), `stand-in ${file}`);
    await writeFile(path.join(page, "samples", "market.json"), "{}");
  });
  after(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  /** Runs build() with stand-in parts; `over` replaces any of them or any option. */
  async function run({ parts = {}, ...over } = {}) {
    const calls = [];
    const logged = [];
    const warned = [];
    const out = path.join(scratch, `out-${++n}`);
    const result = await build({
      out,
      now: NOW,
      page,
      pageUrl: "example.com/trucks",
      log: (line) => logged.push(line),
      warn: (line) => warned.push(line),
      ...over,
      parts: {
        loadToday: async (options) => {
          calls.push(["loadToday", options]);
          return { today: TODAY, marketDates: ["2026-11-12", "2026-11-16"] };
        },
        screenshot: async (options) => {
          calls.push(["screenshot", options]);
          return { rgba: new Uint8Array(800 * 480 * 4).fill(255), width: 800, height: 480 };
        },
        quantise: (rgba, width, height, options) => {
          calls.push(["quantise", rgba.length, width, height, options]);
          return new Uint8Array(width * height).fill(1);
        },
        pack: (codes, width, height) => {
          calls.push(["pack", codes.length, width, height]);
          return new Uint8Array((width * height) / 2).fill(0x11);
        },
        toPng: (codes, width, height) => {
          calls.push(["toPng", codes.length, width, height]);
          return Buffer.from("stand-in png");
        },
        nextWake: (options) => {
          calls.push(["nextWake", options]);
          return MONDAY_7AM;
        },
        ...parts,
      },
    }).catch((error) => ({ error }));
    return { out, calls, logged, warned, ...result };
  }

  test("writes the published files, and nothing else, from what the parts give", async () => {
    const { out, calls, logged, warned, status, error } = await run();
    assert.ifError(error);
    assert.deepEqual((await readdir(out)).sort(), ["index.html", "page.css", "page.js", "status.json", "today.bin", "today.json", "today.png"]);
    assert.equal(await readFile(path.join(out, "page.js"), "utf8"), "stand-in page.js");

    const today = JSON.parse(await readFile(path.join(out, "today.json"), "utf8"));
    assert.deepEqual(today, { ...TODAY, pageUrl: "example.com/trucks" });

    const bin = await readFile(path.join(out, "today.bin"));
    assert.equal(bin.length, 192000);
    assert.equal(await readFile(path.join(out, "today.png"), "utf8"), "stand-in png");
    assert.deepEqual(JSON.parse(await readFile(path.join(out, "status.json"), "utf8")), {
      v: 1,
      date: "2026-11-12",
      state: "market",
      hash: binHash(bin),
      bytes: 192000,
      generatedAt: 1794493864,
      nextWake: MONDAY_7AM,
    });
    assert.deepEqual(status, JSON.parse(await readFile(path.join(out, "status.json"), "utf8")));

    // Each part is called the way the contract gives it.
    assert.deepEqual(calls, [
      ["loadToday", { now: NOW }],
      ["screenshot", { pageDir: out, dataFile: "today.json", chromePath: undefined }],
      ["quantise", 800 * 480 * 4, 800, 480, { dither: false }],
      ["pack", 800 * 480, 800, 480],
      ["toPng", 800 * 480, 800, 480],
      ["nextWake", { now: NOW, marketDates: ["2026-11-12", "2026-11-16"] }],
    ]);
    assert.deepEqual(warned, []);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /state +market, 3 trucks/);
    assert.match(logged[0], new RegExp(`hash +${binHash(bin)}`));
    assert.match(logged[0], /next wake +Mon, Nov 16, 2026, 7:00 AM PST/);
  });

  test("the address on the picture comes from PAGE_URL, and is empty when there is none", async () => {
    const before = process.env.PAGE_URL;
    try {
      process.env.PAGE_URL = "trucks.example.org";
      assert.equal((await run({ pageUrl: undefined })).today.pageUrl, "trucks.example.org");
      delete process.env.PAGE_URL;
      assert.equal((await run({ pageUrl: undefined })).today.pageUrl, "");
      process.env.PAGE_URL = "";
      assert.equal((await run({ pageUrl: undefined })).today.pageUrl, "");
    } finally {
      if (before === undefined) delete process.env.PAGE_URL;
      else process.env.PAGE_URL = before;
    }
  });

  test("--data shows that file instead of the feed; the wake comes from the market days given, or none", async () => {
    const data = path.join(scratch, "sample.json");
    await writeFile(data, JSON.stringify({ ...TODAY, state: "no-market", trucks: [] }));
    const loadToday = () => assert.fail("the feed must not be read");

    const given = await run({ data, marketDates: ["2026-11-16"], parts: { loadToday } });
    assert.ifError(given.error);
    assert.deepEqual(given.calls.at(-1), ["nextWake", { now: NOW, marketDates: ["2026-11-16"] }]);
    assert.equal(given.status.state, "no-market");
    assert.match(given.logged[0], /no-market, 0 trucks/);

    const none = await run({ data, parts: { loadToday } });
    assert.deepEqual(none.calls.at(-1), ["nextWake", { now: NOW, marketDates: [] }]);

    await writeFile(data, JSON.stringify({ trucks: [] }));
    assert.match((await run({ data })).error.message, /bad state/);
  });

  test("a feed that cannot be read still gives the error picture, with a warning", async () => {
    const failed = { ...TODAY, state: "error", market: null, trucks: [], next: null, error: "the feed answered 503" };
    const told = await run({ parts: { loadToday: async () => ({ today: failed, marketDates: [] }) } });
    assert.ifError(told.error);
    assert.equal(told.status.state, "error");
    assert.equal(told.status.bytes, 192000);
    assert.equal(told.warned.length, 1);
    assert.match(told.warned[0], /Warning: the truck list could not be read \(the feed answered 503\)/);
    // After a feed error the truck is told to look again tomorrow morning, not in a week.
    assert.deepEqual(told.calls.at(-1), ["nextWake", { now: NOW, marketDates: ["2026-11-13"] }]);

    // Even if loadToday throws, which the contract says it does not.
    const thrown = await run({
      parts: {
        loadToday: async () => {
          throw new Error("getaddrinfo ENOTFOUND sf-api.offthegrid.com");
        },
      },
    });
    assert.ifError(thrown.error);
    assert.equal(thrown.today.state, "error");
    assert.equal(thrown.today.date, "2026-11-12");
    assert.equal(thrown.today.pageUrl, "example.com/trucks");
    assert.match(thrown.warned[0], /ENOTFOUND/);
    assert.deepEqual(JSON.parse(await readFile(path.join(thrown.out, "today.json"), "utf8")), thrown.today);
    assert.equal(JSON.parse(await readFile(path.join(thrown.out, "status.json"), "utf8")).state, "error");
  });

  test("fails loudly, and writes no status.json, when the picture cannot be made", async () => {
    const short = await run({ parts: { pack: () => new Uint8Array(191999) } });
    assert.match(short.error.message, /today\.bin must be exactly 192000 bytes, but pack\(\) gave 191999/);
    assert.ok(!(await readdir(short.out)).includes("status.json"));
    assert.ok(!(await readdir(short.out)).includes("today.bin"));

    const noShot = await run({
      parts: {
        screenshot: async () => {
          throw new Error("No Chrome found.");
        },
      },
    });
    assert.match(noShot.error.message, /No Chrome found/);
    assert.ok(!(await readdir(noShot.out)).includes("status.json"));

    const wrongSize = await run({ parts: { screenshot: async () => ({ rgba: new Uint8Array(16), width: 2, height: 2 }) } });
    assert.match(wrongSize.error.message, /The screenshot is 2 x 2, not 800 x 480/);

    const badWake = await run({ parts: { nextWake: () => Number.NaN } });
    assert.match(badWake.error.message, /nextWake must be whole Unix seconds/);
    assert.ok(!(await readdir(badWake.out)).includes("status.json"));

    const noPage = await run({ page: path.join(scratch, "no-such-page") });
    assert.equal(noPage.error.code, "ENOENT");
  });
});
