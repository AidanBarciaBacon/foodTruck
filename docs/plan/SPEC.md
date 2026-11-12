# Spec sheet: the numbers every drawing and the plan use

One source for every figure. A drawing or a paragraph that needs a number takes it from here; if it is not here, it is
not decided. Figures marked **(est.)** are estimates to be confirmed on the bench, and say so wherever they are shown.

## 1. What it is

A 3D-printed model food truck for a desk, about 9 x 5 x 6 in. A colour e-paper screen fills the serving-window side
and shows which food trucks are outside the office today. It runs on a rechargeable battery and is charged about once
a year. The builder models and prints the truck, has never soldered and wants to learn.

Who does what: **the builder** models, prints, buys, solders and assembles. **The crew (Claude)** writes the software
in this repo: the job that reads the public truck page, the web page that shows today's trucks, the renderer that
turns it into a picture for the screen, and the firmware for the board.

## 2. How it works (the software side)

1. A **public web page** somewhere lists the trucks (the builder has it; link still to come).
2. A **morning job** runs in the cloud each weekday at about 6:30 AM (GitHub Actions on a schedule, free). It:
   1. fetches the public page and picks out today's trucks (name, food type, hours) into `today.json`;
   2. builds **our own web page** from that, laid out for the screen: 800 x 480, six flat colours;
   3. opens that page in a headless browser and takes a screenshot at exactly 800 x 480;
   4. converts the screenshot to the screen's six colours (black, white, red, yellow, blue, green);
   5. publishes three files to a fixed web address (GitHub Pages, free): `today.png` (to look at in any browser),
      `today.bin` (the same picture packed for the screen: 4 bits per pixel, 192,000 bytes) and `status.json`
      (a fingerprint of the picture, and how many seconds the truck should sleep before it checks again).
3. **The truck** wakes at about 7:00 AM, joins Wi-Fi, reads `status.json`, and only if the picture changed downloads
   `today.bin`, redraws the screen (about 25 seconds, with flashing) and goes back to sleep until the time
   `status.json` gave it. Weekends it sleeps straight through to Monday.
4. The same web page is there for people too: anyone can open it on a phone or laptop.

The screen keeps its picture with no power. The truck is asleep for all but about 40 seconds of a working day.

## 3. What the truck does each time it wakes (firmware)

1. Wake on its timer (or on the reset button: a press means "refresh now").
2. Read the battery voltage. Under 3.45 V: draw a "Charge me" badge once, then sleep without waking again until
   charged.
3. Join Wi-Fi (network name + password; 2.4 GHz). Give up after 10 seconds.
   Failed: sleep 30 minutes and try again, up to 3 times; then sleep until tomorrow morning, picture unchanged.
4. Get the time from the internet, and note how far the truck's own clock drifted while asleep.
5. Download `status.json` (tiny).
6. Picture fingerprint the same as the one on screen? Then skip the redraw.
7. Otherwise download `today.bin` and send it to the screen as it arrives; refresh the screen (about 25 s).
8. Switch the screen's power off, remember the fingerprint, work out how long to sleep (the server's number, corrected
   for the clock drift) and go to deep sleep.

A stale screen shows itself: the date is printed large on every picture.

## 4. What the screen shows

800 x 480 pixels, landscape, 160 x 96 mm. Six colours only: black `#000000`, white `#FFFFFF`, red `#D0021B`,
yellow `#F5D000`, blue `#1F4FD8`, green `#1E8E3E` (screen colours are duller than these). Flat colour and bold type
read best; photos and gradients turn grainy.

