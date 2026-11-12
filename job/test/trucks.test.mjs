// Tests for job/lib/trucks.mjs. No network: every fetch goes to a fake.
//
// fixtures/events-2026-11-12.json is the real feed's answer for 12 to 26 November 2026 (fetched once on
// 12 November 2026), trimmed: every Levi's Plaza record in full, plus two Salesforce Tower records (12 November, a
// market day, and Friday 13 November, a day Levi's Plaza has none) so the location filter is tested.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LEVIS_PLAZA, fetchEvents, normalise, loadToday } from "../lib/trucks.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/events-2026-11-12.json", import.meta.url), "utf8"));
const events = fixture.data.events;

const THURSDAY_0631 = new Date("2026-11-12T06:31:04-08:00");
const FIXTURE_MARKET_DATES = [
  "2026-11-12",
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-23",
  "2026-11-24",
  "2026-11-25",
];

/** A fake fetch that answers every call with `body` (JSON unless it is a string) and records what it was asked. */
function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  impl.calls = calls;
  return impl;
}

/** A made-up Levi's Plaza event, for the cases the real feed did not have that fortnight. */
function event(date, creators, extra = {}) {
  return {
    id: `TEST-${date}`,
    name: "Levi's Plaza Business Market",
    startTime: `${date}T11:00:00-08:00`,
    endTime: `${date}T14:00:00-08:00`,
    locationId: LEVIS_PLAZA,
    locationName: "Off the Grid: Levi's Plaza",
    creators: creators.map((c) => (typeof c === "string" ? { name: c, primaryCuisine: "Food" } : c)),
    ...extra,
  };
}

const namesOn = (date, list) => normalise(list, { now: new Date(`${date}T06:31:00-08:00`) }).today.trucks.map((t) => t.name);

// ---------------------------------------------------------------------------------------------------------------
// The fixture is what the tests assume
// ---------------------------------------------------------------------------------------------------------------

