// Truck data: reads Off the Grid's public feed and turns it into today.json (without pageUrl) and the list of
// market dates. The shapes are fixed by docs/software/CONTRACT.md; the feed is described in docs/plan/SPEC.md 2a.
// Every date and time here is America/Los_Angeles, worked out with Intl from the `now` that is passed in.

export const LEVIS_PLAZA = "0016e00002o8dIXAAY";

const TIME_ZONE = "America/Los_Angeles";
const FEED_URL = "https://sf-api.offthegrid.com/events";
const USER_AGENT = "foodTruck-desk-display/1 (one request a day; github.com/AidanBarciaBacon/foodTruck)";
const TIMEOUT_MS = 15_000;
const MARKET_NAME = "Off the Grid: Levi's Plaza";
const MAX_DAYS = 90; // the feed takes at most 3 months per request
const MAX_REASON = 120;

// ---------------------------------------------------------------------------------------------------------------
// Pacific time
// ---------------------------------------------------------------------------------------------------------------

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// A calendar date has no time zone of its own, so its names are read at noon UTC, in UTC.
const dayNames = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
});

const two = (n) => String(n).padStart(2, "0");

function assertDate(value, what) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${what} must be a valid Date`);
  }
}

/** What a clock on the wall in San Francisco shows at this instant: { year, month, day, hour, minute, second }. */
function pacificParts(date) {
  const parts = {};
  for (const { type, value } of wallClock.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return parts;
}

/** Pacific time's distance from UTC at this instant, in milliseconds (negative: -8 h in winter, -7 h in summer). */
function pacificOffsetMs(date) {
  const p = pacificParts(date);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-11-12": the Pacific calendar date at this instant. */
function pacificDate(date) {
  const p = pacificParts(date);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** "2026-11-12T06:31:04-08:00": this instant written as Pacific time. */
function pacificIso(date) {
  const p = pacificParts(date);
  const minutes = Math.round(pacificOffsetMs(date) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return (
    `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}` +
    `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
  );
}

