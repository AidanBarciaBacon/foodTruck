// Driver for the Waveshare 7.3inch e-Paper (E). The sources marked [W], [G], [X], [M] are listed in epd7in3e.h.

#include "epd7in3e.h"

#include <SPI.h>
#include <driver/gpio.h>

#include "config.h"

namespace {

// Register names as in [X]; the bytes are [W]'s, in [W]'s order.
const uint8_t CMD_PSR = 0x00;     // panel setting
const uint8_t CMD_PWRR = 0x01;    // power setting
const uint8_t CMD_POF = 0x02;     // power off
const uint8_t CMD_POFS = 0x03;    // power-off sequence
const uint8_t CMD_PON = 0x04;     // power on
const uint8_t CMD_BTST1 = 0x05;   // booster soft start 1
const uint8_t CMD_BTST2 = 0x06;   // booster soft start 2
const uint8_t CMD_DSLP = 0x07;    // deep sleep
const uint8_t CMD_BTST3 = 0x08;   // booster soft start 3
const uint8_t CMD_DTM = 0x10;     // data start transmission
const uint8_t CMD_DRF = 0x12;     // display refresh
const uint8_t CMD_PLL = 0x30;
const uint8_t CMD_CDI = 0x50;     // VCOM and data interval
const uint8_t CMD_TCON = 0x60;
const uint8_t CMD_TRES = 0x61;    // resolution
const uint8_t CMD_T_VDCS = 0x84;
const uint8_t CMD_PWS = 0xE3;     // power saving
const uint8_t CMD_CMDH = 0xAA;    // unlocks the settings

const bool POWER_IS_SWITCHED = (PIN_EPD_PWR >= 0);

// The wires this board drives. BUSY is the screen's to drive and is left as a plain input.
const int8_t DRIVEN_PINS[] = {PIN_EPD_SCK, PIN_EPD_MOSI, PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_PWR};

void setOutput(int8_t pin, uint8_t level) {
  if (pin < 0) return;
  pinMode(pin, OUTPUT);
  digitalWrite(pin, level);
}

// A "hold" freezes a pin at its present level, through deep sleep too. While a pin is held, pinMode() and
// digitalWrite() are remembered but do not reach the pin; letting go applies them at once. So: set the level
// wanted, let go, hold again, and the pin never floats.
void rehold(int8_t pin) {
  if (pin < 0) return;
  gpio_hold_dis((gpio_num_t)pin);
  gpio_hold_en((gpio_num_t)pin);
}

void letGo(int8_t pin) {
  if (pin < 0) return;
  gpio_hold_dis((gpio_num_t)pin);
}

}  // namespace

void Epd7in3e::claimPins() {
  // Levels first, then release the holds left from the last sleep: nothing glitches on the way.
  setOutput(PIN_EPD_PWR, HIGH);   // [W] DEV_Config: PWR high before anything else (skipped when not wired)
  pinMode(PIN_EPD_BUSY, INPUT);
  setOutput(PIN_EPD_RST, HIGH);
  setOutput(PIN_EPD_DC, LOW);
  setOutput(PIN_EPD_CS, HIGH);
  gpio_deep_sleep_hold_dis();
  letGo(PIN_EPD_PWR);
  if (POWER_IS_SWITCHED) delay(50);   // let the screen's supply come up (our figure, not from a source)
  for (int8_t pin : DRIVEN_PINS) letGo(pin);

  // The screen is write-only here and CS is driven by hand, so no MISO or SS pin is given. (For MISO the
  // library then falls back to the bus's usual pin, GPIO 19, as an input; nothing is wired to it.)
  SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, -1);
  _busOpen = true;
}

void Epd7in3e::hardwareReset() {
  // [W] EPD_7IN3E_Reset: high 20 ms, low 2 ms, high 20 ms. Keep the low pulse short: [M]'s FAQ warns that a
  // long reset-low makes the adapter board's power switch cut the screen's power.
  digitalWrite(PIN_EPD_RST, HIGH);
  delay(20);
  digitalWrite(PIN_EPD_RST, LOW);
  delay(2);
  digitalWrite(PIN_EPD_RST, HIGH);
  delay(20);
}

void Epd7in3e::sendCommand(uint8_t command) { sendCommand(command, nullptr, 0); }

