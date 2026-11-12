import { test } from "node:test";
import assert from "node:assert/strict";
import { nextWake, pacificDate, publishedWake } from "../lib/schedule.mjs";

// Every time below is written in UTC, with the Pacific wall clock beside it, so the expected values do not lean
// on the code under test. November 2026 is Pacific Standard Time: 7:00 AM is 15:00 UTC.
const at = (iso) => new Date(iso);
const seconds = (iso) => Date.parse(iso) / 1000;
const DAY = 86400;

// Monday 9 to Thursday 12 November 2026, then the week after.
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-16", "2026-11-17"];

test("pacificDate gives the Pacific day, not the UTC day", () => {
  assert.equal(pacificDate(at("2026-11-13T05:00:00Z")), "2026-11-12"); // Thu 9:00 PM PST
  assert.equal(pacificDate(at("2026-11-13T08:30:00Z")), "2026-11-13"); // Fri 12:30 AM PST
  assert.equal(pacificDate(at("2027-07-01T06:59:59Z")), "2027-06-30"); // Wed 11:59 PM PDT
  assert.equal(pacificDate(at("2027-07-01T07:00:00Z")), "2027-07-01"); // Thu 12:00 AM PDT
});

test("Monday before 7:00 AM, a market day: today at 7:00 AM", () => {
  const now = at("2026-11-09T13:00:00Z"); // Mon 5:00 AM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-09T15:00:00Z"));
});

test("Monday 6:31 AM, when the morning job runs: today at 7:00 AM", () => {
  const now = at("2026-11-09T14:31:04Z"); // Mon 6:31 AM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-09T15:00:00Z"));
});

test("exactly 7:00 AM on a market day is no longer before it: the next market day", () => {
  const now = at("2026-11-09T15:00:00Z"); // Mon 7:00:00 AM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-10T15:00:00Z"));
});

test("Monday noon: Tuesday at 7:00 AM", () => {
  const now = at("2026-11-09T20:00:00Z"); // Mon 12:00 PM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-10T15:00:00Z"));
});

test("Thursday noon, next market Monday (4 days, more than 3): Friday at 7:00 AM for the 'back on' card", () => {
  const now = at("2026-11-12T20:00:00Z"); // Thu 12:00 PM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-13T15:00:00Z"));
});

test("Thursday late evening is still Thursday in Pacific: Friday at 7:00 AM", () => {
  const now = at("2026-11-13T07:30:00Z"); // Thu 11:30 PM PST, already Friday in UTC
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-13T15:00:00Z"));
});

test("a gap of exactly 3 days is not a holiday gap: straight to the next market day", () => {
  const now = at("2026-11-13T20:00:00Z"); // Fri 12:00 PM PST, a market day here
  const marketDates = ["2026-11-13", "2026-11-16"]; // Friday, then Monday
  assert.equal(nextWake({ now, marketDates }), seconds("2026-11-16T15:00:00Z"));
});

test("Friday noon, no market today: Monday at 7:00 AM", () => {
  const now = at("2026-11-13T20:00:00Z"); // Fri 12:00 PM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-16T15:00:00Z"));
});

test("Friday 6:31 AM, no market today: Monday at 7:00 AM, not this morning", () => {
  const now = at("2026-11-13T14:31:00Z"); // Fri 6:31 AM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-16T15:00:00Z"));
});

test("Saturday: Monday at 7:00 AM", () => {
  const now = at("2026-11-14T18:00:00Z"); // Sat 10:00 AM PST
  assert.equal(nextWake({ now, marketDates: WEEK }), seconds("2026-11-16T15:00:00Z"));
});

test("market days before today are ignored, and the list need not be sorted", () => {
  const now = at("2026-11-14T18:00:00Z"); // Sat 10:00 AM PST
  const marketDates = ["2026-11-17", "2026-11-12", "2026-11-16", "2026-11-09"];
  assert.equal(nextWake({ now, marketDates }), seconds("2026-11-16T15:00:00Z"));
});

