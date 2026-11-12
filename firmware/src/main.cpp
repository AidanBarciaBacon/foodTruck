// The food truck: what it does each time it wakes (docs/plan/SPEC.md section 3, docs/software/CONTRACT.md).
//
//   1. Wake, by the sleep timer or by the RST button (a press means "refresh now").
//   2. Read the battery. Under 3.45 V: draw "Charge me" once, then wake once a day, with no Wi-Fi, only to
//      read the battery again.
//   3. Join Wi-Fi (10 s limit).
//   4. GET status.json; "now" is the Date header of that answer. If it is more than 20 h old, the morning
//      job has not run yet.
//   5. Same picture as the one on screen? Skip the redraw.
//   6. Otherwise GET today.bin and pass it to the screen as it arrives, stamping the battery mark into its
//      corner on the way; refresh; screen to sleep; remember the picture's hash.
//   7. Sleep until status.json's nextWake (10 minutes at least, 4 days at most).
//
// A failure in 3, 4 or 6 leaves the picture alone, sleeps 30 minutes and tries again, three times; then it
// sleeps a day. Every path ends in deepSleepFor(), and a timer forces sleep two minutes after waking whatever
// the program is doing.
//
// setup() never returns: the board is asleep before it would. loop() is empty.

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>   // tzapu/WiFiManager: the set-up hotspot and page
#include <esp_sleep.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_wifi.h>
#include <mbedtls/sha256.h>
#include <mbedtls/version.h>

#include "charge_card.h"
#include "config.h"
#include "epd7in3e.h"
#include "truck_logic.h"

#ifdef BASE_URL_IS_PLACEHOLDER
#  warning "BASE_URL is still the placeholder: set it in include/config.h, include/secrets.h or with -DBASE_URL (README.md, 'Set the web address')."
#endif

#if DEBUG_LOG
#  define LOG(...)                 \
    do {                           \
      Serial.printf(__VA_ARGS__);  \
      Serial.println();            \
    } while (0)
#else
#  define LOG(...) \
    do {           \
    } while (0)
#endif

namespace {

// ---------------------------------------------------------------------------------------------------------
// What the truck remembers while asleep. This lives in the part of memory that stays powered in deep sleep
// and is wiped by anything else: the RST button, a power cut, a new upload. So a press of RST forgets the
// picture's hash, and the truck redraws: that is the "refresh now".
// ---------------------------------------------------------------------------------------------------------
const uint32_t STATE_MAGIC = 0x7EA7F00D;

struct SleepState {
  uint32_t magic;
  char hash[truck::HASH_CHARS + 1];   // the picture on the screen; "" = unknown
  uint8_t failures;                   // failed wakes in a row
  uint8_t chargeCardShown;            // 1 while the screen shows "Charge me"
  int32_t driftPpm;                   // how far the sleep clock runs slow (+) or fast (-)
  int64_t sleepStartEpoch;            // real time when the last sleep began; 0 = not known
  uint32_t sleepPlannedS;             // how long that sleep was meant to last
};

RTC_DATA_ATTR SleepState state;

// The double-press flag. RTC_NOINIT memory is not reloaded when the program starts, so it can carry a mark
// from one press of RST to the next. Whether it also survives this board's RST button (which cuts the chip's
// enable line) is not certain until tried: see README.md, "Wi-Fi set-up".
const uint32_t DOUBLE_RESET_ARMED = 0xD0B1E5E7;
RTC_NOINIT_ATTR uint32_t doubleResetFlag;

Epd7in3e epd;

// Real time, from status.json's Date header: the header's value and the millis() at which it arrived.
int64_t serverNow = 0;
uint32_t serverNowMs = 0;

int64_t epochNow() {
  if (serverNow == 0) return 0;
  return serverNow + (int64_t)((millis() - serverNowMs) / 1000);
}

// ---------------------------------------------------------------------------------------------------------
// Going to sleep
// ---------------------------------------------------------------------------------------------------------

void radioOff() {
  WiFi.disconnect(true /* radio off */, false /* keep the saved network */);
  WiFi.mode(WIFI_OFF);
  // Bluetooth needs nothing here: this program never starts it, and the Arduino core hands its memory back at
  // start-up when it is unused (initArduino() in esp32-hal-misc.c). Calling btStop() would do harm: it links
  // the Bluetooth controller in (127 kB more flash) and makes the core keep that memory.
}

// Deep sleep for `seconds`; 0 = until the RST button is pressed. Never returns: waking is a fresh start.
[[noreturn]] void deepSleepFor(uint32_t seconds) {
  doubleResetFlag = 0;
  state.sleepStartEpoch = epochNow();
  state.sleepPlannedS = seconds;

  radioOff();
  epd.parkPins();
  digitalWrite(PIN_LED, LOW);

  LOG("[truck] asleep for %u s after %lu ms awake", (unsigned)seconds, (unsigned long)millis());
#if DEBUG_LOG
  Serial.flush();
#endif

  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  if (seconds > 0) esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);   // the only way to wake
  esp_deep_sleep_start();
}