// [W] EPD_7IN3E_SendCommand / SendData: DC low for the command byte, high for data, CS low around each byte.
void Epd7in3e::sendCommand(uint8_t command, const uint8_t* data, size_t len) {
  SPI.beginTransaction(SPISettings(EPD_SPI_HZ, MSBFIRST, SPI_MODE0));   // [W] DEV_Config: mode 0, MSB first
  digitalWrite(PIN_EPD_DC, LOW);
  digitalWrite(PIN_EPD_CS, LOW);
  SPI.transfer(command);
  digitalWrite(PIN_EPD_CS, HIGH);
  digitalWrite(PIN_EPD_DC, HIGH);
  for (size_t i = 0; i < len; ++i) {
    digitalWrite(PIN_EPD_CS, LOW);
    SPI.transfer(data[i]);
    digitalWrite(PIN_EPD_CS, HIGH);
  }
  SPI.endTransaction();
}

// [W] EPD_7IN3E_ReadBusyH: "LOW: busy, HIGH: idle". [W] waits for ever; this gives up after timeoutMs.
bool Epd7in3e::waitUntilIdle(uint32_t timeoutMs) {
  const uint32_t start = millis();
  while (digitalRead(PIN_EPD_BUSY) == LOW) {
    if (millis() - start > timeoutMs) return false;
    delay(5);
  }
  return true;
}

bool Epd7in3e::init() {
  claimPins();
  _sent = 0;

  // [W] EPD_7IN3E_Init, byte for byte.
  hardwareReset();
  if (!waitUntilIdle(EPD_READY_TIMEOUT_MS)) return false;
  delay(30);

  static const uint8_t cmdh[] = {0x49, 0x55, 0x20, 0x08, 0x09, 0x18};
  static const uint8_t pwrr[] = {0x3F};
  static const uint8_t psr[] = {0x5F, 0x69};
  static const uint8_t pofs[] = {0x00, 0x54, 0x00, 0x44};
  static const uint8_t btst1[] = {0x40, 0x1F, 0x1F, 0x2C};
  static const uint8_t btst2[] = {0x6F, 0x1F, 0x17, 0x49};
  static const uint8_t btst3[] = {0x6F, 0x1F, 0x1F, 0x22};
  static const uint8_t pll[] = {0x03};
  static const uint8_t cdi[] = {0x3F};
  static const uint8_t tcon[] = {0x02, 0x00};
  static const uint8_t tres[] = {0x03, 0x20, 0x01, 0xE0};   // 0x0320 = 800, 0x01E0 = 480
  static const uint8_t tvdcs[] = {0x01};
  static const uint8_t pws[] = {0x2F};

  sendCommand(CMD_CMDH, cmdh, sizeof(cmdh));
  sendCommand(CMD_PWRR, pwrr, sizeof(pwrr));
  sendCommand(CMD_PSR, psr, sizeof(psr));
  sendCommand(CMD_POFS, pofs, sizeof(pofs));
  sendCommand(CMD_BTST1, btst1, sizeof(btst1));
  sendCommand(CMD_BTST2, btst2, sizeof(btst2));
  sendCommand(CMD_BTST3, btst3, sizeof(btst3));
  sendCommand(CMD_PLL, pll, sizeof(pll));
  sendCommand(CMD_CDI, cdi, sizeof(cdi));
  sendCommand(CMD_TCON, tcon, sizeof(tcon));
  sendCommand(CMD_TRES, tres, sizeof(tres));
  sendCommand(CMD_T_VDCS, tvdcs, sizeof(tvdcs));
  sendCommand(CMD_PWS, pws, sizeof(pws));

  sendCommand(CMD_PON);
  return waitUntilIdle(EPD_READY_TIMEOUT_MS);
}

void Epd7in3e::beginFrame() {
  sendCommand(CMD_DTM);   // [W] EPD_7IN3E_Display: 0x10, then Width / 2 * Height = 192,000 data bytes
  _sent = 0;
}