test("holiday gap: from the last market day, the morning after", () => {
  const marketDates = ["2026-12-16", "2026-12-17", "2027-01-04", "2027-01-05"];
  const now = at("2026-12-17T20:00:00Z"); // Thu 17 Dec, 12:00 PM PST
  assert.equal(nextWake({ now, marketDates }), seconds("2026-12-18T15:00:00Z"));
});

test("holiday gap: the next market is 17 days out, so look again in seven days", () => {
  // Decided: a wake more than 14 days away is not allowed, and nothing is published nearer, so the answer is
  // rule 4's "seven days from today at 7:00 AM" (25 Dec), not a wake clamped to exactly 14 days.
  const marketDates = ["2026-12-16", "2026-12-17", "2027-01-04", "2027-01-05"];
  const now = at("2026-12-18T20:00:00Z"); // Fri 18 Dec, 12:00 PM PST
  assert.equal(nextWake({ now, marketDates }), seconds("2026-12-25T15:00:00Z"));
});

test("holiday gap: once the next market is within 14 days, it is the answer", () => {
  const marketDates = ["2027-01-04", "2027-01-05"];
  const now = at("2026-12-25T20:00:00Z"); // Fri 25 Dec, 12:00 PM PST: 4 Jan is 10 days out
  assert.equal(nextWake({ now, marketDates }), seconds("2027-01-04T15:00:00Z"));
});

test("a market exactly 14 days out counts only when its 7:00 AM is within 14 days of now", () => {
  const marketDates = ["2026-11-28"];
  // Sat 14 Nov, 8:00 AM PST: 7:00 AM on the 28th is 13 days 23 hours away.
  assert.equal(nextWake({ now: at("2026-11-14T16:00:00Z"), marketDates }), seconds("2026-11-28T15:00:00Z"));
  // Sat 14 Nov, 6:00 AM PST: it is 14 days 1 hour away, so look again in seven days.
  assert.equal(nextWake({ now: at("2026-11-14T14:00:00Z"), marketDates }), seconds("2026-11-21T15:00:00Z"));
});

test("an empty list: seven days from today at 7:00 AM", () => {
  const now = at("2026-11-12T20:00:00Z"); // Thu 12:00 PM PST
  assert.equal(nextWake({ now, marketDates: [] }), seconds("2026-11-19T15:00:00Z"));
  assert.equal(nextWake({ now }), seconds("2026-11-19T15:00:00Z"));
});

test("an empty list before 7:00 AM: still seven days out, not this morning", () => {
  const now = at("2026-11-12T14:31:00Z"); // Thu 6:31 AM PST
  assert.equal(nextWake({ now, marketDates: [] }), seconds("2026-11-19T15:00:00Z"));
});

test("a market today with nothing published after it: the morning after", () => {
  const now = at("2026-11-12T20:00:00Z"); // Thu 12:00 PM PST
  assert.equal(nextWake({ now, marketDates: ["2026-11-12"] }), seconds("2026-11-13T15:00:00Z"));
});

test("spring forward, Sunday 14 March 2027: 7:00 AM moves from 15:00 to 14:00 UTC", () => {
  const marketDates = ["2027-03-11", "2027-03-12", "2027-03-14", "2027-03-15"];
  // Thu 11 Mar, 12:00 PM PST: tomorrow is a market day, still on standard time.
  assert.equal(nextWake({ now: at("2027-03-11T20:00:00Z"), marketDates }), seconds("2027-03-12T15:00:00Z"));
  // Fri 12 Mar, 12:00 PM PST: the next market is the Sunday of the change itself, 7:00 AM PDT.
  assert.equal(nextWake({ now: at("2027-03-12T20:00:00Z"), marketDates }), seconds("2027-03-14T14:00:00Z"));
  // Sun 14 Mar, 4:00 AM PDT (an hour after the change), a market day: today at 7:00 AM PDT.
  assert.equal(nextWake({ now: at("2027-03-14T11:00:00Z"), marketDates }), seconds("2027-03-14T14:00:00Z"));
  // Sun 14 Mar, 12:00 PM PDT: Monday at 7:00 AM PDT.
  assert.equal(nextWake({ now: at("2027-03-14T19:00:00Z"), marketDates }), seconds("2027-03-15T14:00:00Z"));
});

