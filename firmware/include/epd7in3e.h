// Driver for the Waveshare 7.3inch e-Paper (E): 800 x 480, six colours ("Spectra 6", Good Display GDEP073E01),
// 4-wire SPI through Waveshare's adapter board.
//
// It has NO frame buffer. A picture is 192,000 bytes and the board has no spare memory for one, so the bytes
// go to the screen as they are handed over:
//
//     epd.init();                    // wake the screen up
//     epd.beginFrame();              // "here comes a picture"
//     epd.writeBytes(chunk, n);      // ... as often as needed, 192,000 bytes in all
//     epd.endFrameAndRefresh();      // show it (15 to 25 s, the screen flashes)
//     epd.sleep();                   // screen into deep sleep
//     epd.parkPins();                // wires left in a state that leaks nothing, held through the board's sleep
//
// Sources (every command and number below comes from one of these; nothing has run on a real screen yet):
//
//   [W]  Waveshare's example for this exact panel. There is no "Arduino/epd7in3e" folder in their repository;
//        the E panel's driver is in the Raspberry Pi C tree and, identical, in the Arduino R4 tree:
//        https://github.com/waveshareteam/e-Paper/blob/master/RaspberryPi_JetsonNano/c/lib/e-Paper/EPD_7in3e.c
//        https://github.com/waveshareteam/e-Paper/blob/master/RaspberryPi_JetsonNano/c/lib/e-Paper/EPD_7in3e.h
//        https://github.com/waveshareteam/e-Paper/blob/master/Arduino_R4/src/e-Paper/EPD_7in3e.cpp
//        https://github.com/waveshareteam/e-Paper/blob/master/Arduino_R4/src/Config/DEV_Config.cpp  (SPI mode, PWR pin)
//   [G]  Good Display's specification of the panel, GDEP073E01 rev 1.0 (command table: power off 0x02,
//        power on 0x04, deep sleep 0x07 + 0xA5, data 0x10, refresh 0x12; "To Exit Deep Sleep mode, User
//        required to send HWRESET"; BUSY_N low = busy; scan starts top-left with the ribbon at the bottom):
//        https://laskakit.cz/user/related_files/gdep073e01-1-0.pdf
//   [X]  GxEPD2's driver for the same panel, a second independent implementation (same start-up bytes, holds
//        CS low across a run of data bytes, names the registers):
//        https://github.com/ZinggJM/GxEPD2/blob/master/src/epd7c/GxEPD2_730c_GDEP073E01.cpp
//   [M]  Waveshare's manual for the set, "Precautions": "When the screen is not refreshed, please set the
//        screen to sleep mode or power it off", otherwise it "will remain in a high voltage state for a long
//        time"; refresh no more often than every 180 s:
//        https://www.waveshare.com/wiki/7.3inch_e-Paper_HAT_(E)_Manual
//
// Colour codes, from [W] EPD_7in3e.h: black 0x0, white 0x1, yellow 0x2, red 0x3, blue 0x5, green 0x6
// (0x4 is commented out there). Each byte carries two pixels, the left one in the high four bits: [W] Clear()
// sends (color << 4) | color, and its Python twin packs (pixel[i] << 4) + pixel[i + 1].
//
// The picture goes to the screen in the order given, first byte = top-left with the ribbon at the bottom [G].
// This driver does not rotate anything; see ROTATE_180 in main.cpp and the README.
#pragma once

#include <Arduino.h>

class Epd7in3e {
 public:
  static const uint16_t WIDTH = 800;
  static const uint16_t HEIGHT = 480;
  static const uint32_t FRAME_BYTES = (uint32_t)WIDTH * HEIGHT / 2;   // 192,000

  // Powers the screen (if PIN_EPD_PWR is set), resets it and sends the start-up settings.
  // False if the screen never reports ready (not connected, no power).
  bool init();

  // Command 0x10: the next 192,000 bytes are the picture.
  void beginFrame();

  // Picture bytes, straight to the panel. Any chunk size; call as often as needed.
  void writeBytes(const uint8_t* data, size_t len);

  // Shows the picture: power on, refresh, power off. Blocks for 15 to 25 s.
  // False if fewer or more than 192,000 bytes were sent since beginFrame() (nothing is shown then), if BUSY
  // never came back within EPD_REFRESH_TIMEOUT_MS, or if it came back implausibly fast.
  bool endFrameAndRefresh();

  // Power off, then deep sleep (command 0x07, 0xA5). Only init() wakes the screen again.
  void sleep();

  // The whole screen in one colour (a code from the table above), shown. Calls beginFrame() itself.
  bool fillColour(uint8_t code);

  // Lets go of the SPI bus and leaves every wire to the screen at a fixed level, held while the board is in
  // deep sleep. Safe to call whether or not the screen was used this time.
  void parkPins();

  // For the emergency exit only (it may run while a transfer is under way): freeze the wires as they are.
  static void freezePinsNow();

  // How long the last refresh took, in milliseconds (for the debug log).
  uint32_t lastRefreshMs() const { return _lastRefreshMs; }

 private:
  void sendCommand(uint8_t command);
  void sendCommand(uint8_t command, const uint8_t* data, size_t len);
  bool waitUntilIdle(uint32_t timeoutMs);
  void hardwareReset();
  void claimPins();

  bool _busOpen = false;
  uint32_t _sent = 0;
  uint32_t _lastRefreshMs = 0;
};
