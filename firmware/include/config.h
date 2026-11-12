// Every setting of the truck's firmware, in one place.
//
// Each one can be overridden without editing this file:
//   - with a build flag, e.g.  PLATFORMIO_BUILD_FLAGS='-DBATTERY_LOW_MV=3500' pio run
//   - or in a private file include/secrets.h (git-ignored), e.g.
//         #define BASE_URL "https://someone.github.io/foodTruck/"
//
// This file has no Arduino includes on purpose: the host-side tests include it too.
#pragma once

#if defined(__has_include)
#  if __has_include("secrets.h")
#    include "secrets.h"
#  endif
#endif

// ---------------------------------------------------------------------------------------------------------
// Where the published files are (docs/software/CONTRACT.md, "The published files").
// Must be https, must be the final address (no redirect), and must end with "/".
// The truck reads <BASE_URL>status.json and <BASE_URL>today.bin.
// ---------------------------------------------------------------------------------------------------------
#ifndef BASE_URL
#  define BASE_URL "https://aidanbarciabacon.github.io/foodTruck/"
#endif

// ---------------------------------------------------------------------------------------------------------
// Build switches
// ---------------------------------------------------------------------------------------------------------

// 1: say what the truck is doing on the serial port (115200 baud). 0: no serial output at all.
#ifndef DEBUG_LOG
#  define DEBUG_LOG 0
#endif

// 1: the board can read its battery. The FireBeetle 2 ESP32-E's published schematic (V1.0) wires the battery
// through two 1 M-ohm resistors to pin 34/A2 with no solder pads to bridge, so this is on by default.
// 0: no battery reading at all; the battery mark and the "Charge me" card are compiled out.
#ifndef HAS_BATTERY_SENSE
#  define HAS_BATTERY_SENSE 1
#endif

// 1: the panel is mounted the other way up, so the picture is sent rotated by 180 degrees.
// See README.md, "If the picture is upside down": it costs a slower download in twelve pieces.
#ifndef ROTATE_180
#  define ROTATE_180 0
#endif

// 1: check that today.bin's SHA-256 starts with the hash in status.json before showing it.
// (Not possible with ROTATE_180, where the file arrives back to front.)
#ifndef VERIFY_HASH
#  define VERIFY_HASH 1
#endif

// ---------------------------------------------------------------------------------------------------------
// Pins (docs/plan/SPEC.md section 10, "The eight wires"). GPIO numbers, as printed on the FireBeetle.
// ---------------------------------------------------------------------------------------------------------
#ifndef PIN_EPD_MOSI
#  define PIN_EPD_MOSI 23   // adapter DIN
#endif
#ifndef PIN_EPD_SCK
#  define PIN_EPD_SCK 18    // adapter CLK
#endif
#ifndef PIN_EPD_CS
#  define PIN_EPD_CS 13     // adapter CS
#endif
#ifndef PIN_EPD_DC
#  define PIN_EPD_DC 22     // adapter DC
#endif
#ifndef PIN_EPD_RST
#  define PIN_EPD_RST 21    // adapter RST
#endif
#ifndef PIN_EPD_BUSY
#  define PIN_EPD_BUSY 14   // adapter BUSY (low while the screen is working)
#endif
// Waveshare's newer adapter boards have a ninth pin, PWR, that switches the screen's power: their example
// drives it high before use and low afterwards. -1: not wired to the board (then PWR, if the adapter has one,
// must be joined to 3V3 or the screen has no power). Set to a free pin, e.g. 25, to let the truck switch the
// screen fully off while it sleeps.
// The build guide wires PWR to pin 25 (marked "25/D2") when the adapter has it, so 25 is the default: the truck
// then cuts the screen's power while it sleeps. With an eight-pin adapter pin 25 is simply left unconnected.
#ifndef PIN_EPD_PWR
#  define PIN_EPD_PWR 25
#endif

#ifndef PIN_BATTERY_ADC
#  define PIN_BATTERY_ADC 34   // "34/A2": battery through the board's own 1 M + 1 M divider
#endif
#ifndef PIN_USER_BUTTON
#  define PIN_USER_BUTTON 27   // the board's own button, marked "27/D4" (pressed = low)
#endif
#ifndef PIN_LED
#  define PIN_LED 2            // the board's small green light, marked "2/D9" (lit while set-up is open)
#endif