void Epd7in3e::writeBytes(const uint8_t* data, size_t len) {
  if (len == 0) return;
  // One CS-low for the whole chunk, as [X] does for runs of data ([W] toggles CS for every byte, which the
  // screen does not need and which would take several times longer).
  SPI.beginTransaction(SPISettings(EPD_SPI_HZ, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_EPD_DC, HIGH);
  digitalWrite(PIN_EPD_CS, LOW);
  SPI.writeBytes(data, len);
  digitalWrite(PIN_EPD_CS, HIGH);
  SPI.endTransaction();
  _sent += len;
}

bool Epd7in3e::endFrameAndRefresh() {
  // A short or long picture would be shown shifted: do not show it at all.
  if (_sent != FRAME_BYTES) return false;

  // [W] EPD_7IN3E_TurnOnDisplay, byte for byte.
  sendCommand(CMD_PON);
  if (!waitUntilIdle(EPD_READY_TIMEOUT_MS)) return false;

  static const uint8_t btst2[] = {0x6F, 0x1F, 0x17, 0x49};   // [W]: "Second setting"
  sendCommand(CMD_BTST2, btst2, sizeof(btst2));

  static const uint8_t drf[] = {0x00};
  sendCommand(CMD_DRF, drf, sizeof(drf));
  delay(10);   // give BUSY time to drop ([X] waits 1 ms here, [W] not at all)
  const uint32_t start = millis();
  const bool finished = waitUntilIdle(EPD_REFRESH_TIMEOUT_MS);
  _lastRefreshMs = millis() - start;

  // Power off whatever happened, so the screen is never left with its high voltages on [M].
  static const uint8_t pof[] = {0x00};
  sendCommand(CMD_POF, pof, sizeof(pof));
  waitUntilIdle(EPD_READY_TIMEOUT_MS);

  // A refresh takes many seconds. One that "finishes" at once means BUSY is not really connected.
  return finished && _lastRefreshMs >= EPD_REFRESH_MIN_MS;
}

void Epd7in3e::sleep() {
  if (!_busOpen) return;   // not woken this time: it is still asleep from last time

  // [W] EPD_7IN3E_Sleep: power off, wait, then 0x07 + 0xA5. [G]: only a hardware reset ends deep sleep.
  static const uint8_t pof[] = {0x00};
  sendCommand(CMD_POF, pof, sizeof(pof));
  waitUntilIdle(EPD_READY_TIMEOUT_MS);
  static const uint8_t dslp[] = {0xA5};
  sendCommand(CMD_DSLP, dslp, sizeof(dslp));
}

bool Epd7in3e::fillColour(uint8_t code) {
  uint8_t row[100];
  memset(row, (uint8_t)(((code & 0x0F) << 4) | (code & 0x0F)), sizeof(row));   // [W] EPD_7IN3E_Clear
  beginFrame();
  for (uint32_t sent = 0; sent < FRAME_BYTES; sent += sizeof(row)) writeBytes(row, sizeof(row));
  return endFrameAndRefresh();
}

void Epd7in3e::parkPins() {
  if (_busOpen) {
    SPI.end();
    _busOpen = false;
  }
  gpio_deep_sleep_hold_dis();
  pinMode(PIN_EPD_BUSY, INPUT);   // no pull-up or pull-down: the screen drives this wire

  if (POWER_IS_SWITCHED) {
    // The screen is about to lose its power: every wire low, or current would creep into it through them.
    setOutput(PIN_EPD_SCK, LOW);
    setOutput(PIN_EPD_MOSI, LOW);
    setOutput(PIN_EPD_DC, LOW);
    setOutput(PIN_EPD_CS, LOW);
    setOutput(PIN_EPD_RST, LOW);
    setOutput(PIN_EPD_PWR, LOW);   // [W] DEV_Module_Exit: PWR low
  } else {
    // The screen keeps its 3.3 V: hold each wire at a definite level so no input floats. CS high (not
    // selected) and RST high (not in reset: a low RST would wake it from deep sleep), the rest low.
    setOutput(PIN_EPD_SCK, LOW);
    setOutput(PIN_EPD_MOSI, LOW);
    setOutput(PIN_EPD_DC, LOW);
    setOutput(PIN_EPD_CS, HIGH);
    setOutput(PIN_EPD_RST, HIGH);
  }
  for (int8_t pin : DRIVEN_PINS) rehold(pin);
  gpio_deep_sleep_hold_en();
}

void Epd7in3e::freezePinsNow() {
  if (POWER_IS_SWITCHED) digitalWrite(PIN_EPD_PWR, LOW);
  for (int8_t pin : DRIVEN_PINS) {
    if (pin >= 0) gpio_hold_en((gpio_num_t)pin);
  }
  gpio_deep_sleep_hold_en();
}