test("the fixture is the feed's envelope, with Levi's Plaza and two records from elsewhere", () => {
  assert.equal(LEVIS_PLAZA, "0016e00002o8dIXAAY");
  assert.equal(fixture.status, "success");
  assert.equal(events.filter((e) => e.locationId === LEVIS_PLAZA).length, 8);
  assert.equal(events.filter((e) => e.locationId !== LEVIS_PLAZA).length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// normalise: today
// ---------------------------------------------------------------------------------------------------------------

test("Thursday 12 November at 6:31 AM Pacific: the whole of today.json, without pageUrl", () => {
  const { today } = normalise(events, { now: THURSDAY_0631 });
  assert.deepEqual(today, {
    v: 1,
    date: "2026-11-12",
    weekday: "Thursday",
    dateLabel: "Thursday, Nov 12",
    generatedAt: "2026-11-12T06:31:04-08:00",
    updatedLabel: "Updated 6:31 AM",
    state: "market",
    market: { name: "Off the Grid: Levi's Plaza", hoursLabel: "11:00 AM – 2:00 PM" },
    trucks: [
      { name: "Buri Buri", food: "Japanese" },
      { name: "Big City Halal", food: "Halal" },
      { name: "J&D's BBQ", food: "BBQ" },
    ],
    next: { date: "2026-11-16", label: "Monday, Nov 16" },
    error: null,
  });
  assert.ok(!("pageUrl" in today));
  assert.deepEqual(Object.keys(today), [
    "v",
    "date",
    "weekday",
    "dateLabel",
    "generatedAt",
    "updatedLabel",
    "state",
    "market",
    "trucks",
    "next",
    "error",
  ]);
});

test("the labels are plain text: ordinary spaces, an en dash in the hours", () => {
  const { today } = normalise(events, { now: THURSDAY_0631 });
  assert.equal(today.dateLabel, "Thursday, Nov 12");
  assert.equal(today.updatedLabel, "Updated 6:31 AM");
  assert.equal(today.market.hoursLabel, "11:00 AM – 2:00 PM");
  assert.equal(today.next.label, "Monday, Nov 16");
  for (const label of [today.dateLabel, today.updatedLabel, today.market.hoursLabel, today.next.label]) {
    // Newer ICU puts a narrow no-break space before AM/PM; the screen's font may not have it.
    assert.doesNotMatch(label, /[   ]/, label);
  }
  assert.equal(today.market.hoursLabel.charCodeAt(9), 0x2013);
});

test("the time-of-day label at midnight, noon and in the afternoon", () => {
  const at = (iso) => normalise(events, { now: new Date(iso) }).today.updatedLabel;
  assert.equal(at("2026-11-12T00:00:00-08:00"), "Updated 12:00 AM");
  assert.equal(at("2026-11-12T00:05:00-08:00"), "Updated 12:05 AM");
  assert.equal(at("2026-11-12T12:00:00-08:00"), "Updated 12:00 PM");
  assert.equal(at("2026-11-12T13:07:00-08:00"), "Updated 1:07 PM");
  assert.equal(at("2026-11-12T23:59:59-08:00"), "Updated 11:59 PM");
  assert.equal(normalise(events, { now: new Date("2026-11-12T00:00:00-08:00") }).today.date, "2026-11-12");
});

test("a Friday: no market, and next is the following Monday", () => {
  const { today, marketDates } = normalise(events, { now: new Date("2026-11-13T06:30:00-08:00") });
  assert.equal(today.date, "2026-11-13");
  assert.equal(today.weekday, "Friday");
  assert.equal(today.dateLabel, "Friday, Nov 13");
  assert.equal(today.state, "no-market");
  assert.deepEqual(today.trucks, []);
  assert.deepEqual(today.market, { name: "Off the Grid: Levi's Plaza", hoursLabel: "" });
  assert.deepEqual(today.next, { date: "2026-11-16", label: "Monday, Nov 16" });
  assert.equal(today.error, null);
  // Salesforce Tower has a market that Friday; it must not count.
  assert.ok(events.some((e) => e.locationId !== LEVIS_PLAZA && e.startTime.startsWith("2026-11-13")));
  assert.equal(marketDates[0], "2026-11-16");
});

test("the location filter: the same feed read for Salesforce Tower", () => {
  const { today, marketDates } = normalise(events, { now: THURSDAY_0631, locationId: "0016e00002o8dItAAI" });
  assert.equal(today.state, "market");
  assert.equal(today.market.name, "Off the Grid: Salesforce Tower");
  assert.equal(today.trucks.length, 2);
  assert.deepEqual(marketDates, ["2026-11-12", "2026-11-13"]);
  assert.deepEqual(today.next, { date: "2026-11-13", label: "Friday, Nov 13" });
});

test("a location the feed does not mention has no market and nothing next", () => {
  const { today, marketDates } = normalise(events, { now: THURSDAY_0631, locationId: "nowhere" });
  assert.equal(today.state, "no-market");
  assert.equal(today.next, null);
  assert.deepEqual(today.market, { name: "", hoursLabel: "" });
  assert.deepEqual(marketDates, []);
});

// ---------------------------------------------------------------------------------------------------------------
// normalise: the date is the Pacific one
// ---------------------------------------------------------------------------------------------------------------

test("Saturday evening in UTC is still Saturday in Pacific", () => {
  const now = new Date("2026-11-14T20:00:00Z"); // Saturday 12:00 noon PST
  const { today } = normalise(events, { now });
  assert.equal(today.date, "2026-11-14");
  assert.equal(today.weekday, "Saturday");
  assert.equal(today.dateLabel, "Saturday, Nov 14");
  assert.equal(today.generatedAt, "2026-11-14T12:00:00-08:00");
  assert.equal(today.state, "no-market");
  assert.deepEqual(today.next, { date: "2026-11-16", label: "Monday, Nov 16" });
});

test("late Saturday night in UTC (23:30) is Saturday afternoon in Pacific", () => {
  const { today } = normalise(events, { now: new Date("2026-11-14T23:30:00Z") });
  assert.equal(today.date, "2026-11-14");
  assert.equal(today.weekday, "Saturday");
  assert.equal(today.updatedLabel, "Updated 3:30 PM");
});

test("already tomorrow in UTC, still today in Pacific: the date is the Pacific one", () => {
  const now = new Date("2026-11-13T03:00:00Z"); // Thursday 7:00 PM PST
  assert.equal(now.toISOString().slice(0, 10), "2026-11-13");
  const { today, marketDates } = normalise(events, { now });
  assert.equal(today.date, "2026-11-12");
  assert.equal(today.weekday, "Thursday");
  assert.equal(today.dateLabel, "Thursday, Nov 12");
  assert.equal(today.generatedAt, "2026-11-12T19:00:00-08:00");
  assert.equal(today.updatedLabel, "Updated 7:00 PM");
  assert.equal(today.state, "market");
  assert.equal(today.trucks.length, 3);
  assert.deepEqual(marketDates, FIXTURE_MARKET_DATES);
});

test("the last minute of the Pacific day, and the first of the next", () => {
  const before = normalise(events, { now: new Date("2026-11-13T07:59:59Z") }).today;
  const after = normalise(events, { now: new Date("2026-11-13T08:00:00Z") }).today;
  assert.equal(before.date, "2026-11-12");
  assert.equal(before.state, "market");
  assert.equal(after.date, "2026-11-13");
  assert.equal(after.generatedAt, "2026-11-13T00:00:00-08:00");
  assert.equal(after.state, "no-market");
});

test("across the autumn clock change (1 November 2026) the offset follows the clocks", () => {
  // 01:30 happens twice that morning: first in summer time, an hour later in winter time.
  const first = normalise([], { now: new Date("2026-11-01T08:30:00Z") }).today;
  const second = normalise([], { now: new Date("2026-11-01T09:30:00Z") }).today;
  assert.equal(first.generatedAt, "2026-11-01T01:30:00-07:00");
  assert.equal(second.generatedAt, "2026-11-01T01:30:00-08:00");
  assert.equal(first.date, "2026-11-01");
  assert.equal(second.date, "2026-11-01");
  assert.equal(first.weekday, "Sunday");
  // 06:30 UTC on the 1st is still Saturday 31 October, 11:30 PM summer time.
  const eve = normalise([], { now: new Date("2026-11-01T06:30:00Z") }).today;
  assert.equal(eve.date, "2026-10-31");
  assert.equal(eve.dateLabel, "Saturday, Oct 31");
  assert.equal(eve.updatedLabel, "Updated 11:30 PM");
});

test("across the spring clock change (14 March 2027), and a summer market's hours", () => {
  const before = normalise([], { now: new Date("2027-03-14T09:59:00Z") }).today;
  const after = normalise([], { now: new Date("2027-03-14T10:00:00Z") }).today;
  assert.equal(before.generatedAt, "2027-03-14T01:59:00-08:00");
  assert.equal(after.generatedAt, "2027-03-14T03:00:00-07:00");

  const summer = event("2027-06-15", ["Summer Truck"], {
    startTime: "2027-06-15T11:00:00-07:00",
    endTime: "2027-06-15T14:00:00-07:00",
  });
  const { today } = normalise([summer], { now: new Date("2027-06-15T13:31:00Z") });
  assert.equal(today.date, "2027-06-15");
  assert.equal(today.generatedAt, "2027-06-15T06:31:00-07:00");
  assert.equal(today.updatedLabel, "Updated 6:31 AM");
  assert.equal(today.state, "market");
  assert.equal(today.market.hoursLabel, "11:00 AM – 2:00 PM");
});

test("an event's date is the Pacific date of its start, however the feed writes the time", () => {
  // The same instant as 11:00 AM PST on the 16th, written in UTC.
  const utc = event("2026-11-16", ["Truck"], { startTime: "2026-11-16T19:00:00Z", endTime: "2026-11-16T22:00:00Z" });
  // 6:00 PM PST on the 16th is already the 17th in UTC.
  const evening = event("2026-11-16", ["Night Truck"], {
    startTime: "2026-11-17T02:00:00Z",
    endTime: "2026-11-17T06:00:00Z",
  });
  const a = normalise([utc], { now: new Date("2026-11-16T06:31:00-08:00") });
  assert.equal(a.today.state, "market");
  assert.equal(a.today.market.hoursLabel, "11:00 AM – 2:00 PM");
  const b = normalise([evening], { now: new Date("2026-11-16T06:31:00-08:00") });
  assert.equal(b.today.state, "market");
  assert.equal(b.today.market.hoursLabel, "6:00 PM – 10:00 PM");
  assert.deepEqual(b.marketDates, ["2026-11-16"]);
});

// ---------------------------------------------------------------------------------------------------------------
// normalise: names and food
// ---------------------------------------------------------------------------------------------------------------

test("name cleaning on the real feed: J&D's BBQ LLC and Gregoire Culinary Truck LLC.", () => {
  const raw = events.filter((e) => e.locationId === LEVIS_PLAZA).flatMap((e) => e.creators.map((c) => c.name));
  assert.ok(raw.includes("J&D's BBQ LLC"));
  assert.ok(raw.includes("Gregoire Culinary Truck LLC."));

  assert.deepEqual(namesOn("2026-11-12", events), ["Buri Buri", "Big City Halal", "J&D's BBQ"]);
  assert.deepEqual(namesOn("2026-11-17", events), [
    "Lion Tea & Dragon Bites",
    "Wokitchen",
    "Korean Bobcha",
    "Gregoire Culinary Truck",
  ]);
});

test("curly apostrophes are kept as the feed has them", () => {
  // Monday the 16th has "Lola’s Spanish Cuisine", Thursday the 19th "D’Grobak LLC": both U+2019.
  assert.deepEqual(namesOn("2026-11-16", events), ["Atlas Bites", "Lola’s Spanish Cuisine", "Chick N' Bros"]);
  assert.deepEqual(namesOn("2026-11-19", events), ["D’Grobak", "Sam's Chowder Mobile", "Curry Up Now"]);
});

test("name cleaning: every legal suffix in the contract, and nothing else", () => {
  const cases = [
    ["J&D's BBQ LLC", "J&D's BBQ"],
    ["Gregoire Culinary Truck LLC.", "Gregoire Culinary Truck"],
    ["Taco Works Inc", "Taco Works"],
    ["Taco Works Inc.", "Taco Works"],
    ["Taco Works, LLC", "Taco Works"],
    ["Taco Works, LLC.", "Taco Works"],
    ["Taco Works, Inc", "Taco Works"],
    ["Taco Works, Inc.", "Taco Works"],
    ["Taco Works , Inc.", "Taco Works"],
    ["Taco Works llc", "Taco Works"],
    ["  Señor   Sisig \t LLC  ", "Señor Sisig"],
    ["Bowl  of  Heaven\n", "Bowl of Heaven"],
    // A suffix only at the end, and only as a word of its own.
    ["LLC Kitchen", "LLC Kitchen"],
    ["Zinc", "Zinc"],
    ["Pop Inc Bakery", "Pop Inc Bakery"],
    ["The Incredible", "The Incredible"],
    ["LLC", "LLC"],
    ["Curry Up Now", "Curry Up Now"],
  ];
  const list = [event("2026-11-12", cases.map(([raw], i) => ({ name: raw, primaryCuisine: `F${i}` })))];
  assert.deepEqual(
    namesOn("2026-11-12", list),
    cases.map(([, clean]) => clean).filter((name, i, all) => all.indexOf(name) === i),
  );
});

test("food is primaryCuisine, or an empty string", () => {
  const list = [
    event("2026-11-12", [
      { name: "A", primaryCuisine: "Halal" },
      { name: "B", primaryCuisine: null },
      { name: "C" },
      { name: "D", primaryCuisine: "" },
      { name: "E", primaryCuisine: "  Fried   Chicken " },
      { name: "F", primaryCuisine: 7 },
    ]),
  ];
  const { today } = normalise(list, { now: THURSDAY_0631 });
  assert.deepEqual(today.trucks, [
    { name: "A", food: "Halal" },
    { name: "B", food: "" },
    { name: "C", food: "" },
    { name: "D", food: "" },
    { name: "E", food: "Fried Chicken" },
    { name: "F", food: "" },
  ]);
});

test("a truck listed twice shows once, and one with no name is left out", () => {
  const list = [event("2026-11-12", ["Buri Buri", "Buri Buri LLC", { name: "" }, { primaryCuisine: "Thai" }, null, "Wokitchen"])];
  assert.deepEqual(namesOn("2026-11-12", list), ["Buri Buri", "Wokitchen"]);
});

// ---------------------------------------------------------------------------------------------------------------
// normalise: empty days, market dates
// ---------------------------------------------------------------------------------------------------------------

test("an event with no creators is no market that day", () => {
  const list = [event("2026-11-12", []), event("2026-11-16", ["Atlas Bites"]), event("2026-11-17", [])];
  const { today, marketDates } = normalise(list, { now: THURSDAY_0631 });
  assert.equal(today.state, "no-market");
  assert.deepEqual(today.trucks, []);
  assert.equal(today.market.hoursLabel, "");
  assert.deepEqual(today.next, { date: "2026-11-16", label: "Monday, Nov 16" });
  assert.equal(today.error, null);
  assert.deepEqual(marketDates, ["2026-11-16"]);
});

test("an event whose creators have no names is no market either", () => {
  const list = [event("2026-11-12", [{ name: "  " }, {}])];
  assert.equal(normalise(list, { now: THURSDAY_0631 }).today.state, "no-market");
});

test("no events at all: no market, next is null, no market dates", () => {
  const { today, marketDates } = normalise([], { now: THURSDAY_0631 });
  assert.equal(today.state, "no-market");
  assert.equal(today.next, null);
  assert.deepEqual(today.trucks, []);
  assert.deepEqual(marketDates, []);
});

test("marketDates from the fixture: today onward, sorted, Levi's Plaza only", () => {
  assert.deepEqual(normalise(events, { now: THURSDAY_0631 }).marketDates, FIXTURE_MARKET_DATES);
  // From the Friday, today's market is in the past and drops out.
  assert.deepEqual(normalise(events, { now: new Date("2026-11-13T06:31:00-08:00") }).marketDates, FIXTURE_MARKET_DATES.slice(1));
  // After the last one, nothing is left and next is null.
  const after = normalise(events, { now: new Date("2026-11-26T06:31:00-08:00") });
  assert.deepEqual(after.marketDates, []);
  assert.equal(after.today.next, null);
  assert.equal(after.today.state, "no-market");
});

test("marketDates: unsorted input, repeats, past days and empty days", () => {
  const list = [
    event("2026-11-18", ["C"]),
    event("2026-11-11", ["Yesterday"]),
    event("2026-11-16", ["A"]),
    event("2026-11-17", []),
    event("2026-11-16", ["A again"], { startTime: "2026-11-16T17:00:00-08:00", endTime: "2026-11-16T20:00:00-08:00" }),
    event("2026-11-12", ["Today"]),
    { ...event("2026-11-19", ["Elsewhere"]), locationId: "somewhere-else" },
  ];
  const { today, marketDates } = normalise(list, { now: THURSDAY_0631 });
  assert.deepEqual(marketDates, ["2026-11-12", "2026-11-16", "2026-11-18"]);
  assert.deepEqual(today.next, { date: "2026-11-16", label: "Monday, Nov 16" });
});

test("two events at the location on one day: the earlier one with trucks is the market", () => {
  const list = [
    event("2026-11-12", ["Dinner Truck"], { startTime: "2026-11-12T17:00:00-08:00", endTime: "2026-11-12T20:00:00-08:00" }),
    event("2026-11-12", []),
    event("2026-11-12", ["Lunch Truck"]),
  ];
  const { today, marketDates } = normalise(list, { now: THURSDAY_0631 });
  assert.deepEqual(today.trucks, [{ name: "Lunch Truck", food: "Food" }]);
  assert.equal(today.market.hoursLabel, "11:00 AM – 2:00 PM");
  assert.deepEqual(marketDates, ["2026-11-12"]);
});

test("next can be in another month or year, and its label says so plainly", () => {
  const list = [event("2026-12-17", ["Last Before The Break"]), event("2027-01-04", ["First Back"])];
  const dec = normalise(list, { now: new Date("2026-12-17T06:31:00-08:00") }).today;
  assert.equal(dec.state, "market");
  assert.deepEqual(dec.next, { date: "2027-01-04", label: "Monday, Jan 4" });
});

test("a feed that changed shape is an error, not an empty day", () => {
  assert.throws(() => normalise({ events }, { now: THURSDAY_0631 }), /events must be an array/);
  assert.throws(() => normalise(events, {}), /now must be a valid Date/);
  assert.throws(() => normalise(events, { now: new Date("nonsense") }), /now must be a valid Date/);
  const noList = [{ ...event("2026-11-12", []), creators: undefined }];
  assert.throws(() => normalise(noList, { now: THURSDAY_0631 }), /no creators list/);
  const noStart = [event("2026-11-12", ["A"], { startTime: "soon" })];
  assert.throws(() => normalise(noStart, { now: THURSDAY_0631 }), /no readable startTime/);
  // The same faults at another location are none of our business.
  const elsewhere = [{ ...event("2026-11-12", []), creators: undefined, locationId: "somewhere-else" }, null];
  assert.equal(normalise(elsewhere, { now: THURSDAY_0631 }).today.state, "no-market");
});

test("normalise does not change the events it is given", () => {
  const before = JSON.stringify(events);
  normalise(events, { now: THURSDAY_0631 });
  assert.equal(JSON.stringify(events), before);
});

// ---------------------------------------------------------------------------------------------------------------
// fetchEvents
// ---------------------------------------------------------------------------------------------------------------

test("fetchEvents: one GET with the window, an honest User-Agent and a timeout; returns the events", async () => {
  const fetchImpl = fakeFetch(fixture);
  const got = await fetchEvents({ from: 1794470400000, to: 1795680000000, fetchImpl });
  assert.deepEqual(got, events);
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, "https://sf-api.offthegrid.com/events?dateFrom=1794470400000&dateTo=1795680000000");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Accept, "application/json");
  assert.equal(
    init.headers["User-Agent"],
    "foodTruck-desk-display/1 (one request a day; github.com/AidanBarciaBacon/foodTruck)",
  );
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
});

test("fetchEvents takes Dates as well as milliseconds", async () => {
  const fetchImpl = fakeFetch(fixture);
  await fetchEvents({
    from: new Date("2026-11-12T00:00:00-08:00"),
    to: new Date("2026-11-26T00:00:00-08:00"),
    fetchImpl,
  });
  assert.equal(fetchImpl.calls[0].url, "https://sf-api.offthegrid.com/events?dateFrom=1794470400000&dateTo=1795680000000");
});

test("fetchEvents throws on HTTP 500", async () => {
  const fetchImpl = fakeFetch({ status: "success", data: { events: [] } }, { status: 500 });
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl }), { name: "Error", message: "Off the Grid feed: HTTP 500" });
});