// ---------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------
#ifndef EPD_SPI_HZ
#  define EPD_SPI_HZ 4000000            // Waveshare's Arduino example uses 4 MHz
#endif
#ifndef EPD_READY_TIMEOUT_MS
#  define EPD_READY_TIMEOUT_MS 5000     // reset, power on, power off: each is a fraction of a second
#endif
#ifndef EPD_REFRESH_TIMEOUT_MS
#  define EPD_REFRESH_TIMEOUT_MS 60000  // a redraw takes 15 to 25 s; give up after a minute
#endif
#ifndef EPD_REFRESH_MIN_MS
#  define EPD_REFRESH_MIN_MS 2000       // a "redraw" that ends sooner than this did not happen (BUSY wire?)
#endif

// ---------------------------------------------------------------------------------------------------------
// Battery (millivolts)
// ---------------------------------------------------------------------------------------------------------
#ifndef BATTERY_DIVIDER_X1000
#  define BATTERY_DIVIDER_X1000 2000    // pin voltage x 2.000 = battery voltage (1 M + 1 M)
#endif
#ifndef BATTERY_LOW_MV
#  define BATTERY_LOW_MV 3450           // under this: "Charge me" (SPEC section 3)
#endif
#ifndef BATTERY_RECOVER_MV
#  define BATTERY_RECOVER_MV 3600       // after "Charge me", carry on only once back above this
#endif
#ifndef BATTERY_HALF_MV
#  define BATTERY_HALF_MV 3700          // battery mark: half at or above this, low below
#endif
#ifndef BATTERY_FULL_MV
#  define BATTERY_FULL_MV 3950          // battery mark: full at or above this
#endif
#ifndef BATTERY_PLAUSIBLE_MIN_MV
#  define BATTERY_PLAUSIBLE_MIN_MV 2500 // a reading under this is no battery reading at all: ignore it
#endif

// ---------------------------------------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------------------------------------
#ifndef WIFI_TIMEOUT_MS
#  define WIFI_TIMEOUT_MS 10000         // give up joining Wi-Fi after 10 s
#endif
#ifndef HTTP_CONNECT_TIMEOUT_MS
#  define HTTP_CONNECT_TIMEOUT_MS 8000
#endif
#ifndef HTTP_STALL_TIMEOUT_MS
#  define HTTP_STALL_TIMEOUT_MS 8000    // no bytes for this long: the download has failed
#endif
#ifndef NETWORK_DEADLINE_MS
#  define NETWORK_DEADLINE_MS 45000     // all downloading must be over this long after waking
#endif
#ifndef AWAKE_DEADLINE_MS
#  define AWAKE_DEADLINE_MS 120000      // whatever happens, asleep again 2 minutes after waking
#endif

#ifndef MIN_SLEEP_S
#  define MIN_SLEEP_S 600               // 10 minutes
#endif
#ifndef MAX_SLEEP_S
#  define MAX_SLEEP_S 345600            // 4 days
#endif
#ifndef STALE_AFTER_S
#  define STALE_AFTER_S 72000           // status.json older than 20 h: the morning job has not run yet
#endif
#ifndef RETRY_SLEEP_S
#  define RETRY_SLEEP_S 1800            // after a failure: 30 minutes
#endif
#ifndef RETRY_MAX
#  define RETRY_MAX 3                   // that many 30-minute retries, then give up for a day
#endif
#ifndef GIVE_UP_SLEEP_S
#  define GIVE_UP_SLEEP_S 86400         // 24 hours
#endif
#ifndef LOW_BATTERY_SLEEP_S
#  define LOW_BATTERY_SLEEP_S 86400     // while waiting to be charged: look at the battery once a day
#endif

// ---------------------------------------------------------------------------------------------------------
// Wi-Fi set-up
// ---------------------------------------------------------------------------------------------------------
#ifndef SETUP_AP_NAME
#  define SETUP_AP_NAME "FoodTruck-Setup"
#endif
#ifndef SETUP_TIMEOUT_S
#  define SETUP_TIMEOUT_S 300           // the set-up hotspot closes after 5 minutes
#endif
#ifndef DOUBLE_RESET_WINDOW_MS
#  define DOUBLE_RESET_WINDOW_MS 4000   // a second press of RST within this opens set-up
#endif
#ifndef WIFI_HOSTNAME
#  define WIFI_HOSTNAME "foodtruck"
#endif
