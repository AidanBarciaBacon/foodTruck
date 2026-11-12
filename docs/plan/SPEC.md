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
2. A **morning job** runs in the cloud each weekday at about 6:30 AM, office local time, summer and winter
   (GitHub Actions on a schedule, free). It:
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
2. Read the battery voltage. Under 3.45 V: draw the full-screen "Charge me" card once (it is stored in the truck's
   own program, so it needs no Wi-Fi) and remember that it did. From then on it wakes once a day for a moment, with
   no Wi-Fi, only to read the battery; once charged it carries on from step 3.
3. Join Wi-Fi (network name + password; 2.4 GHz). Give up after 10 seconds.
   Failed: sleep 30 minutes and try again, up to 3 times; then sleep until the next working morning by its own
   clock (it knows the weekday from its last successful wake), picture unchanged.
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
  With five or six trucks the rows shrink to fit; beyond six, the last row reads "+2 more" (or however many).
- **Footer:** "Updated 6:31 AM" (when the morning job made the picture), a small battery mark, and the web address
  of the page. The battery mark is the one
  thing the truck draws itself: it stamps a full / half / low mark into a fixed corner as the picture arrives.
- **Other states, each a whole-screen card:** "No trucks today"; "Couldn't read the truck list today" (when the
  public page changed or was down, so the screen never shows old trucks as today's); and "Charge me" (drawn once
  when the battery is nearly empty; the truck then stops waking until it is charged).
- **Weekends:** there is no weekend card. Friday's picture, with Friday's date, stays up until Monday morning.

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

A smaller, more in-scale option exists: the 4 inch version of the same screen (600 x 400 pixels; picture area
84.6 x 56.4 mm and glass 99 x 66 mm by retailer listings, to confirm against a datasheet). Its ribbon is
listed as the same 50-contact kind, so it should take the same boards; that is also to confirm. The plan recommends the 7.3 inch because it can be read from across a desk; if the 4 inch is chosen,
section 9 is redrawn for it.

## 6. The three build routes

All three use the same screen, the same truck and the same software.

| | Route A: plug together | Route B: a little soldering (recommended) | Route C: solder everything |
|---|---|---|---|
| For | No soldering at all | Learning to solder on easy joints | Smallest and neatest, most hand work |
| Main board | Seeed XIAO ePaper Display Board EE04 (the ribbon plugs straight in) | DFRobot FireBeetle 2 ESP32-E | Seeed XIAO ESP32-S3 |
| Screen adapter | built into the board | Waveshare's, with its 8-wire cable | Good Display DESPI-C73, passive |
| Soldering | none | two rows of header pins | eight wires, battery leads, two resistors, a switch |
| Asleep, whole board | not published | 11.6 µA measured (pad cut) | 12 to 13 µA measured |
| Cost | about $85 | about $105 + $45 soldering kit | about $90 + $45 soldering kit |
| Main unknown | battery life unproven | whether the adapter leaks while asleep | fine soldering on small pads |

Section 10 holds the full parts list for each route.

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

These are target numbers for the model, worked out from the screen's datasheet drawing. The builder measures the real
parts before modelling (phase 5) and the real parts win.

**Axes for every drawing.** x runs along the truck from the rear face (x = 0) to the front (x = 229). y runs across
it from the serving-side outer face (y = 0) to the far side (y = 127). z runs up from the desk (z = 0) to the roof top
(z = 152). The truck faces right in a side view, so the side we see is the kerb side, where a real truck serves.

**Envelope.** 229 long x 127 wide x 152 tall mm (9.0 x 5.0 x 6.0 in). Walls, floor and roof 2.4 mm thick.

**Why it is tight in height.** The screen's glass is 111.2 mm tall and stands upright in the side wall. Under it go
the wheels; over it goes the roof. 152 mm works with 32 mm wheels, with only about 1 mm to spare above and below
the glass. **A truck 155 mm tall (6.1 in) is recommended**: it gives room for a rim round the glass and for error.
The numbers below are for 152 mm; the mechanical drawings are reissued once the height and the screen size are
chosen.