// How long to sleep after one more failure: 30 minutes for the first three in a row, then a day.
uint32_t nextFailureSleep() {
  if (state.failures < 255) ++state.failures;
  const uint32_t seconds =
      truck::failureSleepSeconds(state.failures, RETRY_MAX, RETRY_SLEEP_S, GIVE_UP_SLEEP_S);
  if (state.failures > RETRY_MAX) state.failures = 0;
  return seconds;
}

[[noreturn]] void failAndSleep(const char* what) {
  const uint32_t seconds = nextFailureSleep();
  LOG("[truck] FAILED: %s", what);
  (void)what;
  deepSleepFor(seconds);
}

// The emergency exit. A timer set at wake-up calls this if the program is somehow still running at the
// deadline (a stuck download, a library that never returns). It runs outside the main program, so it does
// the least it can: freeze the wires to the screen as they are and sleep.
void onAwakeDeadline(void*) {
  doubleResetFlag = 0;
  state.sleepStartEpoch = 0;
  state.sleepPlannedS = 0;
  const uint32_t seconds = nextFailureSleep();
  Epd7in3e::freezePinsNow();
  digitalWrite(PIN_LED, LOW);
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_deep_sleep_start();
}

esp_timer_handle_t deadlineTimer = nullptr;

void armAwakeDeadline(uint32_t ms) {
  if (!deadlineTimer) {
    esp_timer_create_args_t args = {};
    args.callback = &onAwakeDeadline;
    args.name = "awake-deadline";
    esp_timer_create(&args, &deadlineTimer);
  } else {
    esp_timer_stop(deadlineTimer);
  }
  esp_timer_start_once(deadlineTimer, (uint64_t)ms * 1000ULL);
}

// ---------------------------------------------------------------------------------------------------------
// Asking for Wi-Fi set-up: RST twice within a few seconds, or the board's own button held while RST is pressed
// ---------------------------------------------------------------------------------------------------------

void onDoubleResetWindowOver(void*) { doubleResetFlag = 0; }

// True if this start is the second press of RST within DOUBLE_RESET_WINDOW_MS. Otherwise leaves a mark for
// the next start to find, and a timer that rubs the mark out when the window closes.
bool secondResetPress() {
  if (doubleResetFlag == DOUBLE_RESET_ARMED) {
    doubleResetFlag = 0;
    return true;
  }
  doubleResetFlag = DOUBLE_RESET_ARMED;
  static esp_timer_handle_t timer = nullptr;
  esp_timer_create_args_t args = {};
  args.callback = &onDoubleResetWindowOver;
  args.name = "double-reset";
  if (esp_timer_create(&args, &timer) == ESP_OK) {
    esp_timer_start_once(timer, (uint64_t)DOUBLE_RESET_WINDOW_MS * 1000ULL);
  } else {
    doubleResetFlag = 0;
  }
  return false;
}