test("spring forward: a Friday to Monday wake across the change lands on 7:00 AM PDT", () => {
  const marketDates = ["2027-03-12", "2027-03-15"];
  const now = at("2027-03-12T20:00:00Z"); // Fri 12 Mar, 12:00 PM PST
  assert.equal(nextWake({ now, marketDates }), seconds("2027-03-15T14:00:00Z"));
});

test("fall back, Sunday 7 November 2027: 7:00 AM moves from 14:00 to 15:00 UTC", () => {
  const marketDates = ["2027-11-04", "2027-11-05", "2027-11-07", "2027-11-08"];
  // Thu 4 Nov, 12:00 PM PDT: tomorrow is a market day, still on daylight time.
  assert.equal(nextWake({ now: at("2027-11-04T19:00:00Z"), marketDates }), seconds("2027-11-05T14:00:00Z"));
  // Fri 5 Nov, 12:00 PM PDT: the next market is the Sunday of the change itself, 7:00 AM PST.
  assert.equal(nextWake({ now: at("2027-11-05T19:00:00Z"), marketDates }), seconds("2027-11-07T15:00:00Z"));
  // Sun 7 Nov, 1:30 AM PST (the second 1:30 that night), a market day: today at 7:00 AM PST.
  assert.equal(nextWake({ now: at("2027-11-07T09:30:00Z"), marketDates }), seconds("2027-11-07T15:00:00Z"));
  // Sun 7 Nov, 12:00 PM PST: Monday at 7:00 AM PST.
  assert.equal(nextWake({ now: at("2027-11-07T20:00:00Z"), marketDates }), seconds("2027-11-08T15:00:00Z"));
});

test("fall back: a Friday to Monday wake across the change lands on 7:00 AM PST", () => {
  const marketDates = ["2027-11-05", "2027-11-08"];
  const now = at("2027-11-05T19:00:00Z"); // Fri 5 Nov, 12:00 PM PDT
  assert.equal(nextWake({ now, marketDates }), seconds("2027-11-08T15:00:00Z"));
});

test("now must be a valid Date", () => {
  assert.throws(() => nextWake({ now: "2026-11-12", marketDates: [] }), TypeError);
  assert.throws(() => nextWake({ now: new Date(NaN), marketDates: [] }), TypeError);
});

test("every result is an integer, after now, at most 14 days out, and 7:00 AM Pacific", () => {
  // Markets Monday to Thursday from November 2026 to the end of 2027, with a break from 18 Dec to 3 Jan.
  const marketDates = [];
  for (let t = Date.UTC(2026, 10, 1); t < Date.UTC(2028, 0, 1); t += DAY * 1000) {
    const date = new Date(t);
    const day = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const holiday = day >= "2026-12-18" && day <= "2027-01-03";
    if (weekday >= 1 && weekday <= 4 && !holiday) marketDates.push(day);
  }
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const lists = { "a full calendar": marketDates, "an empty list": [] };
  // Every 173 minutes for 13 months, so both clock changes of 2027 and every time of day are covered.
  const step = 173 * 60 * 1000;
  let checked = 0;
  for (const [name, list] of Object.entries(lists)) {
    for (let t = Date.UTC(2026, 10, 1); t < Date.UTC(2027, 11, 1); t += step) {
      const now = new Date(t);
      const wake = nextWake({ now, marketDates: list });
      const where = `${name}, now ${now.toISOString()}, wake ${wake}`;
      assert.ok(Number.isInteger(wake), `integer: ${where}`);
      assert.ok(wake > t / 1000, `after now: ${where}`);
      assert.ok(wake - t / 1000 <= 14 * DAY, `at most 14 days out: ${where}`);
      assert.equal(clock.format(new Date(wake * 1000)), "07:00:00", `7:00 AM Pacific: ${where}`);
      checked++;
    }
  }
  assert.ok(checked > 6000);
});