### The screen panel, as mounted (landscape, ribbon cable at the bottom)

| | mm |
|---|---|
| Glass outline | 170.2 wide x 111.2 tall x 0.91 thick |
| Picture area | 160.0 x 96.0 |
| Dead border, top | 4.7 |
| Dead border, bottom (the ribbon edge) | 10.5 |
| Dead border, left and right | 5.1 each |
| Ribbon cable | leaves the bottom edge at its centre; 25.5 wide, 24 long, 50 contacts; may only bend in the 5.5 mm next to the glass |
| Glue bump where the ribbon joins the glass | up to 1.2 high, on the back |
| Weight | 34.5 g |
| Handling | never press on the glass; keep out of direct sun; works from 0 to 50 °C |

### Where things are (x, y, z in mm)

| Thing | x | y | z |
|---|---|---|---|
| Body underside (ground clearance 9) | 0 to 229 | 0 to 127 | 9 |
| Chassis zone (floor, wheel wells) | 0 to 229 | 0 to 127 | 9 to 36 |
| Wheels, four: 32 diameter x 12 wide, cosmetic, axle at z = 16 | centres at 46 (rear) and 183 (front) | 0 to 12 and 115 to 127 | 0 to 32 |
| Wheel wells, four: 38 long x 14 deep, open to the outside; 2.4 roof | 27 to 65 and 164 to 202 | 0 to 14 and 113 to 127 | open to 33.6, roof to 36 |
| Body shell walls | 0 to 229 | 0 to 127 | 36 to 149.6 |
| Roof lid (lifts off; four magnet pairs, 6 dia x 3; its 1.5 lip runs along the far side and the ends, not over the sled) | 0 to 229 | 0 to 127 | 149.6 to 152 |
| Magnet posts, four: two in the far-side corners, one in the serving-side front corner (in the cab), one on the rear wall at about y = 40 | | | up to 149.6 |
| Cab (windscreen, driver's door) | 185 to 229 | | |
| Serving wall, inner face | | 2.4 | |
| Air gap between wall and glass | | 2.4 to 2.9 | |
| Screen glass | 12.0 to 182.2 | 2.9 to 3.8 | 36.5 to 147.7 |
| Picture area | 17.1 to 177.1 | | 47.0 to 143.0 |
| Window opening in the wall: 161 x 97 at the inner face; the outer 1.5 mm of the wall is chamfered 45°, so it is 164 x 100 at the outer face | 16.6 to 177.6 | 0 to 2.4 | 46.5 to 143.5 |
| Sled backboard: 176 x 112.5 x 3 plate | 9.1 to 185.1 | 3.8 to 6.8 | 36 to 148.5 |
| Ribbon cable, at the glass edge | 84.2 to 109.7 | | folds back under the glass at z = 36.5 |
| Electronics on the back of the sled (keep-out depth) | 4 to 185 | 6.8 to 37 | 36 to 148.5 |
| Battery, against the sled's rear face | 115 to 175 | 6.8 to 14.1 | 40 to 90 |
| Empty cavity beyond (the two far-side wheel wells stand in it below z = 36) | 2.4 to 226.6 | 37 to 124.6 | 11.4 to 149.6 |
| Charging slot in the rear wall for a USB-C plug: 7.5 across, 13 tall | 0 to 2.4 | centre 13 | centre 67.5 |

Left over round the 161 x 97 opening: 8.5 mm of wall above it (room for an awning), 37.5 mm below it (the lower
body, with the wheel arches), 16.6 mm behind it and 51.4 mm in front of it (the cab). The chamfer takes 1.5 mm off
each of those at the outer face.

### The electronics sled

Everything electrical lives on one removable printed plate, the **sled**. It is built and tested on the bench as a
complete working unit before any truck exists, then drops into the truck from the top with the roof off. The truck
itself is plain plastic and can be reprinted or repainted without touching the electronics.

- **Front face:** flat. The screen glass lies on it, held by two strips of thin double-sided tape on its back and
  located by a 1 mm high rim along the plate's two short ends (the plate is 2.9 mm longer than the glass at each
  end). There is no rim along the top or bottom at 152 mm height: the plate is only 0.5 mm taller than the glass
  below and 0.8 mm above. Nothing clamps the glass.