bool userButtonHeld() {
  pinMode(PIN_USER_BUTTON, INPUT_PULLUP);   // the button joins the pin to ground through 220 ohms
  delay(5);
  const bool held = digitalRead(PIN_USER_BUTTON) == LOW;
  pinMode(PIN_USER_BUTTON, INPUT);
  return held;
}

// ---------------------------------------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------------------------------------

// The network name and password are kept by the Wi-Fi library in the board's own flash store (NVS).
bool haveSavedNetwork() {
  WiFi.setHostname(WIFI_HOSTNAME);   // the name the truck shows in the router's list; set before the radio starts
  WiFi.mode(WIFI_STA);
  wifi_config_t conf;
  memset(&conf, 0, sizeof(conf));
  if (esp_wifi_get_config(WIFI_IF_STA, &conf) != ESP_OK) return false;
  return conf.sta.ssid[0] != 0;
}

bool joinWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.begin();   // no arguments: the saved network
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) return false;
    delay(25);
  }
  LOG("[truck] Wi-Fi joined in %lu ms, signal %d dBm", (unsigned long)(millis() - start), (int)WiFi.RSSI());
  return true;
}

// The set-up hotspot. Never returns: it ends in a restart (network saved) or in sleep.
[[noreturn]] void runWifiSetup() {
  LOG("[truck] Wi-Fi set-up: join the network \"%s\" and open http://192.168.4.1", SETUP_AP_NAME);
  armAwakeDeadline((uint32_t)SETUP_TIMEOUT_S * 1000UL + 30000UL);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);

  WiFiManager manager;
  manager.setDebugOutput(DEBUG_LOG != 0);
  manager.setTitle("Food truck Wi-Fi set-up");
  manager.setConfigPortalTimeout(SETUP_TIMEOUT_S);
  // Five minutes means five minutes: a phone that merely stays connected does not keep the hotspot open.
  manager.setAPClientCheck(false);
  manager.setWebPortalClientCheck(false);
  manager.setConnectTimeout(20);
  const bool joined = manager.startConfigPortal(SETUP_AP_NAME);   // an open hotspot, no password

  digitalWrite(PIN_LED, LOW);
  LOG("[truck] set-up closed, %s", joined ? "network saved" : "timed out");
  if (joined || haveSavedNetwork()) {
    doubleResetFlag = 0;
    radioOff();
    delay(100);
    ESP.restart();   // start afresh and fetch the picture
  }
  deepSleepFor(0);   // nothing saved: sleep until RST is pressed, rather than open a hotspot every day
}

// ---------------------------------------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------------------------------------
#if HAS_BATTERY_SENSE

// Millivolts at the battery plug. The board's own divider (two 1 M-ohm resistors, schematic V1.0: R5 and R14)
// halves it onto pin 34/A2; analogReadMilliVolts() applies the chip's factory calibration.
int readBatteryMv() {
  analogSetPinAttenuation(PIN_BATTERY_ADC, ADC_11db);
  (void)analogReadMilliVolts(PIN_BATTERY_ADC);   // the first reading after waking is unreliable
  uint32_t sum = 0;
  const int samples = 16;
  for (int i = 0; i < samples; ++i) {
    sum += analogReadMilliVolts(PIN_BATTERY_ADC);
    delay(2);
  }
  return (int)((uint64_t)(sum / samples) * BATTERY_DIVIDER_X1000 / 1000);
}

// Draws the "Charge me" card, row by row, straight to the screen.
bool drawChargeCard() {
  if (!epd.init()) {
    epd.sleep();
    return false;
  }
  epd.beginFrame();
  uint8_t row[truck::ROW_BYTES];
  for (int i = 0; i < truck::FRAME_H; ++i) {
#if ROTATE_180
    truck::chargeCardRow(truck::FRAME_H - 1 - i, row);
    truck::flip180(row, sizeof(row));
#else
    truck::chargeCardRow(i, row);
#endif
    epd.writeBytes(row, sizeof(row));
  }
  const bool shown = epd.endFrameAndRefresh();
  epd.sleep();
  return shown;
}

