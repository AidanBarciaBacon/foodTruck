// Host-side tests for the parts of the firmware that have no hardware in them (include/truck_logic.h and
// include/charge_card.h), built with the Mac's own compiler. Run them with:  bash firmware/test/run.sh
//
// With "--card FILE.bmp" or "--mark FILE.bmp" it instead draws the "Charge me" card, or the three battery
// marks enlarged, to a picture file, to be looked at.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "charge_card.h"
#include "config.h"
#include "truck_logic.h"

using namespace truck;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                    \
  do {                                                                 \
    ++checks;                                                          \
    if (!(cond)) {                                                     \
      ++failures;                                                      \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);      \
    }                                                                  \
  } while (0)

#define CHECK_EQ(a, b)                                                                              \
  do {                                                                                              \
    ++checks;                                                                                       \
    const long long va = (long long)(a);                                                            \
    const long long vb = (long long)(b);                                                            \
    if (va != vb) {                                                                                 \
      ++failures;                                                                                   \
      std::printf("FAIL %s:%d  %s = %lld, want %s = %lld\n", __FILE__, __LINE__, #a, va, #b, vb);   \
    }                                                                                               \
  } while (0)

static int64_t date(const char* s) {
  int64_t out = -1;
  return parseHttpDate(s, &out) ? out : -1;
}

static void testHttpDate() {
  // The example in RFC 7231 section 7.1.1.1.
  CHECK_EQ(date("Sun, 06 Nov 1994 08:49:37 GMT"), 784111777);
  CHECK_EQ(date("Thu, 01 Jan 1970 00:00:00 GMT"), 0);
  // The contract's sample status.json: generatedAt 1794493864 is 2026-11-12 06:31:04 Pacific (UTC-8).
  CHECK_EQ(date("Thu, 12 Nov 2026 14:31:04 GMT"), 1794493864);
  // Leap days, the end of a year, the year 2038 (past 32 bits), a leap second.
  CHECK_EQ(date("Tue, 29 Feb 2000 12:00:00 GMT"), 951825600);
  CHECK_EQ(date("Thu, 29 Feb 2024 23:59:59 GMT"), 1709251199);
  CHECK_EQ(date("Fri, 01 Mar 2024 00:00:00 GMT"), 1709251200);
  CHECK_EQ(date("Thu, 31 Dec 2026 23:59:59 GMT"), 1798761599);
  CHECK_EQ(date("Fri, 01 Jan 2027 00:00:00 GMT"), 1798761600);
  CHECK_EQ(date("Tue, 19 Jan 2038 03:14:08 GMT"), 2147483648LL);
  CHECK_EQ(date("Sat, 31 Dec 2016 23:59:60 GMT"), 1483228800);
  // Tolerated: space around it, a line end after it, month in another case.
  CHECK_EQ(date("  Sun, 06 Nov 1994 08:49:37 GMT\r\n"), 784111777);
  CHECK_EQ(date("Sun, 06 NOV 1994 08:49:37 GMT"), 784111777);

  // Refused.
  CHECK_EQ(date(""), -1);
  CHECK_EQ(date("Sun, 06 Nov 1994 08:49:37"), -1);            // no zone
  CHECK_EQ(date("Sun, 06 Nov 1994 08:49:37 +0000"), -1);      // not the HTTP form
  CHECK_EQ(date("Sun, 06 Nov 1994 08:49:37 GMT+1"), -1);      // trailing text
  CHECK_EQ(date("Sunday, 06-Nov-94 08:49:37 GMT"), -1);       // the obsolete RFC 850 form
  CHECK_EQ(date("Sun Nov  6 08:49:37 1994"), -1);             // the obsolete asctime form
  CHECK_EQ(date("Sun, 6 Nov 1994 08:49:37 GMT"), -1);         // one-digit day
  CHECK_EQ(date("Sun, 06 Nvo 1994 08:49:37 GMT"), -1);
  CHECK_EQ(date("Sun, 31 Nov 1994 08:49:37 GMT"), -1);        // November has 30 days
  CHECK_EQ(date("Sat, 29 Feb 2025 08:49:37 GMT"), -1);        // 2025 is not a leap year
  CHECK_EQ(date("Sun, 00 Nov 1994 08:49:37 GMT"), -1);
  CHECK_EQ(date("Sun, 06 Nov 1994 24:00:00 GMT"), -1);
  CHECK_EQ(date("Sun, 06 Nov 1994 08:60:00 GMT"), -1);
  CHECK_EQ(date("Sun, 06 Nov 1994 08:49:61 GMT"), -1);
  CHECK_EQ(date("Sun, 06 Nov 1969 08:49:37 GMT"), -1);
  int64_t out = 0;
  CHECK(!parseHttpDate(nullptr, &out));
  CHECK(!parseHttpDate("Sun, 06 Nov 1994 08:49:37 GMT", nullptr));

  CHECK_EQ(daysFromCivil(1970, 1, 1), 0);
  CHECK_EQ(daysFromCivil(2000, 3, 1), 11017);
  CHECK(isLeapYear(2000) && isLeapYear(2024) && !isLeapYear(1900) && !isLeapYear(2026));
}

static void testSleepLengths() {
  const int64_t now = 1794495600;   // 2026-11-12 15:00:00 UTC, 7:00 AM Pacific
  // The usual case: the next market morning, 24 hours on.
  CHECK_EQ(sleepSecondsUntil(now + 86400, now, MIN_SLEEP_S, MAX_SLEEP_S), 86400);
  // Thursday to Monday: 4 days exactly, the most allowed.
  CHECK_EQ(sleepSecondsUntil(now + 4 * 86400, now, MIN_SLEEP_S, MAX_SLEEP_S), 345600);
  // A holiday break: clamped to 4 days; the truck wakes, finds the same picture and sleeps again.
  CHECK_EQ(sleepSecondsUntil(now + 14 * 86400, now, MIN_SLEEP_S, MAX_SLEEP_S), 345600);
  // nextWake already past, or seconds away: 10 minutes, never less.
  CHECK_EQ(sleepSecondsUntil(now - 5000, now, MIN_SLEEP_S, MAX_SLEEP_S), 600);
  CHECK_EQ(sleepSecondsUntil(now, now, MIN_SLEEP_S, MAX_SLEEP_S), 600);
  CHECK_EQ(sleepSecondsUntil(now + 599, now, MIN_SLEEP_S, MAX_SLEEP_S), 600);
  CHECK_EQ(sleepSecondsUntil(now + 600, now, MIN_SLEEP_S, MAX_SLEEP_S), 600);
  CHECK_EQ(sleepSecondsUntil(now + 601, now, MIN_SLEEP_S, MAX_SLEEP_S), 601);
  CHECK_EQ(sleepSecondsUntil(now + 345601, now, MIN_SLEEP_S, MAX_SLEEP_S), 345600);
  CHECK_EQ(MIN_SLEEP_S, 10 * 60);
  CHECK_EQ(MAX_SLEEP_S, 4 * 24 * 3600);

  // Stale: more than 20 hours old, not exactly 20.
  CHECK_EQ(STALE_AFTER_S, 20 * 3600);
  CHECK(!isStale(now, now - 1740, STALE_AFTER_S));          // made at 6:31, read at 7:00
  CHECK(!isStale(now, now - 72000, STALE_AFTER_S));
  CHECK(isStale(now, now - 72001, STALE_AFTER_S));
  CHECK(isStale(now, now - 86400 - 1740, STALE_AFTER_S));   // yesterday's
  CHECK(!isStale(now, now + 30, STALE_AFTER_S));            // clocks a little apart: not stale

  // Failures: 30 minutes after each of the first three in a row, then a day.
  CHECK_EQ(failureSleepSeconds(1, RETRY_MAX, RETRY_SLEEP_S, GIVE_UP_SLEEP_S), 1800);
  CHECK_EQ(failureSleepSeconds(2, RETRY_MAX, RETRY_SLEEP_S, GIVE_UP_SLEEP_S), 1800);
  CHECK_EQ(failureSleepSeconds(3, RETRY_MAX, RETRY_SLEEP_S, GIVE_UP_SLEEP_S), 1800);
  CHECK_EQ(failureSleepSeconds(4, RETRY_MAX, RETRY_SLEEP_S, GIVE_UP_SLEEP_S), 86400);

  // Clock drift. Meant to sleep a day, slept 1 % longer: ask for about 1 % less next time.
  CHECK_EQ(measureDriftPpm(86400, 87264), 10000);
  CHECK_EQ(applyDrift(86400, 10000), 85544);
  CHECK_EQ(measureDriftPpm(86400, 85536), -10000);
  CHECK_EQ(applyDrift(86400, -10000), 87272);
  CHECK_EQ(measureDriftPpm(86400, 86400), 0);
  CHECK_EQ(applyDrift(86400, 0), 86400);
  // After correcting, the real sleep comes out right: asked 85544 on a clock 1 % slow = 86399 s.
  CHECK_EQ(85544LL * 1010000 / 1000000, 86399);
  // Not a measurement: too short a sleep, a nonsense result, more than 10 % off.
  CHECK_EQ(measureDriftPpm(1800, 1900), DRIFT_UNKNOWN);
  CHECK_EQ(measureDriftPpm(86400, 0), DRIFT_UNKNOWN);
  CHECK_EQ(measureDriftPpm(86400, -50), DRIFT_UNKNOWN);
  CHECK_EQ(measureDriftPpm(86400, 2 * 86400), DRIFT_UNKNOWN);
  CHECK_EQ(measureDriftPpm(86400, 43200), DRIFT_UNKNOWN);
  CHECK_EQ(applyDrift(86400, DRIFT_UNKNOWN), 86400);
  CHECK_EQ(applyDrift(86400, 900000), 86400);
}

static void testStatusJson() {
  // The sample in docs/software/CONTRACT.md, as written there.
  const char* sample =
      "{\n"
      "  \"v\": 1,\n"
      "  \"date\": \"2026-11-12\",\n"
      "  \"state\": \"market\",\n"
      "  \"hash\": \"9f2c4a7d1b3e5f60\",\n"
      "  \"bytes\": 192000,\n"
      "  \"generatedAt\": 1794493864,\n"
      "  \"nextWake\": 1794841200\n"
      "}\n";
  Status st;
  CHECK(parseStatus(sample, &st));
  CHECK_EQ(st.generatedAt, 1794493864);
  CHECK_EQ(st.nextWake, 1794841200);
  CHECK(std::strcmp(st.hash, "9f2c4a7d1b3e5f60") == 0);

  // Packed tight, keys in another order, an unknown key, a nested object that reuses our key names.
  const char* tight =
      "{\"nextWake\":1794841200,\"extra\":{\"hash\":\"zz\",\"v\":7,\"bytes\":[1,2]},\"hash\":\"9F2C4A7D1B3E5F60\","
      "\"generatedAt\":1794493864,\"bytes\":192000,\"v\":1}";
  CHECK(parseStatus(tight, &st));
  CHECK(std::strcmp(st.hash, "9f2c4a7d1b3e5f60") == 0);   // upper case is folded to lower
  CHECK_EQ(st.nextWake, 1794841200);

  // A key's name inside a string value is not a key.
  const char* tricky = "{\"state\":\"\\\"hash\\\": \\\"0000000000000000\\\"\",\"v\":1,\"bytes\":192000,"
                       "\"generatedAt\":5,\"nextWake\":6,\"hash\":\"0123456789abcdef\"}";
  CHECK(parseStatus(tricky, &st));
  CHECK(std::strcmp(st.hash, "0123456789abcdef") == 0);

  // Refused: each thing the contract fixes, when it is wrong or missing.
  auto with = [](const char* v, const char* bytes, const char* hash, const char* gen, const char* next) {
    return std::string("{\"v\":") + v + ",\"bytes\":" + bytes + ",\"hash\":" + hash + ",\"generatedAt\":" + gen +
           ",\"nextWake\":" + next + "}";
  };
  const char* H = "\"9f2c4a7d1b3e5f60\"";
  CHECK(parseStatus(with("1", "192000", H, "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("2", "192000", H, "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "191999", H, "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", "\"9f2c4a7d1b3e5f6\"", "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", "\"9f2c4a7d1b3e5f601\"", "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", "\"9f2c4a7d1b3e5fzz\"", "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", "12345", "1794493864", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", H, "0", "1794841200").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", H, "1794493864", "null").c_str(), &st));
  CHECK(!parseStatus(with("1", "192000", H, "\"1794493864\"", "1794841200").c_str(), &st));
  CHECK(!parseStatus("{\"v\":1,\"bytes\":192000,\"hash\":\"9f2c4a7d1b3e5f60\",\"generatedAt\":1794493864}", &st));
  CHECK(!parseStatus("", &st));
  CHECK(!parseStatus("<html>404</html>", &st));
  CHECK(!parseStatus("{\"v\":1,\"hash\":\"9f2c4a7d", &st));   // cut off mid-string
  CHECK(!parseStatus(nullptr, &st));

  int64_t n = 0;
  CHECK(jsonGetInt("{\"a\": -42 }", "a", &n) && n == -42);
  CHECK(jsonGetInt("{\"a\":17.9}", "a", &n) && n == 17);
  CHECK(!jsonGetInt("{\"a\":1e9}", "a", &n));
  CHECK(!jsonGetInt("{\"a\":true}", "a", &n));
  CHECK(!jsonGetInt("{\"ab\":1}", "a", &n));
  char small[4];
  CHECK(jsonGetString("{\"s\":\"abc\"}", "s", small, sizeof(small)) && std::strcmp(small, "abc") == 0);
  CHECK(!jsonGetString("{\"s\":\"abcd\"}", "s", small, sizeof(small)));   // does not fit

  // The hash as the contract defines it: the first 16 hex characters of the SHA-256.
  const uint8_t digest[32] = {0x9f, 0x2c, 0x4a, 0x7d, 0x1b, 0x3e, 0x5f, 0x60, 0xff, 0xff};
  char hex[HASH_CHARS + 1];
  hashPrefixHex(digest, hex);
  CHECK(std::strcmp(hex, "9f2c4a7d1b3e5f60") == 0);
}

// A made-up picture with a different value in every byte position that matters.
static std::vector<uint8_t> testFrame() {
  std::vector<uint8_t> frame(FRAME_BYTES);
  uint32_t x = 12345;
  for (size_t i = 0; i < frame.size(); ++i) {
    x = x * 1664525u + 1013904223u;
    frame[i] = (uint8_t)(x >> 24);
  }
  return frame;
}

static void testFlip() {
  CHECK_EQ(FRAME_BYTES, 192000);
  CHECK_EQ(ROW_BYTES, 400);

  uint8_t three[3] = {0x12, 0x34, 0x56};
  flip180(three, 3);
  CHECK(three[0] == 0x65 && three[1] == 0x43 && three[2] == 0x21);
  uint8_t two[2] = {0xAB, 0xCD};
  flip180(two, 2);
  CHECK(two[0] == 0xDC && two[1] == 0xBA);
  flip180(two, 0);
  CHECK(two[0] == 0xDC);

  // The real thing: a whole picture turned round pixel by pixel ...
  const std::vector<uint8_t> frame = testFrame();
  std::vector<uint8_t> want(FRAME_BYTES);
  for (int y = 0; y < FRAME_H; ++y) {
    for (int x = 0; x < FRAME_W; ++x) {
      setPixel(&want[(size_t)(FRAME_H - 1 - y) * ROW_BYTES], FRAME_W - 1 - x,
               getPixel(&frame[(size_t)y * ROW_BYTES], x));
    }
  }
  // ... must equal what the truck sends with ROTATE_180: 16,000-byte pieces, last piece first, each flipped.
  std::vector<uint8_t> sent;
  const size_t piece = 16000;
  CHECK_EQ(FRAME_BYTES % piece, 0);
  for (size_t end = FRAME_BYTES; end > 0; end -= piece) {
    std::vector<uint8_t> buf(frame.begin() + (long)(end - piece), frame.begin() + (long)end);
    flip180(buf.data(), buf.size());
    sent.insert(sent.end(), buf.begin(), buf.end());
  }
  CHECK(sent == want);
}

static void testBatteryMark() {
  CHECK(classifyBattery(4150, 2500, 3700, 3950) == BatteryLevel::Full);
  CHECK(classifyBattery(3950, 2500, 3700, 3950) == BatteryLevel::Full);
  CHECK(classifyBattery(3949, 2500, 3700, 3950) == BatteryLevel::Half);
  CHECK(classifyBattery(3700, 2500, 3700, 3950) == BatteryLevel::Half);
  CHECK(classifyBattery(3699, 2500, 3700, 3950) == BatteryLevel::Low);
  CHECK(classifyBattery(2500, 2500, 3700, 3950) == BatteryLevel::Low);
  CHECK(classifyBattery(2499, 2500, 3700, 3950) == BatteryLevel::Unknown);   // no such battery: no reading
  CHECK(classifyBattery(0, 2500, 3700, 3950) == BatteryLevel::Unknown);

  // The contract's rectangle.
  CHECK_EQ(MARK_X, 744);
  CHECK_EQ(MARK_Y, 452);
  CHECK_EQ(MARK_X + MARK_W, 784);
  CHECK_EQ(MARK_Y + MARK_H, 472);

  const std::vector<uint8_t> frame = testFrame();
  const BatteryLevel levels[] = {BatteryLevel::Low, BatteryLevel::Half, BatteryLevel::Full};
  for (BatteryLevel level : levels) {
    // Stamped in one go.
    std::vector<uint8_t> whole = frame;
    stampBatteryMark(whole.data(), 0, whole.size(), level);
    int changedOutside = 0, wrongInside = 0, white = 0, red = 0;
    for (int y = 0; y < FRAME_H; ++y) {
      for (int x = 0; x < FRAME_W; ++x) {
        const uint8_t got = getPixel(&whole[(size_t)y * ROW_BYTES], x);
        const bool inside = x >= MARK_X && x < MARK_X + MARK_W && y >= MARK_Y && y < MARK_Y + MARK_H;
        if (inside) {
          if (got != batteryMarkPixel(x - MARK_X, y - MARK_Y, level)) ++wrongInside;
          if (got == WHITE) ++white;
          if (got == RED) ++red;
          if (got != WHITE && got != RED && got != BLACK) ++wrongInside;
        } else if (got != getPixel(&frame[(size_t)y * ROW_BYTES], x)) {
          ++changedOutside;
        }
      }
    }
    CHECK_EQ(changedOutside, 0);
    CHECK_EQ(wrongInside, 0);
    CHECK(white > 100);
    CHECK_EQ(red > 0, level == BatteryLevel::Low);

    // Stamped as the download delivers it, in chunks of awkward sizes: the same picture comes out.
    const size_t sizes[] = {4096, 1460, 1, 7, 400, 16000, 191999};
    for (size_t size : sizes) {
      std::vector<uint8_t> chunked = frame;
      for (size_t off = 0; off < chunked.size(); off += size) {
        const size_t n = (chunked.size() - off < size) ? chunked.size() - off : size;
        stampBatteryMark(chunked.data() + off, off, n, level);
      }
      CHECK(chunked == whole);
    }
  }

  // The outline is the same at every level; only the bar inside differs.
  CHECK_EQ(batteryMarkPixel(2, 3, BatteryLevel::Low), WHITE);
  CHECK_EQ(batteryMarkPixel(33, 16, BatteryLevel::Full), WHITE);
  CHECK_EQ(batteryMarkPixel(0, 0, BatteryLevel::Full), BLACK);
  CHECK_EQ(batteryMarkPixel(39, 19, BatteryLevel::Full), BLACK);
  CHECK_EQ(batteryMarkPixel(6, 9, BatteryLevel::Low), RED);
  CHECK_EQ(batteryMarkPixel(12, 9, BatteryLevel::Low), BLACK);
  CHECK_EQ(batteryMarkPixel(12, 9, BatteryLevel::Half), WHITE);
  CHECK_EQ(batteryMarkPixel(20, 9, BatteryLevel::Half), BLACK);
  CHECK_EQ(batteryMarkPixel(29, 9, BatteryLevel::Full), WHITE);

  // No reading: nothing is touched.
  std::vector<uint8_t> untouched = frame;
  stampBatteryMark(untouched.data(), 0, untouched.size(), BatteryLevel::Unknown);
  CHECK(untouched == frame);
}

static void testChargeCard() {
  // Every character of both lines is in the font (a missing one would be drawn as a solid block).
  static const uint8_t block[7] = {0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F};
  for (const CardLine& line : CHARGE_CARD_LINES) {
    for (const char* p = line.text; *p; ++p) CHECK(std::memcmp(cardGlyph(*p), block, 7) != 0);
    CHECK(cardLineWidth(line) <= FRAME_W - 40);        // fits, with a margin
    CHECK(line.top >= 20 && line.top + 7 * line.scale <= FRAME_H - 20);
  }
  CHECK(std::memcmp(cardGlyph('?'), block, 7) == 0);
  CHECK(std::strcmp(CHARGE_CARD_LINES[0].text, "CHARGE ME") == 0);
  CHECK(std::strcmp(CHARGE_CARD_LINES[1].text, "Plug in the USB-C lead at the back") == 0);

  // The whole card: red and white only, white only inside the two lines' bands, margins left clear.
  long white = 0, other = 0, whiteOutsideBands = 0, whiteInMargin = 0;
  uint8_t row[ROW_BYTES];
  for (int y = 0; y < FRAME_H; ++y) {
    chargeCardRow(y, row);
    bool inBand = false;
    for (const CardLine& line : CHARGE_CARD_LINES) {
      if (y >= line.top && y < line.top + 7 * line.scale) inBand = true;
    }
    for (int x = 0; x < FRAME_W; ++x) {
      const uint8_t c = getPixel(row, x);
      if (c == WHITE) {
        ++white;
        if (!inBand) ++whiteOutsideBands;
        if (x < 20 || x >= FRAME_W - 20) ++whiteInMargin;
      } else if (c != RED) {
        ++other;
      }
    }
  }
  CHECK_EQ(other, 0);
  CHECK_EQ(whiteOutsideBands, 0);
  CHECK_EQ(whiteInMargin, 0);
  CHECK(white > 20000);
  CHECK(white < (long)FRAME_W * FRAME_H / 4);
}

// ---- pictures to look at --------------------------------------------------------------------------------

static void colourToRgb(uint8_t code, uint8_t rgb[3]) {
  // The page's CSS colours, from the contract's table.
  static const uint8_t table[7][3] = {
      {0x00, 0x00, 0x00}, {0xFF, 0xFF, 0xFF}, {0xF5, 0xD0, 0x00}, {0xD0, 0x02, 0x1B},
      {0xFF, 0x00, 0xFF}, {0x1F, 0x4F, 0xD8}, {0x1E, 0x8E, 0x3E},
  };
  std::memcpy(rgb, table[code <= 6 ? code : 4], 3);
}

static bool writeBmp(const char* path, int w, int h, const std::vector<uint8_t>& codes) {
  FILE* f = std::fopen(path, "wb");
  if (!f) return false;
  const int rowBytes = (w * 3 + 3) & ~3;
  const uint32_t size = 54 + (uint32_t)rowBytes * (uint32_t)h;
  uint8_t header[54] = {'B', 'M'};
  auto put32 = [&](int at, uint32_t v) {
    for (int i = 0; i < 4; ++i) header[at + i] = (uint8_t)(v >> (8 * i));
  };
  put32(2, size);
  put32(10, 54);
  put32(14, 40);
  put32(18, (uint32_t)w);
  put32(22, (uint32_t)h);
  header[26] = 1;
  header[28] = 24;
  put32(34, (uint32_t)rowBytes * (uint32_t)h);
  std::fwrite(header, 1, 54, f);
  std::vector<uint8_t> line((size_t)rowBytes);
  for (int y = h - 1; y >= 0; --y) {   // a BMP is stored bottom row first
    for (int x = 0; x < w; ++x) {
      uint8_t rgb[3];
      colourToRgb(codes[(size_t)y * (size_t)w + (size_t)x], rgb);
      line[(size_t)x * 3] = rgb[2];
      line[(size_t)x * 3 + 1] = rgb[1];
      line[(size_t)x * 3 + 2] = rgb[0];
    }
    std::fwrite(line.data(), 1, line.size(), f);
  }
  std::fclose(f);
  return true;
}

static bool drawCard(const char* path) {
  std::vector<uint8_t> codes((size_t)FRAME_W * FRAME_H);
  uint8_t row[ROW_BYTES];
  for (int y = 0; y < FRAME_H; ++y) {
    chargeCardRow(y, row);
    for (int x = 0; x < FRAME_W; ++x) codes[(size_t)y * FRAME_W + (size_t)x] = getPixel(row, x);
  }
  return writeBmp(path, FRAME_W, FRAME_H, codes);
}

static bool drawMarks(const char* path) {
  const int zoom = 8, gap = 4;
  const int w = (MARK_W + gap) * 3 * zoom, h = (MARK_H + 2 * gap) * zoom;
  std::vector<uint8_t> codes((size_t)w * (size_t)h, BLUE);   // blue surround, to show the mark's own black
  const BatteryLevel levels[] = {BatteryLevel::Low, BatteryLevel::Half, BatteryLevel::Full};
  for (int i = 0; i < 3; ++i) {
    for (int y = 0; y < MARK_H * zoom; ++y) {
      for (int x = 0; x < MARK_W * zoom; ++x) {
        const int px = (i * (MARK_W + gap) + gap / 2) * zoom + x;
        const int py = gap * zoom + y;
        codes[(size_t)py * (size_t)w + (size_t)px] = batteryMarkPixel(x / zoom, y / zoom, levels[i]);
      }
    }
  }
  return writeBmp(path, w, h, codes);
}

int main(int argc, char** argv) {
  if (argc == 3 && std::strcmp(argv[1], "--card") == 0) return drawCard(argv[2]) ? 0 : 1;
  if (argc == 3 && std::strcmp(argv[1], "--mark") == 0) return drawMarks(argv[2]) ? 0 : 1;

  testHttpDate();
  testSleepLengths();
  testStatusJson();
  testFlip();
  testBatteryMark();
  testChargeCard();

  if (failures) {
    std::printf("%d of %d checks FAILED\n", failures, checks);
    return 1;
  }
  std::printf("all %d checks passed\n", checks);
  return 0;
}
