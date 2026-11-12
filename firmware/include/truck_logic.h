// The truck's arithmetic, with no hardware in it: time, sleep lengths, status.json, and the bytes of a picture.
//
// Everything here is a pure function of its arguments, so it compiles on a Mac too and is tested there
// (firmware/test/run.sh). The formats are those of docs/software/CONTRACT.md.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace truck {

// ---------------------------------------------------------------------------------------------------------
// The picture: 800 x 480, 4 bits per pixel, two pixels per byte, the left pixel in the high nibble.
// ---------------------------------------------------------------------------------------------------------
constexpr int FRAME_W = 800;
constexpr int FRAME_H = 480;
constexpr size_t ROW_BYTES = FRAME_W / 2;             // 400
constexpr size_t FRAME_BYTES = ROW_BYTES * FRAME_H;   // 192,000

// The screen's own colour codes. Confirmed against Waveshare's EPD_7in3e.h (see epd7in3e.h for the address).
enum Colour : uint8_t {
  BLACK = 0x0,
  WHITE = 0x1,
  YELLOW = 0x2,
  RED = 0x3,
  // 0x4 is not used by this panel (Waveshare's header has it commented out as "ORANGE")
  BLUE = 0x5,
  GREEN = 0x6,
};

inline void setPixel(uint8_t* row, int x, uint8_t colour) {
  uint8_t& b = row[x >> 1];
  if (x & 1) {
    b = (uint8_t)((b & 0xF0) | (colour & 0x0F));
  } else {
    b = (uint8_t)((b & 0x0F) | ((colour & 0x0F) << 4));
  }
}

inline uint8_t getPixel(const uint8_t* row, int x) {
  const uint8_t b = row[x >> 1];
  return (x & 1) ? (uint8_t)(b & 0x0F) : (uint8_t)(b >> 4);
}

// Turns a run of picture bytes round by 180 degrees in place: the byte order is reversed and the two pixels
// inside each byte change places. Rotating the whole picture is this, applied to the whole file; applied to
// pieces, the pieces must also be sent last one first.
inline void flip180(uint8_t* buf, size_t len) {
  if (len == 0) return;
  size_t i = 0;
  size_t j = len - 1;
  while (i < j) {
    const uint8_t a = buf[i];
    const uint8_t b = buf[j];
    buf[i] = (uint8_t)((b << 4) | (b >> 4));
    buf[j] = (uint8_t)((a << 4) | (a >> 4));
    ++i;
    --j;
  }
  if (i == j) buf[i] = (uint8_t)((buf[i] << 4) | (buf[i] >> 4));
}

// ---------------------------------------------------------------------------------------------------------
// Time: the HTTP Date header (RFC 7231, IMF-fixdate) to Unix seconds, with no clock and no time zone.
// ---------------------------------------------------------------------------------------------------------

// Days from 1970-01-01 to the given date in the Gregorian calendar (Howard Hinnant's days_from_civil).
inline int64_t daysFromCivil(int y, int m, int d) {
  y -= (m <= 2) ? 1 : 0;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const int64_t yoe = y - era * 400;                                    // [0, 399]
  const int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;   // [0, 365]
  const int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;            // [0, 146096]
  return era * 146097 + doe - 719468;
}

inline bool isLeapYear(int y) { return (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0); }

inline int daysInMonth(int y, int m) {
  static const uint8_t days[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (m == 2 && isLeapYear(y)) return 29;
  return days[m - 1];
}

namespace detail {

inline bool isDigit(char c) { return c >= '0' && c <= '9'; }
inline char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c; }

// Reads exactly `digits` decimal digits.
inline bool readFixedInt(const char*& p, int digits, int* out) {
  int v = 0;
  for (int i = 0; i < digits; ++i) {
    if (!isDigit(p[i])) return false;
    v = v * 10 + (p[i] - '0');
  }
  p += digits;
  *out = v;
  return true;
}

inline bool expect(const char*& p, char c) {
  if (*p != c) return false;
  ++p;
  return true;
}

}  // namespace detail