test("with a full calendar the truck never waits past a market morning", () => {
  // From any moment, the wake is no later than 7:00 AM on the next market day that is still to open.
  const marketDates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-16", "2026-11-17"];
  const opens = marketDates.map((day) => Date.parse(`${day}T15:00:00Z`) / 1000); // 7:00 AM PST
  for (let t = Date.UTC(2026, 10, 8, 8); t < Date.UTC(2026, 10, 17, 15); t += 23 * 60 * 1000) {
    const wake = nextWake({ now: new Date(t), marketDates });
    const nextOpen = opens.find((open) => open > t / 1000);
    assert.ok(wake <= nextOpen, `now ${new Date(t).toISOString()}: wake ${wake} is after the market at ${nextOpen}`);
  }
});

// publishedWake: what the morning job writes into status.json. The truck reads it at 7:00 AM, so it must name
// the wake after this morning's, never this morning's own.

test("published, Monday 6:31 AM with markets Monday to Thursday: Tuesday at 7:00 AM, not this morning", () => {
  const now = at("2026-11-09T14:31:04Z"); // Mon 6:31 AM PST
  assert.equal(publishedWake({ now, marketDates: WEEK }), seconds("2026-11-10T15:00:00Z"));
});

test("published, Thursday 6:31 AM with the next market on Monday: Friday at 7:00 AM for the 'back on' card", () => {
  const now = at("2026-11-12T14:31:04Z"); // Thu 6:31 AM PST
  assert.equal(publishedWake({ now, marketDates: WEEK }), seconds("2026-11-13T15:00:00Z"));
});

test("published, Friday 6:31 AM, no market today: Monday at 7:00 AM", () => {
  const now = at("2026-11-13T14:31:04Z"); // Fri 6:31 AM PST
  assert.equal(publishedWake({ now, marketDates: WEEK }), seconds("2026-11-16T15:00:00Z"));
});

test("published, a late job on Monday at 7:20 AM: Tuesday at 7:00 AM", () => {
  const now = at("2026-11-09T15:20:00Z"); // Mon 7:20 AM PST
  assert.equal(publishedWake({ now, marketDates: WEEK }), seconds("2026-11-10T15:00:00Z"));
});

test("published, any time on a market Monday gives Tuesday at 7:00 AM", () => {
  const tuesday = seconds("2026-11-10T15:00:00Z");
  assert.equal(publishedWake({ now: at("2026-11-09T08:30:00Z"), marketDates: WEEK }), tuesday); // Mon 12:30 AM PST
  assert.equal(publishedWake({ now: at("2026-11-09T15:00:00Z"), marketDates: WEEK }), tuesday); // Mon 7:00:00 AM
  assert.equal(publishedWake({ now: at("2026-11-09T15:00:01Z"), marketDates: WEEK }), tuesday); // Mon 7:00:01 AM
  assert.equal(publishedWake({ now: at("2026-11-10T07:59:00Z"), marketDates: WEEK }), tuesday); // Mon 11:59 PM
});

test("published, holiday gap: the last market morning sends the truck to the morning after", () => {
  const marketDates = ["2026-12-16", "2026-12-17", "2027-01-04", "2027-01-05"];
  const now = at("2026-12-17T14:31:00Z"); // Thu 17 Dec, 6:31 AM PST
  assert.equal(publishedWake({ now, marketDates }), seconds("2026-12-18T15:00:00Z"));
});