- **Header:** "TODAY'S TRUCKS" and the date, e.g. "Thursday, Nov 12".
- **Body:** up to four trucks, one row each: the name large, the food type, and the hours ("11:00 AM – 2:00 PM").
- **Footer:** "Updated 7:02 AM", a small battery mark, and the web address of the page.
- **Other states:** "No trucks today"; the weekend card ("Back Monday", with Monday's trucks if known); the
  "Charge me" badge in a corner when the battery is low.

## 5. The screen (same panel on every route)

| | |
|---|---|
| Panel | 7.3 inch six-colour e-paper ("Spectra 6"): Waveshare "7.3inch e-Paper (E)", also sold as Good Display GDEP073E01 |
| Resolution | 800 x 480 |
| Outline | 170.2 x 111.2 mm, 0.91 mm thick (bare glass, fragile) |
| Picture area | 160 x 96 mm |
| Redraw | about 25 s (maker: 15 to 25 s), whole screen only, flashes while it redraws |
| Power | none to hold a picture; about 70 mW while redrawing |
| Ribbon cable | 50-pin flat ribbon (see section 9 for which edge it leaves from) |
| Price | about $60 to $80 with its adapter board |

A smaller, more in-scale option exists: the 4 inch version of the same screen (600 x 400). The plan recommends the
7.3 inch because it can be read from across a desk.

## 6. The three build routes

All three use the same screen, the same truck and the same software.

| | Route A: plug together | Route B: a little soldering (recommended) | Route C: solder everything |
|---|---|---|---|
| For | No soldering at all | Learning to solder on easy joints | Smallest, cheapest, most hand work |
| Parts | See section 10 | See section 10 | See section 10 |

(Section 10 holds the parts for each route.)

## 7. Battery and how long a charge lasts

Baseline (routes B and C): a 2500 mAh protected LiPo pouch cell, 50 x 60 x 7.3 mm, with a 2-pin JST-PH plug
(Adafruit #328, $14.95). Usable: 80%, so 2000 mAh.

What drains it, per day, for the baseline (board asleep at 15 µA; one redraw each weekday):

| Drain | mAh per day | Note |
|---|---|---|
| The battery's own self-discharge | 2.47 | 3% of 2500 mAh a month; the biggest drain by far |
| Sleeping (15 µA all day) | 0.36 | measured figure for the board with its low-power pad cut, plus the panel |
| Waking and redrawing (0.8 mAh each, 5 days in 7) | 0.57 | **(est.)** nobody has published a measured figure for this screen |
| **Total** | **3.40** | **2000 / 3.40 = 588 days, about 19 months (est.)** |

Scenarios for the chart (all on 2000 mAh usable):

| Scenario | Self-discharge | Sleep | Wakes | Total mAh/day | Days | Months |
|---|---|---|---|---|---|---|
| Baseline: weekdays only, low-sleep board | 2.47 | 0.36 | 0.57 | 3.40 | 588 | 19 |
| Same, if a redraw costs 2.8 mAh (worst published figure, from a 13 inch screen) | 2.47 | 0.36 | 2.00 | 4.83 | 414 | 14 |
| Three redraws a day, every day (0.8 mAh each) | 2.47 | 0.36 | 2.40 | 5.23 | 382 | 13 |
| Board left as shipped: low-power pad NOT cut (520 µA asleep) | 2.47 | 12.48 | 0.57 | 15.52 | 129 | 4 |

For comparison only: a Raspberry Pi with a 5 inch LCD showing a live browser draws about 2.7 W; a battery four times
the size (10,000 mAh) runs it for about 12 hours.

The honest summary: **about a year per charge, probably more**, as long as the board sleeps properly. A bigger battery
buys little, because self-discharge grows with it. The plan includes a bench step that measures the real drain before
the truck is closed up.

## 8. Wi-Fi

Network name + password (the easy kind). 2.4 GHz only: every board here lacks 5 GHz. The plan includes a one-minute
check that the office network has a 2.4 GHz band.

## 9. The truck (mechanical)

See the mechanical section added below once the panel's drawing is confirmed.

## 10. Parts per route

See the parts section added below once the driver boards are confirmed.

## 11. The build, in order

| Phase | What happens | Who | Gate before the next phase |
|---|---|---|---|
| 0. Decide and order | Pick the route, send the truck page's link, order parts | Builder | Parts ordered (1 to 2 weeks' shipping) |
| 1. Software | Morning job, web page, renderer, firmware, all tested without hardware | Crew | Today's trucks show at the web address; the builder approves the look on Review Desk |
| 2. Learn to solder | A practice kit first, then the real joints (routes B and C) | Builder | Ten clean practice joints |
| 3. Bench build | Screen, board and battery wired on the desk, firmware flashed | Builder + crew | The bare screen shows today's trucks from the battery alone |
| 4. Power check | A week on the bench; the truck reports its battery voltage each morning | Both | The drain matches the estimate (or we know why not) |
| 5. Model | Measure the real parts with calipers; model the sled, then the truck around it | Builder | A test print of just the window wall fits the screen |
| 6. Print and assemble | Print, paint, fit the sled, close the roof | Builder | It updates from inside the closed truck |
| 7. Live with it | Two weeks on the desk; tune the layout and the wake time | Both | Done |

Two rules of order: **don't model before the parts are in your hands** (measure the real screen), and **don't close
the truck before it has run a week on the bench**.

## 12. Soldering, for a first-timer (routes B and C)

- Kit: a temperature-controlled iron (a Pinecil, about $26, or any 60 W adjustable iron) with a small chisel tip,
  0.8 mm rosin-core solder, brass wool to clean the tip, a silicone mat, helping hands or blu-tack to hold work,
  safety glasses, flush cutters. A practice kit of through-hole parts (about $10) before touching the real board.
- Settings: 350 °C (660 °F) for leaded solder, 370 °C (700 °F) for lead-free.
- One joint, four beats: touch the tip to the pad AND the pin together; count two seconds; feed solder into the joint
  (not onto the iron) until it flows into a small cone; take the solder away, then the iron. About four seconds in all.
- A good joint: a small shiny cone that hugs the pin, pad fully covered.
- Bad joints: a ball sitting on the pad (not hot enough: reheat); a bridge between two pins (drag the clean tip
  through it); a pin with a gap round it (too little solder: add more); a dull grainy lump (moved while cooling:
  reheat).
- Safety: the iron is 350 °C, always back in its stand; ventilate; wash hands after; never solder with the battery
  plugged in.