// "Thu, 12 Nov 2026 15:00:04 GMT" -> 1794495604. False if the text is not a well-formed IMF-fixdate.
// The day name is not checked against the date (a server that gets it wrong still tells the time).
inline bool parseHttpDate(const char* s, int64_t* out) {
  using namespace detail;
  if (!s || !out) return false;
  const char* p = s;
  while (*p == ' ' || *p == '\t') ++p;

  // Day name and comma: "Thu, "
  for (int i = 0; i < 3; ++i) {
    const char c = lower(p[i]);
    if (c < 'a' || c > 'z') return false;
  }
  p += 3;
  if (!expect(p, ',') || !expect(p, ' ')) return false;

  int day = 0, year = 0, hour = 0, minute = 0, second = 0;
  if (!readFixedInt(p, 2, &day) || !expect(p, ' ')) return false;

  static const char months[] = "janfebmaraprmayjunjulaugsepoctnovdec";
  int month = 0;
  for (int m = 0; m < 12; ++m) {
    if (lower(p[0]) == months[m * 3] && lower(p[1]) == months[m * 3 + 1] && lower(p[2]) == months[m * 3 + 2]) {
      month = m + 1;
      break;
    }
  }
  if (month == 0) return false;
  p += 3;
  if (!expect(p, ' ')) return false;

  if (!readFixedInt(p, 4, &year) || !expect(p, ' ')) return false;
  if (!readFixedInt(p, 2, &hour) || !expect(p, ':')) return false;
  if (!readFixedInt(p, 2, &minute) || !expect(p, ':')) return false;
  if (!readFixedInt(p, 2, &second) || !expect(p, ' ')) return false;
  if (!(p[0] == 'G' && p[1] == 'M' && p[2] == 'T')) return false;
  p += 3;
  while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') ++p;
  if (*p != '\0') return false;

  if (year < 1970 || day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 60) return false;   // 60: a leap second, as the RFC allows

  *out = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Sleep lengths
// ---------------------------------------------------------------------------------------------------------

inline uint32_t clampSeconds(int64_t s, uint32_t minS, uint32_t maxS) {
  if (s < (int64_t)minS) return minS;
  if (s > (int64_t)maxS) return maxS;
  return (uint32_t)s;
}

// "The truck sleeps for nextWake - now seconds, clamped to between 10 minutes and 4 days."
inline uint32_t sleepSecondsUntil(int64_t nextWake, int64_t now, uint32_t minS, uint32_t maxS) {
  return clampSeconds(nextWake - now, minS, maxS);
}

// "If now - generatedAt is more than 20 hours, the morning job has not run yet today."
inline bool isStale(int64_t now, int64_t generatedAt, int64_t staleAfterS) {
  return now - generatedAt > staleAfterS;
}

// How long to sleep after a failure. `failures` counts this one too: 1 for the first failure in a row.
// The first `maxRetries` failures each earn a short sleep and another try; the one after that, a long sleep.
inline uint32_t failureSleepSeconds(unsigned failures, unsigned maxRetries, uint32_t retryS, uint32_t giveUpS) {
  return (failures <= maxRetries) ? retryS : giveUpS;
}

// The board's sleep clock is a cheap oscillator that runs a little fast or slow. Each time the truck learns
// the real time it compares how long it meant to sleep with how long it did.
constexpr int32_t DRIFT_UNKNOWN = INT32_MIN;
constexpr int32_t DRIFT_MAX_PPM = 100000;        // 10 %: anything beyond is not drift, it is a mistake
constexpr int64_t DRIFT_MIN_PLANNED_S = 3600;    // a sleep shorter than an hour measures nothing useful

// Parts per million by which the sleep overran (+) or fell short (-), or DRIFT_UNKNOWN.
inline int32_t measureDriftPpm(int64_t plannedS, int64_t actualS) {
  if (plannedS < DRIFT_MIN_PLANNED_S || actualS <= 0) return DRIFT_UNKNOWN;
  const int64_t ppm = (actualS - plannedS) * 1000000 / plannedS;
  if (ppm > DRIFT_MAX_PPM || ppm < -DRIFT_MAX_PPM) return DRIFT_UNKNOWN;
  return (int32_t)ppm;
}

// The number of seconds to ask the sleep clock for, so that `seconds` really pass.
inline int64_t applyDrift(int64_t seconds, int32_t driftPpm) {
  if (driftPpm == DRIFT_UNKNOWN || driftPpm > DRIFT_MAX_PPM || driftPpm < -DRIFT_MAX_PPM) return seconds;
  return seconds * 1000000 / (1000000 + (int64_t)driftPpm);
}

// ---------------------------------------------------------------------------------------------------------
// status.json: a small, flat JSON object. This reads top-level keys only; it is not a general JSON parser.
// ---------------------------------------------------------------------------------------------------------

// A pointer to the first character of the value of top-level `key`, or nullptr.
inline const char* jsonFindValue(const char* json, const char* key) {
  if (!json || !key) return nullptr;
  const size_t keyLen = strlen(key);
  int depth = 0;
  const char* p = json;
  while (*p) {
    const char c = *p;
    if (c == '"') {
      const char* start = p + 1;
      const char* q = start;
      while (*q && *q != '"') {
        if (*q == '\\' && q[1]) ++q;
        ++q;
      }
      if (!*q) return nullptr;   // a string that never ends
      const char* after = q + 1;
      while (*after == ' ' || *after == '\t' || *after == '\r' || *after == '\n') ++after;
      if (depth == 1 && *after == ':') {
        // This string is a key of the top-level object.
        ++after;
        while (*after == ' ' || *after == '\t' || *after == '\r' || *after == '\n') ++after;
        if ((size_t)(q - start) == keyLen && memcmp(start, key, keyLen) == 0) return after;
      }
      p = q + 1;
      continue;
    }
    if (c == '{' || c == '[') ++depth;
    if (c == '}' || c == ']') --depth;
    ++p;
  }
  return nullptr;
}

// A whole number (a fraction, if any, is dropped). False if the key is missing or is not a number.
inline bool jsonGetInt(const char* json, const char* key, int64_t* out) {
  const char* p = jsonFindValue(json, key);
  if (!p) return false;
  bool negative = false;
  if (*p == '-') {
    negative = true;
    ++p;
  }
  if (!detail::isDigit(*p)) return false;
  int64_t v = 0;
  int digits = 0;
  while (detail::isDigit(*p)) {
    if (++digits > 18) return false;
    v = v * 10 + (*p - '0');
    ++p;
  }
  if (*p == 'e' || *p == 'E') return false;
  *out = negative ? -v : v;
  return true;
}

// A plain string with no escapes. False if missing, not a string, escaped, or too long for `out`.
inline bool jsonGetString(const char* json, const char* key, char* out, size_t outSize) {
  const char* p = jsonFindValue(json, key);
  if (!p || *p != '"' || outSize == 0) return false;
  ++p;
  size_t n = 0;
  while (*p && *p != '"') {
    if (*p == '\\') return false;
    if (n + 1 >= outSize) return false;
    out[n++] = *p++;
  }
  if (*p != '"') return false;
  out[n] = '\0';
  return true;
}

constexpr size_t HASH_CHARS = 16;

struct Status {
  int64_t generatedAt = 0;   // Unix seconds
  int64_t nextWake = 0;      // Unix seconds
  char hash[HASH_CHARS + 1] = {0};   // 16 lowercase hex characters
};

// Reads and checks status.json: v is 1, bytes is 192,000, hash is 16 hex characters, both times are set.
inline bool parseStatus(const char* json, Status* out) {
  if (!json || !out) return false;
  int64_t v = 0, bytes = 0, generatedAt = 0, nextWake = 0;
  char hash[HASH_CHARS + 1];
  if (!jsonGetInt(json, "v", &v) || v != 1) return false;
  if (!jsonGetInt(json, "bytes", &bytes) || bytes != (int64_t)FRAME_BYTES) return false;
  if (!jsonGetInt(json, "generatedAt", &generatedAt) || generatedAt <= 0) return false;
  if (!jsonGetInt(json, "nextWake", &nextWake) || nextWake <= 0) return false;
  if (!jsonGetString(json, "hash", hash, sizeof(hash)) || strlen(hash) != HASH_CHARS) return false;
  for (size_t i = 0; i < HASH_CHARS; ++i) {
    const char c = detail::lower(hash[i]);
    if (!(detail::isDigit(c) || (c >= 'a' && c <= 'f'))) return false;
    hash[i] = c;
  }
  out->generatedAt = generatedAt;
  out->nextWake = nextWake;
  memcpy(out->hash, hash, sizeof(hash));
  return true;
}

// The first 8 bytes of a SHA-256 digest as 16 lowercase hex characters: the contract's `hash`.
inline void hashPrefixHex(const uint8_t* digest, char out[HASH_CHARS + 1]) {
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < HASH_CHARS / 2; ++i) {
    out[i * 2] = hex[digest[i] >> 4];
    out[i * 2 + 1] = hex[digest[i] & 0x0F];
  }
  out[HASH_CHARS] = '\0';
}