test("fetchEvents throws on every status but 200 (404, 429, 503, 204)", async () => {
  for (const status of [404, 429, 503]) {
    await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: fakeFetch(fixture, { status }) }), new RegExp(`HTTP ${status}`));
  }
  const empty = async () => new Response(null, { status: 204 });
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: empty }), /HTTP 204/);
});

test('fetchEvents throws on status: "error"', async () => {
  const fetchImpl = fakeFetch({ status: "error", message: "Invalid date range" });
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl }), {
    name: "Error",
    message: 'Off the Grid feed: status was "error", not "success"',
  });
  // Even when the body also carries events.
  const both = fakeFetch({ status: "error", data: { events: [] } });
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: both }), /status was "error"/);
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: fakeFetch({ data: { events: [] } }) }), /status was missing/);
});

test("fetchEvents throws on a missing events array", async () => {
  const bodies = [
    { status: "success" },
    { status: "success", data: null },
    { status: "success", data: {} },
    { status: "success", data: { events: null } },
    { status: "success", data: { events: { 0: {} } } },
    { status: "success", data: { events: "none" } },
  ];
  for (const body of bodies) {
    await assert.rejects(
      fetchEvents({ from: 1, to: 2, fetchImpl: fakeFetch(body) }),
      { name: "Error", message: "Off the Grid feed: the answer has no events list" },
      JSON.stringify(body),
    );
  }
});