// Step 2. Returns only if the battery is fit to carry on.
void checkBattery(int mv) {
  if (state.chargeCardShown) {
    // Waiting to be charged: carry on only once the battery is clearly back up, not at the first flicker
    // above the line (a resting battery creeps up a little by itself).
    if (mv < BATTERY_RECOVER_MV) deepSleepFor(LOW_BATTERY_SLEEP_S);
    state.chargeCardShown = 0;
    state.hash[0] = '\0';   // the screen shows the card, not a picture: redraw
    return;
  }
  if (mv >= BATTERY_LOW_MV) return;

  LOG("[truck] battery low: drawing the Charge me card");
  state.chargeCardShown = drawChargeCard() ? 1 : 0;   // not drawn (screen trouble): try again tomorrow
  state.hash[0] = '\0';
  deepSleepFor(LOW_BATTERY_SLEEP_S);
}

#endif   // HAS_BATTERY_SENSE

// ---------------------------------------------------------------------------------------------------------
// HTTPS
// ---------------------------------------------------------------------------------------------------------

// Waits for the next bytes of an answer and reads up to `want` of them. 0 = the download has failed: the
// connection closed, nothing came for HTTP_STALL_TIMEOUT_MS, or the time for downloading is up.
size_t readSome(WiFiClient* stream, uint8_t* buf, size_t want) {
  const uint32_t waitingSince = millis();
  for (;;) {
    const int available = stream->available();
    if (available > 0) {
      const int n = stream->read(buf, (size_t)available < want ? (size_t)available : want);
      if (n > 0) return (size_t)n;
    } else if (!stream->connected()) {
      return 0;
    }
    if (millis() - waitingSince > HTTP_STALL_TIMEOUT_MS) return 0;
    if (millis() > NETWORK_DEADLINE_MS) return 0;
    delay(1);
  }
}

bool readExactly(WiFiClient* stream, uint8_t* buf, size_t len) {
  size_t got = 0;
  while (got < len) {
    const size_t n = readSome(stream, buf + got, len - got);
    if (n == 0) return false;
    got += n;
  }
  return true;
}

// Step 4: status.json and the time. On success `serverNow` is set.
bool fetchStatus(HTTPClient& http, WiFiClientSecure& tls, truck::Status* status) {
  static const char* wantedHeaders[] = {"Date"};
  const size_t maxBytes = 1024;   // the real file is about 150 bytes

  if (!http.begin(tls, String(BASE_URL) + "status.json")) return false;
  http.collectHeaders(wantedHeaders, 1);
  const int code = http.GET();
  const uint32_t receivedMs = millis();

  bool ok = false;
  do {
    if (code != HTTP_CODE_OK) {
      LOG("[truck] status.json: HTTP %d", code);
      break;
    }
    int64_t now = 0;
    if (!truck::parseHttpDate(http.header("Date").c_str(), &now)) {
      LOG("[truck] status.json: no usable Date header (\"%s\")", http.header("Date").c_str());
      break;
    }
    const int len = http.getSize();
    if (len <= 0 || (size_t)len > maxBytes) {
      LOG("[truck] status.json: length %d", len);
      break;
    }
    char body[maxBytes + 1];
    if (!readExactly(http.getStreamPtr(), (uint8_t*)body, (size_t)len)) break;
    body[len] = '\0';
    if (!truck::parseStatus(body, status)) {
      LOG("[truck] status.json: not understood: %s", body);
      break;
    }
    serverNow = now;
    serverNowMs = receivedMs;
    ok = true;
  } while (false);
  http.end();
  return ok;
}

