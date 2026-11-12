# The truck's firmware

The program that runs on the board inside the food truck. It is a [PlatformIO](https://platformio.org) project for
the **DFRobot FireBeetle 2 ESP32-E** driving the **Waveshare 7.3inch e-Paper (E)** screen.

**It compiles, and its arithmetic is tested on the Mac, but it has never run on a real board or screen.** The last
section lists what was checked against which published source and what is still unproven.

## What it does

Each time the board wakes (its sleep timer ran out, or you pressed **RST**):

1. It reads the battery. Under 3.45 V it draws a red "CHARGE ME" card, once, and from then on wakes only once a
   day, without Wi-Fi, to look at the battery again. Once it reads 3.6 V or more it carries on as normal.
2. It joins your Wi-Fi (it gives up after 10 seconds).
3. It downloads `status.json` from the web address you set. That tiny file says whether the picture changed and
   when to wake next. The truck has no clock: it takes the time from the `Date` line of the web server's answer.
4. If the picture is the one already on the screen, it draws nothing.
5. Otherwise it downloads `today.bin` (192,000 bytes) and passes it to the screen as it arrives, stamping a small
   battery mark into the bottom-right corner on the way. It checks the length and the picture's fingerprint
   (SHA-256) before showing it. The redraw takes about 25 seconds and the screen flashes while it happens.
6. It puts the screen into deep sleep, then itself, until the time `status.json` gave (never less than 10 minutes,
   never more than 4 days).

If Wi-Fi, the download or the redraw fails, or `status.json` is more than 20 hours old (the morning job has not
run yet), the picture is left alone and the truck tries again in 30 minutes, three times; after that it sleeps for
a day. Whatever happens, a timer forces it back to sleep 2 minutes after waking.

Pressing **RST** means "refresh now": the truck forgets which picture it is showing and fetches it again.

## Build it and put it on the board

You need a Mac with Python 3 (type `python3 --version` in Terminal; if it is missing, macOS offers to install it)
and a USB-C **data** cable (some cables only charge).

### 1. Install PlatformIO, inside this folder only

From the top folder of the repository:

```sh
python3 -m venv firmware/.venv
firmware/.venv/bin/pip install platformio
```

That puts PlatformIO in `firmware/.venv` and nowhere else. (That folder and `firmware/.pio` are ignored by git.)

### 2. Set the web address

The truck needs to know where the morning job publishes its files. Create the file `firmware/include/secrets.h`
(it is ignored by git) with one line, using your own address, **ending with a slash**:

```c
#define BASE_URL "https://YOUR-GITHUB-NAME.github.io/foodTruck/"
```

Check it in a browser first: that address followed by `status.json` should show a few lines of text.

Other ways to do the same thing: change the `BASE_URL` line near the top of `include/config.h`, or pass it when
building: `PLATFORMIO_BUILD_FLAGS='-DBASE_URL=\"https://me.github.io/foodTruck/\"' .venv/bin/pio run`.
While it is still the placeholder, every build prints a warning saying so.

### 3. Build

```sh
cd firmware
.venv/bin/pio run
```

The first build downloads the ESP32 compiler (a few hundred MB, into `~/.platformio`) and takes several minutes.
Later builds take seconds. It should end with `[SUCCESS]` and two lines like these (the figures on 12 November 2026):

```
RAM:   [==        ]  15.8% (used 51844 bytes from 327680 bytes)
Flash: [========  ]  77.0% (used 1009849 bytes from 1310720 bytes)
```

### 4. Upload over USB-C

Plug the board into the Mac, then:

```sh
.venv/bin/pio device list          # shows the board's port
.venv/bin/pio run -t upload        # builds and uploads; it finds the port itself
```

The port looks like `/dev/cu.usbserial-10` or `/dev/cu.wchusbserial10` (the board's USB chip is a CH340). If
PlatformIO picks the wrong one, name it: `.venv/bin/pio run -t upload --upload-port /dev/cu.usbserial-10`.

**If the upload does not start:**

- **No port in the list.** Try another cable (charge-only cables are common) and another USB socket. macOS has
  had a driver for the CH340 built in for years; DFRobot's wiki links one to install by hand if yours lacks it.
- **"Failed to connect" / dots that never end.** This board has **no BOOT button**: it has a reset button (marked
  **RST**) and a general-purpose button (marked **27/D4**), and it normally switches itself into upload mode
  through the USB chip. If that fails, do by hand what a BOOT button would do: with a jumper wire, join the pin
  marked **0/D5** to a pin marked **GND**, press and release **RST**, start the upload, and take the wire away
  once it is writing. (That is how every ESP32 is put into upload mode; DFRobot's page does not describe it.)
- **"Port is busy".** Close the serial monitor (Ctrl-C in its Terminal window).

After an upload the board restarts by itself and runs.

## Wi-Fi set-up

The network name and password are never in this code. You type them into a page the truck serves itself, and
they are stored only on the board (in its flash memory, the part called NVS).

The truck opens set-up by itself the first time it starts, when it has no network saved. To open it again later
(new password, new office): **press RST, count "one, two", press RST again.** If that does not work on your board
(see "Not proven" below), hold the **27/D4** button down, press and release **RST**, then let go of 27/D4.

1. The small green light next to the USB-C socket comes on: set-up is open. It stays open for **5 minutes**.
2. On a phone or laptop, open the Wi-Fi list and join **FoodTruck-Setup** (no password).
3. A set-up page should pop up by itself. If it does not, open a browser and go to `http://192.168.4.1`.
4. Tap **Configure WiFi**, pick your network from the list, type its password, tap **Save**.
   It must be a 2.4 GHz network: the board has no 5 GHz radio.
5. The truck joins your network, the green light goes out, it restarts and fetches the picture (about 40 seconds
   until the screen has finished flashing).

If the password was wrong, the hotspot stays up so you can try again. If nobody finishes within 5 minutes, the
truck goes back to sleep; with no network saved at all it then sleeps until you press RST, rather than opening a
hotspot every day and draining the battery.

The hotspot is open (no password) for those few minutes, so someone nearby with the right tools could see the
Wi-Fi password as you type it. Do the set-up somewhere you are comfortable with that.

## Seeing what it is doing

The normal build prints nothing at all, to save power. To watch it work:

```sh
.venv/bin/pio run -e truck-debug -t upload
.venv/bin/pio device monitor
```

Then press **RST** once. You should see lines such as `[truck] battery 4012 mV`, `[truck] Wi-Fi joined in 2140 ms`,
`[truck] refresh done in 21350 ms` and `[truck] asleep for 86211 s after 31820 ms awake`. Every failure prints a
line starting `[truck] FAILED:`. Leave the monitor with Ctrl-C, and upload the normal build again
(`.venv/bin/pio run -t upload`) before closing the truck up.

(The first few lines after a reset are gibberish from the chip itself, before the program starts. That is normal.)

## Settings

All in `include/config.h`, each with a comment. Any of them can be overridden in `include/secrets.h` or with a
`-D` build flag. The ones you are most likely to touch:

| Setting | Default | What |
|---|---|---|
| `BASE_URL` | a placeholder | where the published files are |
| `DEBUG_LOG` | 0 | 1 = talk on the serial port (the `truck-debug` build sets it) |
| `HAS_BATTERY_SENSE` | 1 | 0 = no battery reading; the battery mark and the "Charge me" card are left out of the program |
| `ROTATE_180` | 0 | 1 = the picture is drawn the other way up (see below) |
| `VERIFY_HASH` | 1 | 0 = do not check the picture's fingerprint |
| `PIN_EPD_PWR` | -1 | the board pin wired to the adapter's PWR pin, if you wire one (see "The screen's power") |
| `BATTERY_LOW_MV` / `BATTERY_RECOVER_MV` | 3450 / 3600 | "Charge me" below the first; back to normal at the second |
| `BATTERY_DIVIDER_X1000` | 2000 | correction for the battery reading (see "Battery") |

Pins, as the plan's wiring table has them: DIN 23, CLK 18, CS 13, DC 22, RST 21, BUSY 14.

## HTTPS

The truck fetches over HTTPS but does not check the server's certificate (`setInsecure()`). The files are public
and nothing secret is ever sent, while a truck that checked against one pinned authority would stop updating,
sealed in its case, the day GitHub Pages moved to another: on 12 November 2026 `*.github.io` is signed by Let's
Encrypt's "YR1" under a root ("ISRG Root YR") so new that this Mac does not have it yet, reached through a
cross-signature from ISRG Root X1 that runs out on 2 September 2032 (X1 itself on 4 June 2035).

What that leaves open: someone in control of the network the truck is on could show it a wrong picture or tell it
to wake at the wrong time. The sleep is always kept between 10 minutes and 4 days, and a picture that does not
match `status.json`'s length and fingerprint is not shown.

## If the picture is upside down (`ROTATE_180`)

It should not be: Good Display's drawing of this panel puts the first pixel at the top-left **with the ribbon
cable at the bottom**, which is how the truck mounts it. If yours comes out upside down anyway, build with
`ROTATE_180` set to 1.

This is not free. The truck has no room to hold a whole picture (192,000 bytes, on a board with no extra memory
chip), so it cannot download the picture and then turn it round. A picture turned by
180 degrees is simply its bytes in reverse order, so instead the truck asks the web server for the file in twelve
pieces, **last piece first** (HTTP "Range" requests, which GitHub Pages answers: checked), turns each 16,000-byte
piece round and passes it on. That costs twelve requests instead of one, a second or two longer awake, and the
fingerprint check is skipped (the bytes arrive in the wrong order to compute it); the length is still checked on
every piece. The "Charge me" card is turned round too. The morning job is not involved either way: it always
publishes the picture upright, as the contract says.

## Battery

The FireBeetle's own schematic shows the battery wired to pin **34/A2** through two 1 MΩ resistors, permanently:
nothing to solder or bridge. The pin sees half the battery voltage; the firmware doubles it.

- Battery mark: full at 3.95 V and above, half from 3.70 V, low below that. It is stamped at x 744 to 784,
  y 452 to 472, the black rectangle the page leaves for it.
- Under **3.45 V**: the "Charge me" card, then one battery check a day. After plugging in the USB-C lead the truck
  notices at its next daily check; **press RST to make it notice at once.**
- A reading under 2.5 V cannot be a battery (the board would not be running). The firmware then assumes the
  reading does not work on this board, draws no battery mark and never shows "Charge me".
- The reading goes through a very high resistance, so it may be a little off. With the debug build, compare
  `[truck] battery ... mV` with a multimeter on the battery plug and adjust `BATTERY_DIVIDER_X1000`
  (2000 x multimeter reading / truck's reading).
- If the board restarts from a brown-out (the battery sagged when the radio switched on), it sleeps for a day
  instead of trying again at once.

If the reading turns out not to work at all, build with `HAS_BATTERY_SENSE=0`.

## Sleeping properly

Battery life depends on the board drawing microamps while asleep (SPEC section 7). The firmware's part:

- Wi-Fi is switched off before sleeping, and already before the 25-second redraw, which does not need it.
  Bluetooth is never started.
- The normal build prints nothing on the serial port.
- The screen is put into its own deep sleep after every redraw (and after a failed one).
- The six wires to the screen are left at fixed levels and held there through the sleep, so none floats: CS and
  RST high, the others low, BUSY as a plain input.
- The only thing that can wake the board is its timer (or the RST button).

**Your part: cut the low-power pad.** Look at the face of the board with the parts on it, USB-C socket at the top.
In the middle of the board, a little below and left of the white battery socket, is a tiny square light with
**5/D8** printed above it; further down is the long thin socket marked **GDI**. Right under the light, a couple of
millimetres below it and well above the GDI socket, are two small bright square pads side by side, joined by a
hair-thin line of copper. Draw the tip of a craft knife across that line, between the two squares, until they are
no longer joined (DFRobot's "Board Overview" picture marks the spot as number 8). DFRobot: this "reduce[s] static
power consumption by 500 μA"; afterwards the RGB light (5/D8) only works on USB power, which this firmware never
uses anyway. The plan's power budget (15 µA asleep) assumes this cut has been made.

## The screen's power (the adapter's PWR pin)

The plan wires eight pins. Waveshare's current example code also drives a ninth, **PWR**, high before using the
screen and low afterwards. If your adapter board has a PWR pin:

- simplest: join PWR to **3V3**, so the screen is always powered (it sleeps at next to nothing by itself);
- or wire PWR to a spare board pin (25 is free) and build with `PIN_EPD_PWR=25`. The truck then switches the
  screen's power off completely while it sleeps, which also settles the plan's open question about the adapter
  leaking current.

If the adapter has a PWR pin and it is left unconnected, the screen may simply never answer (the debug build
says `the screen does not answer`).

## Tests

```sh
bash firmware/test/run.sh
```

compiles `test/test_logic.cpp` with the Mac's own C++ compiler and checks the parts with no hardware in them: the
`Date` parser, the sleep lengths, reading `status.json`, the battery mark, the 180-degree flip and the "Charge
me" card. `bash firmware/test/run.sh --card card.bmp` draws the card to a picture file to look at;
`--mark marks.bmp` draws the three battery marks, enlarged.

## Files

| File | What |
|---|---|
| `platformio.ini` | the board, the library, the two builds (`truck`, `truck-debug`) |
| `include/config.h` | every setting |
| `include/truck_logic.h` | time, sleep lengths, `status.json`, picture bytes: no hardware, tested on the Mac |
| `include/charge_card.h` | the "Charge me" card and its small font: no hardware, tested on the Mac |
| `include/epd7in3e.h`, `src/epd7in3e.cpp` | the screen driver (no frame buffer) |
| `src/main.cpp` | the wake-up flow |
| `test/` | the host-side tests |

One library is downloaded by the build: [tzapu/WiFiManager](https://github.com/tzapu/WiFiManager) 2.0.17, for the
set-up hotspot.

## What was checked, and against what

Read on 12 November 2026.

| Fact | Source |
|---|---|
| **Colour codes: black 0, white 1, yellow 2, red 3, blue 5, green 6** (4 unused). The contract's table is right. | Waveshare, [`EPD_7in3e.h`](https://github.com/waveshareteam/e-Paper/blob/master/RaspberryPi_JetsonNano/c/lib/e-Paper/EPD_7in3e.h) |
| Two pixels per byte, left pixel in the high four bits; 0x10 then 192,000 bytes | Waveshare, [`EPD_7in3e.c`](https://github.com/waveshareteam/e-Paper/blob/master/RaspberryPi_JetsonNano/c/lib/e-Paper/EPD_7in3e.c) (`Clear`, `Display`) and [`epd7in3e.py`](https://github.com/waveshareteam/e-Paper/blob/master/RaspberryPi_JetsonNano/python/lib/waveshare_epd/epd7in3e.py) (`getbuffer`) |
| Reset pulse, start-up bytes, power on / refresh / power off order, BUSY low = busy, sleep = 0x02 then 0x07 0xA5 | the same `EPD_7in3e.c`, copied byte for byte; identical in Waveshare's [Arduino R4 copy](https://github.com/waveshareteam/e-Paper/blob/master/Arduino_R4/src/e-Paper/EPD_7in3e.cpp). (Waveshare has no `Arduino/epd7in3e` folder; the E panel exists only in these trees.) |
| SPI mode 0, most significant bit first, 4 MHz; a PWR pin driven high for use | Waveshare, [`DEV_Config.cpp`](https://github.com/waveshareteam/e-Paper/blob/master/Arduino_R4/src/Config/DEV_Config.cpp) |
| Same start-up bytes in an independent driver; CS may stay low across a run of data bytes | [GxEPD2, `GxEPD2_730c_GDEP073E01.cpp`](https://github.com/ZinggJM/GxEPD2/blob/master/src/epd7c/GxEPD2_730c_GDEP073E01.cpp) |
| Deep sleep is command 0x07 with 0xA5 and only a hardware reset ends it; BUSY low = busy; first pixel top-left with the ribbon at the bottom | Good Display, [GDEP073E01 specification rev 1.0](https://laskakit.cz/user/related_files/gdep073e01-1-0.pdf), sections 5.2 and 6 |
| The screen must be put to sleep or powered off after a refresh, or it "will remain in a high voltage state"; no more than one refresh per 180 s; a long reset pulse can cut the adapter's power | Waveshare, [7.3inch e-Paper HAT (E) manual](https://www.waveshare.com/wiki/7.3inch_e-Paper_HAT_(E)_Manual), Precautions and FAQ |
| PlatformIO board id `dfrobot_firebeetle2_esp32e` | `pio boards firebeetle` |
| Battery: VBAT, 1 MΩ (R5), pin 34/A2, 1 MΩ (R14), ground; no pads to bridge. Reset button on the chip's enable line; user button on pin 27; green light on pin 2; CH340 USB chip | DFRobot, [schematic V1.0](https://dfimg.dfrobot.com/wiki/23249/DFR0654_firebeetle-2-esp32-e_schematics_v1.0.pdf) linked from the [wiki page](https://wiki.dfrobot.com/dfr0654/). The wiki's text does not mention reading the battery at all. |
| Low-power pad: where it is, "reduced by 500 μA", RGB light then only on USB. Charge light: red; on while charging, off when full or not charging, fast flashing on USB with no battery | DFRobot wiki, "Board Overview" |
| Another project reads this board's battery on A2 and doubles it; runs it at 80 MHz; ~14 µA asleep | [lmarzen/esp32-weather-epd](https://github.com/lmarzen/esp32-weather-epd) |
| Header pins: the plain board (DFR0654, $8.90) lists four separate pin strips in its box (18-pin and 14-pin, plain and socket), so they are loose and need soldering. DFR0654-F ("with Header", $9.90) is the one sold with pins already on; its page does not say "soldered" in so many words, so check the photo when ordering. The wiki does not cover this. | DFRobot shop pages, [DFR0654](https://www.dfrobot.com/product-2195.html) and [DFR0654-F](https://www.dfrobot.com/product-2231.html) |
| GitHub Pages sends `Date` and `Content-Length`, keeps the connection open, ignores a `?h=` on the address, answers `Range` requests with 206 | tried with `curl` against a live GitHub Pages site |
| GitHub Pages' certificate chain today | `openssl s_client -connect octocat.github.io:443` |

## Not proven until it runs on the real thing

Everything, strictly: no board and no screen were available. In particular:

1. **The screen as a whole.** The bytes are Waveshare's, but whether this panel accepts picture data in 4 kB runs
   with CS held low (GxEPD2 does it; Waveshare's C code toggles CS per byte), how fast BUSY reacts, and whether a
   redraw fits in the 60-second limit in a cold room.
2. **A download that fails half-way.** The truck then sends "power off" and "deep sleep" without a refresh, and
   expects the old picture to stay. Nothing published says otherwise, but nothing says so either.
3. **The adapter board:** whether it has a PWR pin that needs wiring, and whether it draws current while asleep.
4. **Which way up the picture comes out** (see `ROTATE_180`), and the `ROTATE_180` download in twelve pieces.
5. **Sleep current.** The pin holds, the screen's deep sleep and the cut pad should give the plan's ~15 µA; only a
   meter can say. DFRobot's wiki now reads "reduced to 2mA" for the board asleep, where older copies of the same
   page (quoted in lmarzen's README) read "13 μA"; measure it.
6. **The battery reading:** its accuracy through 1 MΩ + 1 MΩ, and so where 3.45 V really falls.
7. **RST twice for set-up.** The mark that links the two presses lives in memory that survives a restart, but this
   board's RST button cuts the chip's enable line, which may wipe it. If it does, use the 27/D4 button as described.
8. **The set-up page** on real phones (the pop-up, the 5-minute limit).
9. **Wi-Fi in the office:** whether 10 seconds is enough to join, and keeping one connection for both files.
10. **The sleep clock.** It is a cheap oscillator; the firmware measures how far off it was after each long sleep
    and corrects the next one, but the size of the error is only known on the board.
11. **The 2-minute emergency timer**, which should never fire, and so has never been seen to.