test("fetchEvents throws clearly when the answer is not JSON, or is JSON null", async () => {
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: fakeFetch("<html>Bad gateway</html>") }), {
    message: "Off the Grid feed: the answer was not JSON",
  });
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: fakeFetch("null") }), /status was missing/);
});

test("fetchEvents throws clearly when the request fails or times out", async () => {
  const refused = async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
  };
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: refused }), {
    name: "Error",
    message: "Off the Grid feed: request failed (ENOTFOUND)",
  });
  const slow = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  await assert.rejects(fetchEvents({ from: 1, to: 2, fetchImpl: slow }), { message: "Off the Grid feed: no answer in 15 s" });
});

test("fetchEvents refuses a window it cannot ask for, without a request", async () => {
  const fetchImpl = fakeFetch(fixture);
  await assert.rejects(fetchEvents({ from: undefined, to: 2, fetchImpl }), TypeError);
  await assert.rejects(fetchEvents({ from: 5, to: 5, fetchImpl }), TypeError);
  await assert.rejects(fetchEvents({ from: "today", to: "tomorrow", fetchImpl }), TypeError);
  assert.equal(fetchImpl.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// loadToday
// ---------------------------------------------------------------------------------------------------------------

test("loadToday: one request, from today 00:00 Pacific to 14 days ahead, then the same as normalise", async () => {
  const fetchImpl = fakeFetch(fixture);
  const got = await loadToday({ now: THURSDAY_0631, fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  const from = Date.parse("2026-11-12T00:00:00-08:00");
  const to = Date.parse("2026-11-26T00:00:00-08:00");
  assert.equal(fetchImpl.calls[0].url, `https://sf-api.offthegrid.com/events?dateFrom=${from}&dateTo=${to}`);
  assert.deepEqual(got, normalise(events, { now: THURSDAY_0631 }));
  assert.equal(got.today.state, "market");
  assert.deepEqual(got.marketDates, FIXTURE_MARKET_DATES);
});

test("loadToday: the window follows `days`, and starts at Pacific midnight even late in the UTC day", async () => {
  const fetchImpl = fakeFetch(fixture);
  await loadToday({ now: new Date("2026-11-13T03:00:00Z"), fetchImpl, days: 1 });
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(Number(url.searchParams.get("dateFrom")), Date.parse("2026-11-12T00:00:00-08:00"));
  assert.equal(Number(url.searchParams.get("dateTo")), Date.parse("2026-11-13T00:00:00-08:00"));
});

test("loadToday: a window across a clock change still runs midnight to midnight", async () => {
  const autumn = fakeFetch({ status: "success", data: { events: [] } });
  await loadToday({ now: new Date("2026-10-30T06:31:00-07:00"), fetchImpl: autumn });
  let url = new URL(autumn.calls[0].url);
  assert.equal(Number(url.searchParams.get("dateFrom")), Date.parse("2026-10-30T00:00:00-07:00"));
  assert.equal(Number(url.searchParams.get("dateTo")), Date.parse("2026-11-13T00:00:00-08:00"));

  const spring = fakeFetch({ status: "success", data: { events: [] } });
  await loadToday({ now: new Date("2027-03-10T06:31:00-08:00"), fetchImpl: spring });
  url = new URL(spring.calls[0].url);
  assert.equal(Number(url.searchParams.get("dateFrom")), Date.parse("2027-03-10T00:00:00-08:00"));
  assert.equal(Number(url.searchParams.get("dateTo")), Date.parse("2027-03-24T00:00:00-07:00"));

  // On the day of the change itself: midnight is still in the old time.
  const theDay = fakeFetch({ status: "success", data: { events: [] } });
  await loadToday({ now: new Date("2026-11-01T06:31:00-08:00"), fetchImpl: theDay, days: 1 });
  url = new URL(theDay.calls[0].url);
  assert.equal(Number(url.searchParams.get("dateFrom")), Date.parse("2026-11-01T00:00:00-07:00"));
  assert.equal(Number(url.searchParams.get("dateTo")), Date.parse("2026-11-02T00:00:00-08:00"));
});

test("loadToday returns state error, and does not throw, when the fetch fails", async () => {
  const fetchImpl = async () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  };
  const got = await loadToday({ now: THURSDAY_0631, fetchImpl });
  assert.deepEqual(got, {
    today: {
      v: 1,
      date: "2026-11-12",
      weekday: "Thursday",
      dateLabel: "Thursday, Nov 12",
      generatedAt: "2026-11-12T06:31:04-08:00",
      updatedLabel: "Updated 6:31 AM",
      state: "error",
      market: { name: "Off the Grid: Levi's Plaza", hoursLabel: "" },
      trucks: [],
      next: null,
      error: "Off the Grid feed: request failed (ECONNREFUSED)",
    },
    marketDates: [],
  });
});

test("loadToday returns state error for every kind of bad answer, each with a short reason", async () => {
  const cases = [
    [fakeFetch(fixture, { status: 500 }), "Off the Grid feed: HTTP 500"],
    [fakeFetch({ status: "error" }), 'Off the Grid feed: status was "error", not "success"'],
    [fakeFetch({ status: "success", data: {} }), "Off the Grid feed: the answer has no events list"],
    [fakeFetch("not json"), "Off the Grid feed: the answer was not JSON"],
    [
      fakeFetch({ status: "success", data: { events: [{ locationId: LEVIS_PLAZA, startTime: "2026-11-12T11:00:00-08:00" }] } }),
      "Off the Grid feed: an event has no creators list",
    ],
    [() => { throw new Error("x".repeat(500)); }, null],
    [() => Promise.reject("just a string"), null],
  ];
  for (const [fetchImpl, reason] of cases) {
    const { today, marketDates } = await loadToday({ now: THURSDAY_0631, fetchImpl });
    assert.equal(today.state, "error");
    assert.deepEqual(today.trucks, []);
    assert.equal(today.next, null);
    assert.deepEqual(marketDates, []);
    assert.equal(typeof today.error, "string");
    assert.ok(today.error.length > 0 && today.error.length <= 120, today.error);
    if (reason) assert.equal(today.error, reason);
    assert.equal(today.date, "2026-11-12");
    assert.equal(today.dateLabel, "Thursday, Nov 12");
  }
});

test("loadToday: a `days` the feed cannot serve is an error state, with no request made", async () => {
  const fetchImpl = fakeFetch(fixture);
  for (const days of [0, -1, 1.5, 400, "14"]) {
    const { today } = await loadToday({ now: THURSDAY_0631, fetchImpl, days });
    assert.equal(today.state, "error");
    assert.match(today.error, /days must be a whole number/);
  }
  assert.equal(fetchImpl.calls.length, 0);
});