// SHA-256 as the bytes pass. (The function names changed between the two versions of the library.)
#if VERIFY_HASH && !ROTATE_180
struct Sha256 {
  mbedtls_sha256_context ctx;
  Sha256() {
    mbedtls_sha256_init(&ctx);
#  if MBEDTLS_VERSION_MAJOR >= 3
    mbedtls_sha256_starts(&ctx, 0);
#  else
    mbedtls_sha256_starts_ret(&ctx, 0);
#  endif
  }
  void add(const uint8_t* data, size_t len) {
#  if MBEDTLS_VERSION_MAJOR >= 3
    mbedtls_sha256_update(&ctx, data, len);
#  else
    mbedtls_sha256_update_ret(&ctx, data, len);
#  endif
  }
  void finish(uint8_t digest[32]) {
#  if MBEDTLS_VERSION_MAJOR >= 3
    mbedtls_sha256_finish(&ctx, digest);
#  else
    mbedtls_sha256_finish_ret(&ctx, digest);
#  endif
    mbedtls_sha256_free(&ctx);
  }
};
#endif

// The address of today's picture. GitHub Pages ignores the "?h=..." but the cache in front of it does not,
// so the truck can never be handed yesterday's cached today.bin beside today's status.json.
String pictureUrl(const truck::Status& status) { return String(BASE_URL) + "today.bin?h=" + status.hash; }

#if !ROTATE_180

// The picture passes through this, 4 kB at a time. It is never held whole: 192 kB would not fit.
uint8_t chunk[4096];

// Step 6, the usual way: one download, top row first, passed to the screen as it arrives.
// True once the picture is in the screen's memory, whole and checked. Nothing is shown yet.
bool streamPicture(HTTPClient& http, WiFiClientSecure& tls, const truck::Status& status,
                   truck::BatteryLevel battery) {
  if (millis() > NETWORK_DEADLINE_MS) return false;
  if (!http.begin(tls, pictureUrl(status))) return false;
  const int code = http.GET();
  if (code != HTTP_CODE_OK || http.getSize() != (int)truck::FRAME_BYTES) {
    LOG("[truck] today.bin: HTTP %d, length %d (want %u)", code, http.getSize(), (unsigned)truck::FRAME_BYTES);
    http.end();
    return false;
  }
  if (!epd.init()) {
    LOG("[truck] the screen does not answer");
    http.end();
    return false;
  }
  epd.beginFrame();

#  if VERIFY_HASH
  Sha256 sha;
#  endif
  WiFiClient* stream = http.getStreamPtr();
  size_t got = 0;
  while (got < truck::FRAME_BYTES) {
    const size_t left = truck::FRAME_BYTES - got;
    const size_t n = readSome(stream, chunk, left < sizeof(chunk) ? left : sizeof(chunk));
    if (n == 0) break;
#  if VERIFY_HASH
    sha.add(chunk, n);
#  endif
    truck::stampBatteryMark(chunk, got, n, battery);
    epd.writeBytes(chunk, n);
    got += n;
  }
  http.end();

  if (got != truck::FRAME_BYTES) {
    LOG("[truck] today.bin: stopped after %u of %u bytes", (unsigned)got, (unsigned)truck::FRAME_BYTES);
    return false;
  }
#  if VERIFY_HASH
  uint8_t digest[32];
  char hex[truck::HASH_CHARS + 1];
  sha.finish(digest);
  truck::hashPrefixHex(digest, hex);
  if (strcmp(hex, status.hash) != 0) {
    LOG("[truck] today.bin: hash %s, status.json says %s", hex, status.hash);
    return false;
  }
#  endif
  return true;
}

#else   // ROTATE_180