test("published, holiday gap: the morning after, with the next market 17 days out, look again in seven days", () => {
  const marketDates = ["2026-12-16", "2026-12-17", "2027-01-04", "2027-01-05"];
  const now = at("2026-12-18T14:31:00Z"); // Fri 18 Dec, 6:31 AM PST
  assert.equal(publishedWake({ now, marketDates }), seconds("2026-12-25T15:00:00Z"));
});

test("published, an empty list at 6:31 AM: seven days from today at 7:00 AM", () => {
  const now = at("2026-11-12T14:31:00Z"); // Thu 6:31 AM PST
  assert.equal(publishedWake({ now, marketDates: [] }), seconds("2026-11-19T15:00:00Z"));
  assert.equal(publishedWake({ now }), seconds("2026-11-19T15:00:00Z"));
});

test("published, a market exactly 14 days out counts: the 14 days run from this morning's 7:00 AM", () => {
  // nextWake at 6:31 AM calls this 14 days 29 minutes away and falls back to seven days. The truck reads the
  // file at 7:00 AM, when it is 14 days away, so the published value is the market morning itself.
  const marketDates = ["2026-11-28"];
  const now = at("2026-11-14T14:31:00Z"); // Sat 14 Nov, 6:31 AM PST
  assert.equal(nextWake({ now, marketDates }), seconds("2026-11-21T15:00:00Z"));
  assert.equal(publishedWake({ now, marketDates }), seconds("2026-11-28T15:00:00Z"));
});

test("published, spring forward weekend (Sunday 14 March 2027)", () => {
  const marketDates = ["2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15"];
  // Fri 12 Mar, 6:31 AM PST: Saturday at 7:00 AM PST.
  assert.equal(publishedWake({ now: at("2027-03-12T14:31:00Z"), marketDates }), seconds("2027-03-13T15:00:00Z"));
  // Sat 13 Mar, 6:31 AM PST: Sunday at 7:00 AM PDT, which is only 23 hours 29 minutes later.
  assert.equal(publishedWake({ now: at("2027-03-13T14:31:00Z"), marketDates }), seconds("2027-03-14T14:00:00Z"));
  // Sun 14 Mar, 6:31 AM PDT: Monday at 7:00 AM PDT.
  assert.equal(publishedWake({ now: at("2027-03-14T13:31:00Z"), marketDates }), seconds("2027-03-15T14:00:00Z"));
  // Fri 12 Mar, 6:31 AM PST with no weekend markets: Monday at 7:00 AM PDT.
  assert.equal(
    publishedWake({ now: at("2027-03-12T14:31:00Z"), marketDates: ["2027-03-12", "2027-03-15"] }),
    seconds("2027-03-15T14:00:00Z"),
  );
});

test("published, fall back weekend (Sunday 7 November 2027)", () => {
  const marketDates = ["2027-11-05", "2027-11-06", "2027-11-07", "2027-11-08"];
  // Fri 5 Nov, 6:31 AM PDT: Saturday at 7:00 AM PDT.
  assert.equal(publishedWake({ now: at("2027-11-05T13:31:00Z"), marketDates }), seconds("2027-11-06T14:00:00Z"));
  // Sat 6 Nov, 6:31 AM PDT: Sunday at 7:00 AM PST, 25 hours 29 minutes later.
  assert.equal(publishedWake({ now: at("2027-11-06T13:31:00Z"), marketDates }), seconds("2027-11-07T15:00:00Z"));
  // Sun 7 Nov, 6:31 AM PST: Monday at 7:00 AM PST.
  assert.equal(publishedWake({ now: at("2027-11-07T14:31:00Z"), marketDates }), seconds("2027-11-08T15:00:00Z"));
  // Fri 5 Nov, 6:31 AM PDT with no weekend markets: Monday at 7:00 AM PST.
  assert.equal(
    publishedWake({ now: at("2027-11-05T13:31:00Z"), marketDates: ["2027-11-05", "2027-11-08"] }),
    seconds("2027-11-08T15:00:00Z"),
  );
});