- **Bottom centre:** a cut-out 30 wide x 6 tall, where the ribbon folds back to the rear face (a relaxed U, about
  2 mm radius, inside the 5.5 mm bend zone). It hangs into the free space between the wheel wells (x = 65 to 164).
- **Rear face, bottom centre:** the adapter board that the ribbon plugs into, its socket within 10 mm of the cut-out,
  its short side along the truck so it clears the battery.
- **Rear face, towards the rear of the truck:** the main board on 3 mm standoffs, its USB-C port facing the rear wall
  and lining up with the charging slot (x = 4 to 64, z = 54.8 to 80.2 for the 25.4 x 60 board of route B; it
  overhangs the plate's rear end by 5 mm and passes behind the rear channel).
- **Rear face, towards the front:** the battery (50 x 60 x 7.3) in a printed pocket with a soft strap, 1 mm clear all
  round so it can swell; never clamped, never near a screw point (x = 115 to 175, z = 40 to 90).
- **In the truck:** the sled stands on the tops of the two serving-side wheel wells (z = 36). Each end slides down a
  vertical U-channel printed on the inside of the serving wall (channels grip 2.5 mm of the plate at x = 9.1 and
  x = 185.1), which sets the glass 0.5 mm behind the wall without touching it. The roof lid holds it down.
- **On the bench:** lay the sled face up or sit it in a printed stand; never stand it on the ribbon.

### Printed parts

| Part | Size (mm) | Notes |
|---|---|---|
| Chassis | 229 x 127 x 27 | floor, four wheel wells, bumpers; prints flat |
| Body shell | 229 x 127 x 113.6 | four walls, window, cab, charging hole; open top and bottom, or one piece with the chassis |
| Roof lid | 229 x 127 x 2.4 plus a 1.5 lip | four magnet pockets; vents and an A/C box on top are extra height |
| Sled backboard | 176 x 112.5 x 3 plus standoffs and battery pocket | prints flat, face down |
| Wheels | 32 dia x 12, four | pegged or glued; they do not turn |
| Awning, counter, details | free | |

Printing notes for the modeller:
- **Bed size.** The body is 229 mm long. It fits a 250 mm or 256 mm bed; on a 220 mm bed, split it at about
  x = 190, just in front of the sled's front channel.
- **The window's top edge** is a 161 mm bridge if the body prints upright. Either print with supports in the window,
  or print the serving wall as its own flat part (best flatness for the screen), or lay the body on its far side.
- **Test first.** Before the full print, print a 20 mm deep slice of the serving wall with the window and the two
  channels, and try the sled in it.

Other hardware: eight magnets 6 dia x 3; M2.5 x 6 screws for the boards; thin double-sided tape; a strip of 1 mm
foam tape.

## 10. Parts per route

All three use the same screen (section 5), the same sled and truck, the same battery and the same software.
Prices are approximate, November 2026; Waveshare's own site could not be read, so its prices are from resellers.

### Route A: plug together, no soldering

| Part | What it is | About |
|---|---|---|
| Bare 7.3 inch Spectra 6 panel (Waveshare 7.3inch e-Paper (E), raw panel) | the screen | $60 |
| Seeed Studio XIAO ePaper Display Board EE04 | one small board with everything: the socket the screen's ribbon plugs straight into, the Wi-Fi chip (a XIAO ESP32-S3 Plus, included), a battery plug, a charger and a power switch; reads the battery level itself | $9.90 |
| 2500 mAh LiPo with 2 mm JST plug | the battery | $15 |

Three plugs: ribbon into board, battery into board, USB-C to charge. Total about **$85**.
Unknowns: Seeed publishes no sleep current for this board (it says "typically 3 months", without saying how often it
redraws), so battery life is unproven until the bench check. Seeed's page does not say whether the small Wi-Fi board
arrives already soldered on: check before ordering. The board's size is not published; its USB-C port may not reach
the rear wall, in which case charge with the roof off or add a short USB-C extension lead.

Also possible, not recommended: a finished unit, the Seeed reTerminal E1002 ($99: the same screen, a 2000 mAh battery
and the board in a metal case 176 x 120 x 17 mm). It needs a truck about 160 mm tall, there is no report of it being
opened, and no measured battery life at one redraw a day.

### Route B: a little soldering (recommended)

| Part | What it is | About |
|---|---|---|
| Waveshare 7.3inch e-Paper HAT (E) set | the screen, its small adapter board, and a cable with eight loose plug ends | $80 |
| DFRobot FireBeetle 2 ESP32-E | the main board: Wi-Fi chip, battery plug, charger, USB-C; 25.4 x 60 mm; sleeps at 11.6 µA once its low-power pad is cut (520 µA if not) | $8.90 |
| 2500 mAh LiPo with 2 mm JST plug (Adafruit #328) | the battery | $14.95 |
| Soldering kit (section 12) | iron, solder, practice kit and the rest | $45 |

The soldering: two rows of header pins onto the FireBeetle (plain through-hole joints, the classic first job). Then
the cable's eight ends push onto the pins, and the battery plugs in. One cut with a craft knife opens the low-power
pad. Total about **$105 plus the soldering kit**.
Unknown: whether the Waveshare adapter itself draws current while asleep (later versions carry a voltage shifter).
The bench check finds out; the fix, if needed, is a passive adapter (Good Display DESPI-C73, 47 x 32 mm).

### Route C: solder everything

| Part | What it is | About |
|---|---|---|
| Bare 7.3 inch Spectra 6 panel | the screen | $60 |
| Good Display DESPI-C73 | passive adapter, ribbon socket to eight solder points; 47 x 32 mm | price not listed |
| Seeed XIAO ESP32-S3 | thumbnail-sized main board, 21 x 17.8 mm, with charger; measured asleep at 12 to 13 µA | $7.49 |
| 2500 mAh LiPo (the same battery) | its two leads soldered to pads under the board, through the slide switch | $14.95 |
| Two 1 MΩ resistors, a slide switch, thin wire | battery-level sensing and an off switch | $5 |
| Soldering kit (section 12) | | $45 |

The soldering: eight wires point to point between adapter and board, the battery leads onto two small pads (the
fiddly part), two resistors and a switch. Total about **$90 plus the soldering kit**. Smallest and neatest; a good
second build once route B's joints feel easy.

### The eight wires (routes B and C)

Go by the names printed on the adapter board, not by wire colours. The pins on the main board are the firmware's
planned choice and get confirmed on the bench.

| Adapter pin | Carries | Route B: FireBeetle 2 ESP32-E pin | Route C: XIAO ESP32-S3 pin |
|---|---|---|---|
| VCC | 3.3 V power to the screen | 3V3 | 3V3 |
| GND | ground | GND | GND |
| DIN | picture data | 23 (MOSI) | D10 (MOSI) |
| CLK | data clock | 18 (SCK) | D8 (SCK) |
| CS | "listen to me" select | 13 | D1 |
| DC | data or command | 22 | D3 |
| RST | reset the screen | 21 | D4 |
| BUSY | screen says "still redrawing" | 14 | D5 |

Route C also: battery + and − to the BAT pads under the XIAO (through the slide switch on +), and the two 1 MΩ
resistors in series from battery + to GND with their midpoint to pin A0, so the board can read the battery level.
The resistors sit on the board side of the switch, so the switch turns them off too. They add about 2 µA to the
sleep current (3.7 V across 2 MΩ), which the 15 µA baseline already allows for.

**Battery plug warning (all routes):** before the first plug-in, check that the battery's red wire meets the board's
+ mark. Battery makers disagree on which side is +, and a reversed battery destroys the board.

## 11. The build, in order

| Phase | What happens | Who | Gate before the next phase |
|---|---|---|---|
| 0. Decide and order | Pick the route, send the truck page's link, order parts | Builder | Parts ordered (1 to 2 weeks' shipping) |
| 1. Software | Morning job, web page, renderer, firmware, all tested without hardware | Crew | Today's trucks show at the web address; the builder approves the look on Review Desk |
| 2. Learn to solder | A practice kit first, then the real joints (routes B and C) | Builder | Ten clean practice joints |
| 3. Bench build | Screen, board and battery wired on the desk, firmware flashed | Builder + crew | The bare screen shows today's trucks from the battery alone |
| 4. Power check | Measure the sleep current with a multimeter; then a week running on the bench | Both | Asleep it draws under 50 µA; seven correct mornings |
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

## 13. Tools and products (the builder has few tools, a Bambu Lab P1S with AMS, and would rather print than buy)

The printer: Bambu Lab P1S, 256 x 256 x 256 mm bed, enclosed, with the AMS (four filaments in one print).
So the 229 mm body prints in one piece, and colour can be printed in rather than painted.

### Buy (no good printed substitute)

| Tool | Why | About |
|---|---|---|
| Soldering iron, temperature controlled, with a small chisel tip | routes B and C | $26 to $40 |
| A metal stand for the iron | a printed one would melt | $6 |
| Solder, 0.8 mm rosin core | | $8 |
| Brass wool tip cleaner | | $7 |
| Flush cutters | trimming pins, wires and print supports | $8 |
| Fine tweezers | the ribbon latch, small screws | $6 |
| Digital calipers, 150 mm | measuring the real parts before modelling (phase 5) | $20 |
| Multimeter with a microamp (µA) range | battery polarity; the sleep-current check (phase 4) | $25 |
| Small screwdriver set | M2.5 screws | $10 |
| Craft knife | the low-power pad cut; cleaning prints | $5 |
| Safety glasses | soldering and cutting | $5 |
| Through-hole soldering practice kit | ten joints before the real board | $10 |
| A USB-C lead that carries data | loading the program | $8 |

### Print instead of buying

| Print | Replaces |
|---|---|
| Board holder (a small vise for circuit boards) | "helping hands" |
| Header-pin jig: a block with holes 2.54 mm apart that holds the pins square while you solder | a breadboard |
| Solder spool holder | |
| Fume fan housing (takes a bought 120 mm computer fan and a carbon filter pad) | a bought fume extractor |
| Tray for small parts and screws | |
| Bench stand for the sled | |
| The sled, its standoffs and battery pocket; the test slice; the truck, wheels, awning and details | |

### Hardware and consumables to buy

Eight magnets 6 mm x 3 mm; M2.5 x 6 self-tapping screws (they cut their own thread in printed 2.1 mm holes, so no
threaded inserts are needed); thin double-sided tape; 1 mm foam tape; superglue for the magnets; isopropyl alcohol
and a soft cloth.

### Filament

- Truck: matte PLA, in up to four colours through the AMS. Use PETG instead if the desk gets direct sun.
- Sled: PETG or PLA, any colour.
- Nothing printed goes near the hot iron.

### Printing with the AMS

- **Print colour in, don't paint.** Up to four colours in one print.
- **Print the two long side walls flat, face down, as their own parts.** Lettering and stripes drawn into the first
  two or three layers come out crisp, and the colour only changes in those layers, so it wastes little filament.
  It also gives the flattest wall for the screen and removes the 161 mm bridge over the window.
- Colour changes that run up a standing wall swap filament on every layer: slow and wasteful. Keep colour changes
  horizontal (by height) or in the face-down layers.
- If the body is printed upright in one piece instead, use the AMS for a support-interface material under the
  window's top edge so the bridge comes out clean.
