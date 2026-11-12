/*
  Today's trucks, laid out for the truck's 800 x 480 six-colour screen.
  The agreement with the other parts is docs/software/CONTRACT.md ("today.json" and "The page").

  index.html?screen=1            exactly 800 x 480 at the top-left (what the renderer photographs)
  index.html                     the same picture, scaled to fit the window
  index.html?data=<file>         read <file> instead of today.json

  When the picture is drawn, <html data-ready="1"> is set.
*/
(function () {
  "use strict";

  var STAGE_W = 800;
  var STAGE_H = 480;
  var LIST_H = 304; // the body, y 128 to 432
  var MAX_ROWS = 6;
  var FETCH_TIMEOUT_MS = 15000;

  // Sizes in pixels for each number of rows. "name" shrinks towards "nameMin" when it is too long, then is cut
  // with an ellipsis. Four rows is the full size; fewer rows are bigger; five and six put the food beside the name.
  var SIZES = {
    1: { layout: "wide", name: 96, nameMin: 48, food: 40, hours: 32, block: 64 },
    2: { layout: "wide", name: 60, nameMin: 36, food: 30, hours: 26, block: 50 },
    3: { layout: "stack", name: 46, nameMin: 28, food: 24, hours: 26, block: 54 },
    4: { layout: "stack", name: 36, nameMin: 26, food: 22, hours: 24, block: 48 },
    5: { layout: "line", name: 34, nameMin: 24, food: 24, hours: 24, block: 42 },
    6: { layout: "line", name: 30, nameMin: 24, food: 22, hours: 22, block: 36 }
  };
  var SMALLEST = 22; // nothing that has to be read from across a desk goes under this
  var HOURS_COLOURS = 3; // red, blue, green: .c0, .c1, .c2

  var root = document.documentElement;
  var params = new URLSearchParams(location.search);
  var screenMode = params.get("screen") === "1";
  if (screenMode) root.classList.add("screen");

  var stage, body;

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Text from the data, as it is: a string (or a number), trimmed. Anything else is "".
  function str(value) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && isFinite(value)) return String(value);
    return "";
  }

  function tooWide(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().width > node.getBoundingClientRect().width + 0.01;
  }

  // Sets the largest whole font size from max down to min at which the node's text fits its box on one line.
  // At min the text may still be too wide; the "fit" class then cuts it with an ellipsis.
  function fit(node, max, min) {
    var size = max;
    node.style.fontSize = size + "px";
    while (size > min && tooWide(node)) {
      size -= 1;
      node.style.fontSize = size + "px";
    }
    return size;
  }

  // The same, for lines that must share one size.
  function fitTogether(nodes, max, min) {
    var size = max;
    nodes.forEach(function (node) {
      size = Math.min(size, fit(node, max, min));
    });
    nodes.forEach(function (node) {
      node.style.fontSize = size + "px";
    });
  }

  function drawTrucks(trucks, hoursLabel) {
    var shown = trucks;
    var more = 0;
    if (trucks.length > MAX_ROWS) {
      shown = trucks.slice(0, MAX_ROWS - 1);
      more = trucks.length - shown.length;
    }
    var rowCount = shown.length + (more ? 1 : 0);
    var sizes = SIZES[rowCount];
    var rowHeight = Math.floor(LIST_H / rowCount);

    var list = make("div", "list layout-" + sizes.layout);
    body.appendChild(list);

    shown.forEach(function (truck, index) {
      var row = make("div", "row");
      row.style.height = rowHeight + "px";
      var text = make("div", "text");
      var name = make("div", "name fit", truck.name);
      text.appendChild(name);
      var food = null;
      if (truck.food) {
        food = make("div", "food fit", truck.food);
        text.appendChild(food);
      }
      row.appendChild(text);
      var hoursText = null;
      if (hoursLabel) {
        var hours = make("div", "hours c" + (index % HOURS_COLOURS));
        hours.style.height = sizes.block + "px";
        hoursText = make("div", "hours-text fit", hoursLabel);
        hours.appendChild(hoursText);
        row.appendChild(hours);
      }
      list.appendChild(row);

      // The hours block first: its width decides how much room the name has.
      if (hoursText) fit(hoursText, sizes.hours, SMALLEST);
      fit(name, sizes.name, sizes.nameMin);
      if (food) {
        fit(food, sizes.food, SMALLEST);
        // Beside a long name there may be room for only a scrap of the food: leave it out instead.
        if (sizes.layout === "line" && tooWide(food) && food.getBoundingClientRect().width < 120) {
          text.removeChild(food);
        }
      }
    });

    if (more) {
      var moreRow = make("div", "row");
      moreRow.style.height = rowHeight + "px";
      var moreText = make("div", "text");
      var moreName = make("div", "name fit", "+" + more + " more");
      moreText.appendChild(moreName);
      moreRow.appendChild(moreText);
      list.appendChild(moreRow);
      fit(moreName, sizes.name, sizes.nameMin);
    }
  }

  function drawNoMarket(headline, nextLabel) {
    var card = make("div", "card card-none");
    var big = make("div", "card-big fit", headline);
    card.appendChild(big);
    card.appendChild(make("div", "card-bar"));
    var backText = null;
    if (nextLabel) {
      var back = make("div", "card-back");
      backText = make("div", "fit", "Back " + nextLabel);
      back.appendChild(backText);
      card.appendChild(back);
    }
    body.appendChild(card);
    fit(big, 80, 40);
    if (backText) fit(backText, 40, SMALLEST);
  }

  function drawError() {
    var card = make("div", "card card-error");
    var first = make("div", "card-big fit", "Couldn’t read the");
    var second = make("div", "card-big fit", "truck list today");
    var small = make("div", "card-small fit", "Check the page on your phone");
    card.appendChild(first);
    card.appendChild(second);
    card.appendChild(make("div", "card-bar"));
    card.appendChild(small);
    body.appendChild(card);
    fitTogether([first, second], 62, 36);
    fit(small, 34, SMALLEST);
  }

  function draw(data) {
    if (!data || typeof data !== "object") data = {};

    // Measure at true size, with nothing cut: the scale goes back on at the end.
    stage.style.transform = "none";
    stage.classList.add("measuring");

    var title = document.getElementById("title");
    var date = document.getElementById("date");
    var updated = document.getElementById("updated");
    var url = document.getElementById("url");
    date.textContent = str(data.dateLabel);
    updated.textContent = str(data.updatedLabel);
    url.textContent = str(data.pageUrl);
    body.textContent = "";

    var trucks = (Array.isArray(data.trucks) ? data.trucks : [])
      .map(function (truck) {
        return truck && typeof truck === "object"
          ? { name: str(truck.name), food: str(truck.food) }
          : { name: str(truck), food: "" };
      })
      .filter(function (truck) {
        return truck.name !== "";
      });
    var market = data.market && typeof data.market === "object" ? data.market : {};
    var next = data.next && typeof data.next === "object" ? data.next : {};

    var state = "error";
    if (data.state === "market" && trucks.length > 0) {
      state = "market";
      drawTrucks(trucks, str(market.hoursLabel));
    } else if (data.state === "market") {
      // A market with nothing on its list: not in the contract, so say exactly that.
      state = "no-market";
      drawNoMarket("No trucks listed today", "");
    } else if (data.state === "no-market") {
      state = "no-market";
      drawNoMarket("No market today", str(next.label));
    } else {
      drawError();
    }
    root.dataset.state = state;

    fit(title, 48, 30);
    fit(date, 30, SMALLEST);
    fit(url, 22, 16); // read close up, on the way to typing it: a smaller whole address beats a cut one

    stage.classList.remove("measuring");
    scaleStage();
  }

  function scaleStage() {
    if (screenMode) {
      stage.style.transform = "";
      return;
    }
    var width = root.clientWidth || window.innerWidth;
    var height = root.clientHeight || window.innerHeight;
    var scale = Math.min(width / STAGE_W, height / STAGE_H);
    if (!(scale > 0)) scale = 1;
    stage.style.transform = "scale(" + scale + ")";
  }

  function load() {
    var file = params.get("data") || "today.json";
    var options = { cache: "no-store" };
    var timer = null;
    if (typeof AbortController === "function") {
      var controller = new AbortController();
      options.signal = controller.signal;
      timer = setTimeout(function () {
        controller.abort();
      }, FETCH_TIMEOUT_MS);
    }
    return fetch(file, options)
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not a today.json object");
        return data;
      })
      .catch(function (error) {
        return { state: "error", error: String((error && error.message) || error) };
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data;
      });
  }

  function start() {
    stage = document.getElementById("stage");
    body = document.getElementById("body");
    scaleStage();
    if (!screenMode) window.addEventListener("resize", scaleStage);

    var fontsReady =
      document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(function () {})
        : Promise.resolve();

    Promise.all([load(), fontsReady]).then(function (results) {
      try {
        draw(results[0]);
      } catch (error) {
        try {
          draw({ state: "error" });
        } catch (ignored) {
          // Nothing more to try: the renderer still gets its signal, and photographs what there is.
        }
      }
      root.dataset.ready = "1";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