// Step 6 for a panel mounted the other way up. A picture turned by 180 degrees is its bytes in reverse order,
// and the truck cannot hold the picture to reverse it. So it asks for the file in twelve pieces, LAST piece
// first (HTTP "Range" requests, which GitHub Pages answers), turns each piece round, and sends it on.
bool streamPicture(HTTPClient& http, WiFiClientSecure& tls, const truck::Status& status,
                   truck::BatteryLevel battery) {
  static const char* wantedHeaders[] = {"Content-Range"};
  const size_t pieceBytes = 16000;   // 40 rows; 192,000 / 16,000 = 12 pieces
  uint8_t* piece = (uint8_t*)malloc(pieceBytes);
  if (!piece) return false;

  const String url = pictureUrl(status);
  bool screenReady = false;
  bool ok = millis() <= NETWORK_DEADLINE_MS;
  for (size_t end = truck::FRAME_BYTES; ok && end > 0; end -= pieceBytes) {
    const size_t start = end - pieceBytes;
    char range[48];
    char wantRange[48];
    snprintf(range, sizeof(range), "bytes=%u-%u", (unsigned)start, (unsigned)(end - 1));
    snprintf(wantRange, sizeof(wantRange), "bytes %u-%u/%u", (unsigned)start, (unsigned)(end - 1),
             (unsigned)truck::FRAME_BYTES);

    ok = http.begin(tls, url);
    if (!ok) break;
    http.collectHeaders(wantedHeaders, 1);
    http.addHeader("Range", range);
    const int code = http.GET();
    // 206 = "here is the part you asked for"; the Content-Range header also states the whole file's length.
    ok = code == HTTP_CODE_PARTIAL_CONTENT && http.getSize() == (int)pieceBytes &&
         http.header("Content-Range") == wantRange && readExactly(http.getStreamPtr(), piece, pieceBytes);
    if (!ok) LOG("[truck] today.bin %s: HTTP %d, length %d", range, code, http.getSize());
    http.end();
    if (!ok) break;

    if (!screenReady) {
      ok = epd.init();
      if (!ok) {
        LOG("[truck] the screen does not answer");
        break;
      }
      epd.beginFrame();
      screenReady = true;
    }
    truck::stampBatteryMark(piece, start, pieceBytes, battery);
    truck::flip180(piece, pieceBytes);
    epd.writeBytes(piece, pieceBytes);
  }
  free(piece);
  return ok;
}

#endif   // ROTATE_180

// Step 6 in full: download, show, screen to sleep. True only if the new picture is really on the screen.
bool downloadAndShow(HTTPClient& http, WiFiClientSecure& tls, const truck::Status& status,
                     truck::BatteryLevel battery) {
  const bool loaded = streamPicture(http, tls, status, battery);
  radioOff();   // the radio is the big drain, and the half minute of redrawing does not need it
  if (!loaded) {
    epd.sleep();   // nothing was refreshed, so the old picture stays
    return false;
  }
  const bool shown = epd.endFrameAndRefresh();
  LOG("[truck] refresh %s in %lu ms", shown ? "done" : "FAILED", (unsigned long)epd.lastRefreshMs());
  epd.sleep();
  return shown;
}

// Step 7.
[[noreturn]] void sleepUntilNextWake(const truck::Status& status) {
  const uint32_t wanted = truck::sleepSecondsUntil(status.nextWake, epochNow(), MIN_SLEEP_S, MAX_SLEEP_S);
  // Ask the sleep clock for a little less or more, by what it was off last time.
  const uint32_t asked =
      truck::clampSeconds(truck::applyDrift(wanted, state.driftPpm), MIN_SLEEP_S, MAX_SLEEP_S);
  state.failures = 0;
  deepSleepFor(asked);
}

// Compares the sleep just ended with what it was meant to be, now that the real time is known.
void learnClockDrift() {
  if (state.sleepStartEpoch <= 0 || state.sleepPlannedS == 0) return;
  const int64_t wokeAt = serverNow - (int64_t)(serverNowMs / 1000);
  const int32_t ppm = truck::measureDriftPpm(state.sleepPlannedS, wokeAt - state.sleepStartEpoch);
  if (ppm != truck::DRIFT_UNKNOWN) {
    state.driftPpm = ppm;
    LOG("[truck] sleep clock off by %ld ppm", (long)ppm);
  }
}

}   // namespace