/** "6:31 AM": the Pacific time of day, with plain spaces whatever the ICU version prints. */
function clockLabel(date) {
  const { hour, minute } = pacificParts(date);
  return `${hour % 12 || 12}:${two(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

/** { weekday: "Thursday", label: "Thursday, Nov 12" } for a "YYYY-MM-DD" calendar date. */
function describeDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const parts = {};
  for (const { type, value } of dayNames.formatToParts(new Date(Date.UTC(year, month - 1, day, 12)))) {
    parts[type] = value;
  }
  return { weekday: parts.weekday, label: `${parts.weekday}, ${parts.month} ${parts.day}` };
}

/**
 * The instant (epoch ms) of 00:00 Pacific on a calendar date. `day` may run past the end of the month, so
 * "14 days after the 25th" needs no arithmetic by the caller. The offset is asked of Intl, then asked again at
 * the answer, so a window that crosses a daylight-saving change still starts and ends at midnight.
 */
function pacificMidnight(year, month, day) {
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall;
  for (let i = 0; i < 3; i += 1) instant = wall - pacificOffsetMs(new Date(instant));
  return instant;
}

// ---------------------------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------------------------

function feedError(reason, cause) {
  return new Error(`Off the Grid feed: ${reason}`, cause ? { cause } : undefined);
}

function whyFetchFailed(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `no answer in ${TIMEOUT_MS / 1000} s`;
  const code = err?.cause?.code ?? err?.code;
  const detail = code ?? err?.cause?.message ?? err?.message ?? String(err);
  return `request failed (${detail})`;
}

/**
 * One GET of the events feed for the window [from, to] (epoch milliseconds, or Dates).
 * Returns the feed's `data.events` array as it came. Throws an Error with a short, clear message when the request
 * fails or times out (15 s), the HTTP status is not 200, the answer is not JSON, its `status` is not "success",
 * or `data.events` is not an array.
 */
export async function fetchEvents({ from, to, fetchImpl = fetch } = {}) {
  const dateFrom = Number(from);
  const dateTo = Number(to);
  if (from == null || to == null || !Number.isFinite(dateFrom) || !Number.isFinite(dateTo) || dateTo <= dateFrom) {
    throw new TypeError("fetchEvents: from and to must be epoch milliseconds (or Dates), with to after from");
  }
  const url = `${FEED_URL}?dateFrom=${Math.trunc(dateFrom)}&dateTo=${Math.trunc(dateTo)}`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw feedError(whyFetchFailed(err), err);
  }
  if (response.status !== 200) throw feedError(`HTTP ${response.status}`);

  let body;
  try {
    body = await response.json();
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw feedError(whyFetchFailed(err), err);
    throw feedError("the answer was not JSON", err);
  }
  if (body?.status !== "success") {
    throw feedError(`status was ${JSON.stringify(body?.status) ?? "missing"}, not "success"`);
  }
  if (!Array.isArray(body.data?.events)) throw feedError("the answer has no events list");
  return body.data.events;
}

// ---------------------------------------------------------------------------------------------------------------
// today.json
// ---------------------------------------------------------------------------------------------------------------

const collapse = (text) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");

/** The feed's truck name with whitespace collapsed and one trailing " LLC", " LLC.", " Inc" or " Inc." removed. */
function cleanName(name) {
  return collapse(name)
    .replace(/(?:\s?,\s?|\s)(?:LLC|Inc)\.?$/i, "")
    .trim();
}

function trucksOf(event) {
  const seen = new Set();
  const trucks = [];
  for (const creator of event.creators) {
    const name = cleanName(creator?.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    trucks.push({ name, food: collapse(creator?.primaryCuisine) });
  }
  return trucks;
}

/** The parts of today.json that depend only on the clock, in the contract's order. */
function clockFields(now) {
  const date = pacificDate(now);
  const { weekday, label } = describeDay(date);
  return {
    v: 1,
    date,
    weekday,
    dateLabel: label,
    generatedAt: pacificIso(now),
    updatedLabel: `Updated ${clockLabel(now)}`,
  };
}

/**
 * The feed's events -> { today, marketDates }.
 *
 * `today` is the contract's today.json without `pageUrl`. `marketDates` is every Pacific date from today onward on
 * which the location has an event with at least one truck: sorted, no repeats.
 *
 * - An event is dated by the Pacific date of its `startTime`.
 * - An event whose `creators` list is empty (or holds no named truck) is no market that day.
 * - If the location has two events on one day, the earlier one that has trucks is the market.
 * - `market` is always an object. On a "no-market" day `hoursLabel` is "".
 * - Throws when `events` is not an array, or when one of the location's events has no `creators` list or no
 *   readable `startTime`: that is a feed that changed shape, which must not be shown as "No market today".
 */
export function normalise(events, { now, locationId = LEVIS_PLAZA } = {}) {
  assertDate(now, "normalise: now");
  if (!Array.isArray(events)) throw new TypeError("normalise: events must be an array");

  const fields = clockFields(now);
  const markets = new Map(); // Pacific date -> { start, end, name, trucks }

  for (const event of events) {
    if (!event || event.locationId !== locationId) continue;
    if (!Array.isArray(event.creators)) throw feedError("an event has no creators list");
    const start = new Date(event.startTime);
    if (typeof event.startTime !== "string" || Number.isNaN(start.getTime())) {
      throw feedError("an event has no readable startTime");
    }
    const trucks = trucksOf(event);
    if (trucks.length === 0) continue;
    const date = pacificDate(start);
    const known = markets.get(date);
    if (known && known.start <= start) continue;
    markets.set(date, { start, end: new Date(event.endTime), name: collapse(event.locationName), trucks });
  }

  const marketDates = [...markets.keys()].filter((date) => date >= fields.date).sort();
  const market = markets.get(fields.date);
  const nextDate = marketDates.find((date) => date > fields.date);
  const fallbackName = locationId === LEVIS_PLAZA ? MARKET_NAME : "";

  let hoursLabel = "";
  if (market) {
    hoursLabel = clockLabel(market.start);
    // An en dash, with a space each side.
    if (!Number.isNaN(market.end.getTime())) hoursLabel += ` – ${clockLabel(market.end)}`;
  }

  return {
    today: {
      ...fields,
      state: market ? "market" : "no-market",
      market: { name: market?.name || fallbackName, hoursLabel },
      trucks: market ? market.trucks : [],
      next: nextDate ? { date: nextDate, label: describeDay(nextDate).label } : null,
      error: null,
    },
    marketDates,
  };
}

function shortReason(err) {
  const text = collapse(err?.message ?? String(err)) || "unknown error";
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
}

/**
 * The morning job's one call: fetch the window from today 00:00 Pacific to `days` days ahead (one request) and
 * normalise it. Never throws for a feed problem: on any failure it returns state "error" with a short reason,
 * no trucks, no `next`, and no market dates.
 */
export async function loadToday({ now = new Date(), fetchImpl = fetch, days = 14 } = {}) {
  assertDate(now, "loadToday: now");
  try {
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      throw new RangeError(`loadToday: days must be a whole number from 1 to ${MAX_DAYS}`);
    }
    const { year, month, day } = pacificParts(now);
    const events = await fetchEvents({
      from: pacificMidnight(year, month, day),
      to: pacificMidnight(year, month, day + days),
      fetchImpl,
    });
    return normalise(events, { now });
  } catch (err) {
    return {
      today: {
        ...clockFields(now),
        state: "error",
        market: { name: MARKET_NAME, hoursLabel: "" },
        trucks: [],
        next: null,
        error: shortReason(err),
      },
      marketDates: [],
    };
  }
}