test("published, from a 6:31 AM run the wake is at least 24 h 29 min away, or 23 h 29 min across spring forward", () => {
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Every day from November 2026 to the end of 2027, and three calendars: a market every day (the shortest
  // waits there can be), markets Monday to Thursday with a winter break, and nothing published.
  const everyDay = [];
  const weekdays = [];
  for (let t = Date.UTC(2026, 10, 1); t < Date.UTC(2028, 0, 15); t += DAY * 1000) {
    const date = new Date(t);
    const day = date.toISOString().slice(0, 10);
    everyDay.push(day);
    const holiday = day >= "2026-12-18" && day <= "2027-01-03";
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 4 && !holiday) weekdays.push(day);
  }
  const lists = { "a market every day": everyDay, "Monday to Thursday": weekdays, "an empty list": [] };
  const USUAL = 24 * 3600 + 29 * 60; // 6:31 AM to 7:00 AM the next day
  const SPRING = 23 * 3600 + 29 * 60; // the same, on the 23 hour day
  for (const [name, list] of Object.entries(lists)) {
    let shortest = Infinity;
    let shortestDay = null;
    let runs = 0;
    for (let t = Date.UTC(2026, 10, 1); t < Date.UTC(2027, 11, 31); t += DAY * 1000) {
      // 6:31 AM Pacific is 14:31 UTC on standard time and 13:31 UTC on daylight time.
      const now = [13, 14]
        .map((hour) => new Date(t + (hour * 60 + 31) * 60 * 1000))
        .find((candidate) => clock.format(candidate) === "06:31:00");
      assert.ok(now, `a 6:31 AM on ${new Date(t).toISOString().slice(0, 10)}`);
      const wake = publishedWake({ now, marketDates: list });
      const wait = wake - now.getTime() / 1000;
      const where = `${name}, now ${now.toISOString()}, wake ${wake}`;
      assert.ok(Number.isInteger(wake), `integer: ${where}`);
      assert.equal(clock.format(new Date(wake * 1000)), "07:00:00", `7:00 AM Pacific: ${where}`);
      assert.ok(wait <= 14 * DAY + 29 * 60, `at most 14 days after this morning's 7:00 AM: ${where}`);
      assert.ok(wake >= nextWake({ now, marketDates: list }), `never before nextWake: ${where}`);
      const day = pacificDate(now);
      assert.ok(wait >= (day === "2027-03-13" ? SPRING : USUAL), `long enough: ${where}`);
      if (wait < shortest) [shortest, shortestDay] = [wait, day];
      runs++;
    }
    assert.ok(runs > 420);
    if (name === "a market every day") {
      // The actual minimum: 23 hours 29 minutes (84,540 seconds), from the Saturday before the clocks go forward.
      assert.equal(shortest, SPRING);
      assert.equal(shortestDay, "2027-03-13");
    }
  }
});

test("published, once 7:00 AM has passed it is the same as nextWake", () => {
  for (let t = Date.UTC(2026, 10, 8, 8); t < Date.UTC(2026, 10, 18, 8); t += 41 * 60 * 1000) {
    const now = new Date(t);
    const plain = nextWake({ now, marketDates: WEEK });
    const published = publishedWake({ now, marketDates: WEEK });
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit" }).format(now));
    if (hour >= 7) assert.equal(published, plain, `now ${now.toISOString()}`);
    else assert.ok(published >= plain, `now ${now.toISOString()}`);
    assert.ok(published > t / 1000);
  }
});

test("published, now must be a valid Date", () => {
  assert.throws(() => publishedWake({ now: "2026-11-12", marketDates: [] }), TypeError);
  assert.throws(() => publishedWake({ now: new Date(NaN), marketDates: [] }), TypeError);
});