void setup() {
  const esp_reset_reason_t reason = esp_reset_reason();
  const bool timerWake = (reason == ESP_RST_DEEPSLEEP);
  armAwakeDeadline(AWAKE_DEADLINE_MS);

#if DEBUG_LOG
  Serial.begin(115200);
  delay(20);
#endif
  LOG("\n[truck] awake (reset reason %d), files at %s", (int)reason, BASE_URL);

  // Anything but the sleep timer is a fresh start: forget the picture, the failure count, everything.
  if (!timerWake || state.magic != STATE_MAGIC) {
    memset(&state, 0, sizeof(state));
    state.magic = STATE_MAGIC;
  }
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // Restarted by a fault? Do not run straight back into it. A brown-out means the battery sagged under load.
  if (reason == ESP_RST_BROWNOUT) deepSleepFor(LOW_BATTERY_SLEEP_S);
  if (reason == ESP_RST_PANIC || reason == ESP_RST_INT_WDT || reason == ESP_RST_TASK_WDT ||
      reason == ESP_RST_WDT) {
    deepSleepFor(RETRY_SLEEP_S);
  }

  // Set-up is only ever asked for by hand, never by the sleep timer.
  bool setupAsked = false;
  if (!timerWake) {
    const bool pressedTwice = secondResetPress();   // always called: it also leaves the mark for next time
    setupAsked = pressedTwice || userButtonHeld();
  }

  // Step 2: the battery.
  truck::BatteryLevel battery = truck::BatteryLevel::Unknown;
#if HAS_BATTERY_SENSE
  const int batteryMv = readBatteryMv();
  battery = truck::classifyBattery(batteryMv, BATTERY_PLAUSIBLE_MIN_MV, BATTERY_HALF_MV, BATTERY_FULL_MV);
  LOG("[truck] battery %d mV", batteryMv);
  // A reading that cannot be a battery (no divider on this board after all?) is ignored, not obeyed.
  if (battery != truck::BatteryLevel::Unknown && !setupAsked) checkBattery(batteryMv);
#endif

  // Wi-Fi set-up: when asked for, and on a first start with no network saved.
  const bool networkSaved = haveSavedNetwork();
  if (setupAsked || (!timerWake && !networkSaved)) runWifiSetup();
  if (!networkSaved) deepSleepFor(0);

  // Step 3: Wi-Fi.
  if (!joinWifi()) failAndSleep("could not join Wi-Fi");

  // Step 4: status.json and the time.
  WiFiClientSecure tls;
  tls.setInsecure();   // no certificate check, on purpose: README.md, "HTTPS"
  tls.setHandshakeTimeout(HTTP_CONNECT_TIMEOUT_MS / 1000);
  HTTPClient http;
  http.setReuse(true);   // one connection for both files
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_STALL_TIMEOUT_MS);

  truck::Status status;
  if (!fetchStatus(http, tls, &status)) failAndSleep("could not read status.json");
  learnClockDrift();
  LOG("[truck] now %lld, made %lld, next wake %lld, hash %s (on screen: %s)", (long long)serverNow,
      (long long)status.generatedAt, (long long)status.nextWake, status.hash,
      state.hash[0] ? state.hash : "unknown");

  if (truck::isStale(serverNow, status.generatedAt, STALE_AFTER_S)) {
    failAndSleep("status.json is more than 20 h old: the morning job has not run yet");
  }

  // Step 5: the same picture? Nothing to draw.
  if (strcmp(status.hash, state.hash) == 0) {
    LOG("[truck] picture unchanged");
    sleepUntilNextWake(status);
  }

  // Step 6: the new picture.
  if (!downloadAndShow(http, tls, status, battery)) failAndSleep("could not fetch or show the picture");
  memcpy(state.hash, status.hash, sizeof(state.hash));   // only now: it is on the screen

  // Step 7.
  sleepUntilNextWake(status);
}

void loop() {
  // Never reached: setup() always ends in deep sleep. If it ever is, sleep.
  deepSleepFor(RETRY_SLEEP_S);
}
