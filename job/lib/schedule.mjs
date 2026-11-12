// When the truck wakes next: the `nextWake` of status.json.
// The rules are in docs/software/CONTRACT.md, "When the truck wakes: nextWake".

const ZONE = "America/Los_Angeles";
const WAKE_HOUR = 7; // 7:00 AM Pacific
const DAY_SECONDS = 86400;
const MAX_AHEAD_SECONDS = 14 * DAY_SECONDS; // nextWake is never further away than this
const LOOK_AGAIN_DAYS = 7; // nothing published within 14 days: wake in 7 days and look again
const HOLIDAY_GAP_DAYS = 3; // a gap of more than this gets a "back on ..." card the morning after

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// The Pacific wall clock at an instant, as numbers.
function pacificParts(date) {
  const parts = {};
  for (const { type, value } of partsFormat.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return parts;
}

/** The date in America/Los_Angeles at `now`, as "YYYY-MM-DD". */
export function pacificDate(now) {
  const p = pacificParts(now);
  const pad = (n, width) => String(n).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

// "YYYY-MM-DD" plus a number of calendar days.
function addDays(day, count) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
}

// Calendar days from one "YYYY-MM-DD" to another.
function daysBetween(from, to) {
  const ms = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / (DAY_SECONDS * 1000));
}

// Unix seconds of 7:00 AM Pacific on a "YYYY-MM-DD" day. The zone's offset is read from Intl at the instant
// itself, so it is right on both sides of a daylight-saving change (7:00 AM is never inside the change).
function wakeTime(day) {
  const [y, m, d] = day.split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d, WAKE_HOUR); // the wall clock we want, written as if it were UTC
  let instant = wanted;
  // Two rounds: the first guess can sit on the other side of a clock change from the answer.
  for (let round = 0; round < 2; round++) {
    const p = pacificParts(new Date(instant));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += wanted - shown;
  }
  return Math.round(instant / 1000);
}

/**
 * When the truck should wake next, in Unix seconds.
 *
 * @param {{ now: Date, marketDates: string[] }} input  `marketDates` are "YYYY-MM-DD" days in
 *   America/Los_Angeles that have a market; today may be among them. Days before today are ignored.
 * @returns {number} an integer, always after `now` and at most 14 days after it
 *
 * In order:
 * 1. Today has a market and it is before 7:00 AM Pacific: today at 7:00 AM.
 * 2. Today had a market and the next one is more than 3 days away, or nothing more is published: tomorrow at
 *    7:00 AM, when the picture changes to the "back on ..." card. (Thursday to Monday is 4 days, so Thursday's
 *    answer after 7:00 AM is Friday morning.)
 * 3. Otherwise the next market day at 7:00 AM, when that is no more than 14 days after `now`.
 * 4. Otherwise (nothing published, or nothing near enough): 7:00 AM seven days from today, to look again.
 */
export function nextWake({ now, marketDates }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("nextWake: now must be a valid Date");
  }
  const nowSeconds = now.getTime() / 1000;
  const today = pacificDate(now);
  const days = (marketDates ?? []).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  const marketToday = days.includes(today);
  // The earliest market day after today. "YYYY-MM-DD" strings sort in date order.
  const next = days.reduce((best, day) => (day > today && (best === null || day < best) ? day : best), null);

  if (marketToday) {
    const todayWake = wakeTime(today);
    if (todayWake > nowSeconds) return todayWake;
    if (next === null || daysBetween(today, next) > HOLIDAY_GAP_DAYS) return wakeTime(addDays(today, 1));
  }
  if (next !== null) {
    const nextMarketWake = wakeTime(next);
    if (nextMarketWake - nowSeconds <= MAX_AHEAD_SECONDS) return nextMarketWake;
  }
  return wakeTime(addDays(today, LOOK_AGAIN_DAYS));
}

/**
 * The `nextWake` the morning job writes into status.json, in Unix seconds: the first wake strictly after this
 * morning's 7:00 AM Pacific.
 *
 * The job runs at about 6:30 AM and the truck reads its file at 7:00 AM. `nextWake` itself would answer "today
 * at 7:00 AM" on a market morning, which the truck would read as "now" and sleep its 10 minute minimum, over and
 * over, all day. So the job asks from one second past 7:00 AM instead (or from `now`, when the job runs later
 * than that), and the truck is sent on to the wake after the one it is having.
 *
 * @param {{ now: Date, marketDates: string[] }} input  as for `nextWake`
 * @returns {number} an integer, after `now` and after today's 7:00 AM Pacific, and at most 14 days after that
 */
export function publishedWake({ now, marketDates }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("publishedWake: now must be a valid Date");
  }
  const justAfterWake = (wakeTime(pacificDate(now)) + 1) * 1000;
  return nextWake({ now: new Date(Math.max(now.getTime(), justAfterWake)), marketDates });
}