// ---------------------------------------------------------------------------------------------------------
// The battery mark: the one thing the truck draws on the morning picture. The page leaves a solid black
// rectangle at x 744 to 784, y 452 to 472 (40 x 20 pixels) and the mark is stamped into it as those rows
// pass through on their way to the screen.
// ---------------------------------------------------------------------------------------------------------
constexpr int MARK_X = 744;
constexpr int MARK_Y = 452;
constexpr int MARK_W = 40;
constexpr int MARK_H = 20;

enum class BatteryLevel : uint8_t {
  Unknown,   // no reading: stamp nothing
  Low,
  Half,
  Full,
};

inline BatteryLevel classifyBattery(int mv, int plausibleMinMv, int halfMv, int fullMv) {
  if (mv < plausibleMinMv) return BatteryLevel::Unknown;
  if (mv >= fullMv) return BatteryLevel::Full;
  if (mv >= halfMv) return BatteryLevel::Half;
  return BatteryLevel::Low;
}

// The colour of one pixel of the mark; (0, 0) is its top-left corner.
//
//   a white outline 32 x 14 with a stub on the right, and inside it a bar:
//   full = the whole bar white, half = the left half white, low = a short red bar.
inline uint8_t batteryMarkPixel(int x, int y, BatteryLevel level) {
  // The body: x 2..33, y 3..16, walls 2 pixels thick.
  const bool inBody = x >= 2 && x <= 33 && y >= 3 && y <= 16;
  const bool inHollow = x >= 4 && x <= 31 && y >= 5 && y <= 14;
  if (inBody && !inHollow) return WHITE;
  // The stub: x 34..36, y 7..12.
  if (x >= 34 && x <= 36 && y >= 7 && y <= 12) return WHITE;
  // The bar: x 6..29 (24 pixels), y 7..12, one pixel clear of the walls all round.
  if (x >= 6 && x <= 29 && y >= 7 && y <= 12) {
    const int col = x - 6;
    switch (level) {
      case BatteryLevel::Full: return WHITE;
      case BatteryLevel::Half: return col < 12 ? WHITE : BLACK;
      case BatteryLevel::Low:  return col < 5 ? RED : BLACK;
      default:                 return BLACK;
    }
  }
  return BLACK;
}

// Overwrites the bytes of the mark that fall inside `chunk`, a run of the picture's bytes that starts
// `frameOffset` bytes into the picture (in the picture's own upright order). Chunks may start and end anywhere.
inline void stampBatteryMark(uint8_t* chunk, size_t frameOffset, size_t len, BatteryLevel level) {
  if (level == BatteryLevel::Unknown || len == 0) return;
  const size_t chunkEnd = frameOffset + len;
  for (int row = 0; row < MARK_H; ++row) {
    const size_t rowStart = (size_t)(MARK_Y + row) * ROW_BYTES + MARK_X / 2;
    const size_t rowEnd = rowStart + MARK_W / 2;
    if (rowEnd <= frameOffset) continue;
    if (rowStart >= chunkEnd) break;
    const size_t from = rowStart > frameOffset ? rowStart : frameOffset;
    const size_t to = rowEnd < chunkEnd ? rowEnd : chunkEnd;
    for (size_t b = from; b < to; ++b) {
      const int x = (int)(b - rowStart) * 2;
      chunk[b - frameOffset] =
          (uint8_t)((batteryMarkPixel(x, row, level) << 4) | batteryMarkPixel(x + 1, row, level));
    }
  }
}

}  // namespace truck
