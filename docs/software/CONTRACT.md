# Software contract: what the four parts agree on

The software has four parts that are written separately and must fit together: the **truck data** (reads Off the
Grid's feed), the **page** (lays today's trucks out for the screen), the **renderer** (page to six-colour picture,
plus the schedule) and the **firmware** (the program on the truck's board). This file is what they share. Change it
here first, then in the code. `docs/plan/SPEC.md` sections 2, 2a, 3 and 4 say what the whole thing does and why.

## Layout

```
job/                      the morning job (Node 20+, ES modules, no build step)
  package.json            scripts: test, build      (owned by the renderer part)
  build.mjs               runs the whole job, writes dist/
  lib/trucks.mjs          truck data
  lib/schedule.mjs        when the truck wakes next
  lib/quantise.mjs        any RGBA picture -> the six colours
  lib/pack.mjs            six-colour picture -> today.bin
  lib/render.mjs          the page -> an 800 x 480 screenshot (headless Chrome)
  page/                   the web page (static: index.html, page.css, page.js)
  test/                   node --test files and fixtures
dist/                     what gets published (git-ignored)
firmware/                 PlatformIO project for the FireBeetle 2 ESP32-E
.github/workflows/        the schedule
```

Runtime dependencies are kept to two: `puppeteer-core` (drives the Chrome already on the machine) and `pngjs`.
Tests use `node --test` only.

## The published files (in `dist/`, all at one base address)

| File | Reader | What |
|---|---|---|
| `index.html`, `page.css`, `page.js` | people | the page; it reads `today.json` beside it |
| `today.json` | the page | today's trucks, as below |
| `today.png` | people | the six-colour picture, 800 x 480 |
| `today.bin` | the truck | the same picture packed for the screen, exactly 192,000 bytes |
| `status.json` | the truck, first | tiny: has the picture changed, and when to wake next |

### `today.json`

```json
{
  "v": 1,
  "date": "2026-11-12",
  "weekday": "Thursday",
  "dateLabel": "Thursday, Nov 12",
  "generatedAt": "2026-11-12T06:31:04-08:00",
  "updatedLabel": "Updated 6:31 AM",
  "state": "market",
  "market": { "name": "Off the Grid: Levi's Plaza", "hoursLabel": "11:00 AM – 2:00 PM" },
  "trucks": [ { "name": "Big City Halal", "food": "Halal" } ],
  "next": { "date": "2026-11-16", "label": "Monday, Nov 16" },
  "error": null,
  "pageUrl": "example.com/trucks"
}
```

- `state` is one of `"market"` (trucks listed), `"no-market"` (nothing at Levi's Plaza today; `trucks` is empty and
  `next` says when it is back, or is `null` if nothing is published) and `"error"` (the feed could not be read;
  `error` holds a short reason and the page shows "Couldn't read the truck list today").
- All dates and times are **America/Los_Angeles**. Labels are ready to print; the page does no date arithmetic.
- `trucks[].name` is the feed's `name` with a trailing legal suffix removed (" LLC", " LLC.", " Inc", " Inc.",
  with or without a comma before it) and whitespace collapsed. `food` is the feed's `primaryCuisine`, or `""`.
- Hours are the market's, not each truck's.

### `status.json`

```json
{
  "v": 1,
  "date": "2026-11-12",
  "state": "market",
  "hash": "9f2c4a7d1b3e5f60",
  "bytes": 192000,
  "generatedAt": 1794493864,
  "nextWake": 1794841200
}
```

- `hash`: the first 16 hex characters of the SHA-256 of `today.bin`.
- `generatedAt`, `nextWake`: Unix seconds (UTC). The truck needs no time zone and no clock of its own: it takes
  "now" from the HTTP `Date` header of the `status.json` response.
- The truck sleeps for `nextWake - now` seconds, clamped to between 10 minutes and 4 days.
- **Stale check:** if `now - generatedAt` is more than 20 hours, the morning job has not run yet today; the truck
  keeps its picture, sleeps 30 minutes and tries again, up to 3 times, then sleeps 24 hours.

### `today.bin`

- 800 x 480 pixels, rows top to bottom, pixels left to right, **4 bits per pixel, two pixels per byte, the left
  pixel in the high nibble**. 800 x 480 / 2 = 192,000 bytes, no header.
- Each nibble is the screen's own colour code:

| Colour | Code | The page's CSS colour |
|---|---|---|
| black | 0 | `#000000` |
| white | 1 | `#FFFFFF` |
| yellow | 2 | `#F5D000` |
| red | 3 | `#D0021B` |
| blue | 5 | `#1F4FD8` |
| green | 6 | `#1E8E3E` |

  (Code 4 is not used. These are the codes of Waveshare's driver for the 7.3 inch "E" panel; the firmware part
  confirms them against Waveshare's published example and says so in its report.)
- The picture is always upright. If the panel turns out to scan the other way up when mounted ribbon-down, the
  firmware flips it (one build flag); the job never does.

## When the truck wakes: `nextWake`

The truck wakes only when the picture would change:

1. on the next day that has a market at Levi's Plaza, at **7:00 AM Pacific**;
2. and, when the gap after today's market to the next one is more than 3 days (a holiday break), also at 7:00 AM
   the morning after, to show the "back on ..." card.

The morning job runs every day at about 6:30 AM Pacific. `nextWake` is always after "now" and never more than
14 days away (if the feed publishes nothing in the next 14 days, wake in 7 days and look again).

## The page

- A fixed **800 x 480** design in the six colours above, nothing else: no gradients, no shadows, no transparency,
  no web fonts (system sans-serif, bold). Opened with `?screen=1` it renders exactly 800 x 480 with no margin or
  scrollbar, which is what the renderer photographs. Without it, the same design scales to fit a phone or laptop.
- It reads `today.json` from beside itself, and takes `?data=<file>` to read another file (for the test samples).
- When everything is drawn it sets `document.documentElement.dataset.ready = "1"`. The renderer waits for that.
- **The battery corner.** The footer is solid black across the rectangle **x 744 to 784, y 452 to 472** (40 x 20
  pixels) and the page draws nothing there. The truck stamps its battery mark into it.
- Up to four trucks at full size; five or six shrink to fit; beyond six the last row reads "+N more".
- The layout follows `docs/plan/diagrams/screen-layout.svg`. It only has to be correct and readable for now: the
  user has said the design gets real work later, once the hardware runs.

## Module interfaces (so the parts can be written apart)

```js
// job/lib/trucks.mjs
export const LEVIS_PLAZA = "0016e00002o8dIXAAY";
export async function fetchEvents({ from, to, fetchImpl = fetch });   // -> the feed's events[] ; throws on a bad response
export function normalise(events, { now, locationId = LEVIS_PLAZA }); // -> { today: <today.json without pageUrl>, marketDates: ["2026-11-12", ...] }
export async function loadToday({ now = new Date(), fetchImpl = fetch, days = 14 }); // fetch + normalise; on failure returns state "error", marketDates []

// job/lib/schedule.mjs
export function nextWake({ now, marketDates });                        // -> Unix seconds, by the rules above

// job/lib/quantise.mjs
export const PALETTE;                                                  // [{ name, code, rgb: [r, g, b] }, ...] the table above
export function quantise(rgba, width, height, { dither = false } = {}); // -> Uint8Array(width * height) of colour codes

// job/lib/pack.mjs
export function pack(codes, width, height);                            // -> Uint8Array(width * height / 2), today.bin
export function unpack(bytes, width, height);                          // -> codes (for tests)
export function toPng(codes, width, height);                           // -> Buffer, a PNG in the palette's CSS colours

// job/lib/render.mjs
export async function screenshot({ pageDir, dataFile, chromePath });   // -> { rgba, width: 800, height: 480 }
```

`now` is always a `Date`; everything that depends on the day takes it as an argument, so tests can fix the day.

## The firmware

Follows `docs/plan/SPEC.md` section 3, with these settled points:

- Board: DFRobot FireBeetle 2 ESP32-E. Screen: Waveshare 7.3 inch e-Paper (E), 800 x 480, driven directly over SPI
  with a small driver based on Waveshare's published example (no frame buffer: the board has no spare 192 kB, so
  `today.bin` goes to the panel as it downloads).
- Pins (the plan's wiring table): DIN 23, CLK 18, CS 13, DC 22, RST 21, BUSY 14.
- Wi-Fi name and password are typed once into a set-up page the truck serves itself on first start (it becomes a
  hotspot named "FoodTruck-Setup"), and stored only on the board. The base web address of the published files is a
  build setting.
- It remembers the last `hash` across sleeps and skips the redraw when it has not changed.
- The battery mark is stamped into the battery corner while the picture streams through.
- The "Charge me" card is drawn by the firmware itself, with no download.
