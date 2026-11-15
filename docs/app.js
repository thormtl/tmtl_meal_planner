// Ugens madplan: pick a dinner per day, tick weekly basics, download an agent-readable shopping list.
// Everything runs in the browser; nothing is sent anywhere. Choices are remembered on this device only.
"use strict";

const $ = (s) => document.querySelector(s);
const kr = (n) => n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
const lower = (s) => s.toLowerCase();
const kr0 = (n) => Math.round(n).toLocaleString("da-DK") + " kr";

let plan, state;
const KEY = () => "madplan:" + plan.week;
const save = () => { try { localStorage.setItem(KEY(), JSON.stringify(state)); } catch {} };

let current = null;   // this week's plan.json week; older weeks come from plans/<week>.json
let justSaved = false; // after a download the bar shows where the file goes, until the next change

async function init() {
  const latest = await (await fetch("plan.json", { cache: "no-store" })).json();
  current = latest.week;
  const want = new URLSearchParams(location.search).get("uge");
  plan = latest;
  if (want && /^\d{4}-W\d{2}$/.test(want) && want !== current) {
    try { plan = await (await fetch(`plans/${want}.json`, { cache: "no-store" })).json(); } catch { plan = latest; }
  }
  await weekMenu();
  const old = plan.week !== current;
  $("#old").hidden = !old;
  $("#save").disabled = old;
  $("#save").textContent = old ? "Kun inspiration" : "Hent indkøbsliste";
  let saved = null, seen = false;
  try { saved = JSON.parse(localStorage.getItem(KEY()) || "null"); seen = Object.keys(localStorage).some((k) => k.startsWith("madplan:")); } catch {}
  $("#steps").open = !seen;
  state = saved || {
    pick: plan.days.map(() => 0),
    basics: plan.basics.map((b) => ({ on: true, choice: 0, qty: b.qty })),
    pantry: {},
  };
  $("#meta").textContent = `7 aftener børnene kan lide · ${plan.persons} personer`;
  $("#listwrap").addEventListener("toggle", (e) => { state.listOpen = e.target.open; save(); });
  if (state.listOpen) $("#listwrap").open = true;
  render();
}

async function weekMenu() {
  let weeks = [{ week: current, dinners: [] }];
  try {
    const idx = await (await fetch("plans/index.json", { cache: "no-store" })).json();
    if (Array.isArray(idx.weeks) && idx.weeks.length) weeks = idx.weeks;
  } catch {}
  if (!weeks.some((w) => w.week === current)) weeks.unshift({ week: current, dinners: [] });
  const sel = $("#week");
  sel.replaceChildren(...weeks.map((w) => el("option", { value: w.week, ...(w.week === plan.week ? { selected: "" } : {}),
    title: (w.dinners || []).join(", ") }, `${w.week.split("-W")[1]} (${w.week.slice(0, 4)})${w.week === current ? " · denne uge" : ""}`)));
  sel.onchange = () => {
    const u = new URL(location.href);
    if (sel.value === current) u.searchParams.delete("uge"); else u.searchParams.set("uge", sel.value);
    location.href = u.toString();
  };
}

// Re-rendering replaces the DOM; keep keyboard / screen-reader focus on the same control (data-key).
function render(keepSaved = false) {
  if (!keepSaved) justSaved = false;
  const key = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
  renderWeek(); renderDays(); renderBasics(); renderPantry(); renderList();
  if (key) { const n = document.querySelector(`[data-key="${key}"]`); if (n) n.focus({ preventScroll: true }); }
}
const changed = () => { save(); render(); };

const ART = { pasta: "pasta", burger: "burger", pizza: "pizza", fisk: "fisk", kylling: "kylling",
  "tex-mex": "texmex", dansk: "dansk", andet: "andet" };
const art = (m) => `img/dish-${ART[m.family] || "andet"}.webp`;

// real dish photo (BilkaToGo) when there is one; small versions via the image CDN's width parameter
const photoUrl = (m, w) => (m.image ? m.image.replace(/\/w_\d+,/, `/w_${w},`) : null);
const thumb = (m) => photoUrl(m, 200) || art(m);

function photoOf(m, i, extra) {
  const hasImg = !!m.image;
  return el("div", { class: "photo" },
    hasImg
      ? el("img", { class: "dish-photo", src: photoUrl(m, 800), alt: m.name, loading: i < 2 ? "eager" : "lazy", referrerpolicy: "no-referrer",
          on: { error: (e) => { const ph = e.target.parentNode; e.target.replaceWith(el("div", { class: "art-only" }, el("img", { src: art(m), alt: "" })));
            const b = ph.querySelector(".badge-art"); if (b) b.remove(); ph.closest(".day")?.classList.remove("has-badge"); } } })
      : el("div", { class: "art-only" }, el("img", { src: art(m), alt: "" })),
    el("span", { class: "daytag" }, plan.days[i].day),
    extra || "",
    hasImg ? el("span", { class: "badge-art" }, el("img", { src: art(m), alt: "" })) : "");
}

function renderWeek() {
  $("#weekstrip").replaceChildren(...plan.days.map((d, i) => {
    const cov = covered(i), m = cov ? dishFor(i - 1) : dishFor(i);
    return el("a", { href: `#day-${i}`, class: (cov ? "covered" : "") + (mult(i) > 1 ? " doubled" : ""),
      "aria-label": `${d.day}: ${cov ? "rester" : m.name}` },
      el("img", { src: thumb(m), alt: "", referrerpolicy: "no-referrer", loading: "lazy" }), d.day.slice(0, 3));
  }));
}

function swapTile(m, attrs) {
  return el("button", { title: m.name, ...attrs },
    el("img", { src: thumb(m), alt: "", referrerpolicy: "no-referrer", loading: "lazy" }), el("span", {}, m.name));
}

function renderDays() {
  const root = $("#days"); root.replaceChildren();
  const moved = displaced();
  plan.days.forEach((d, i) => {
    if (covered(i)) {   // this day eats yesterday's leftovers: slim card, nothing is bought
      const src = dishFor(i - 1), mine = own(i), prev = lower(plan.days[i - 1].day);
      root.append(el("article", { id: `day-${i}`, class: "day covered" },
        photoOf(src, i, el("span", { class: "leftover-tag" }, `🍲 Rester fra ${prev}`)),
        el("div", { class: "body" },
          el("h3", {}, `Rester: ${src.name}`),
          el("p", { class: "hint" }, `${mine.name} købes ikke ind. Vil I stadig have den? Vælg den en anden dag under »Lån fra ${lower(d.day)}«.`),
          el("button", { class: "linkbtn", "data-key": `day${i}-undo`, on: { click: () => setLeftover(i - 1, false) } },
            `Fortryd: lav ${lower(mine.name)} ${lower(d.day)} alligevel`))));
      return;
    }
    const m = dishFor(i), x = mult(i), saving = dishSaving(m, x);
    const next = i < plan.days.length - 1 ? lower(plan.days[i + 1].day) : null;
    const lo = next ? el("button", { class: "lo-btn", "data-key": `day${i}-lo`, "aria-pressed": String(!!LO()[i]),
      title: `Lav dobbelt portion, så ${next} er rester.`, on: { click: () => setLeftover(i, !LO()[i]) } },
      LO()[i] ? `✓ Dobbelt · rester ${next}` : `🍲 Lav dobbelt`) : "";
    const b = BR()[i];
    const ownBtns = d.options.map((o, j) => [o, j]).filter(([, j]) => b || j !== state.pick[i]).map(([o, j]) =>
      swapTile(o, { "data-key": `day${i}-opt${j}`, "aria-pressed": "false",
        on: { click: () => { state.pick[i] = j; delete BR()[i]; changed(); } } }));
    // all dinners of a leftover day can be borrowed by any other day (also the one cooking double: then that dish is doubled)
    const borrowBoxes = [...new Set(moved.map((mv) => mv.d))].filter((dd) => dd !== i).map((dd) => {
      const mine = moved.filter((mv) => mv.d === dd), active = !!b && b.d === dd;
      return el("details", { class: "borrowbox", ...(active ? { open: "" } : {}) },
        el("summary", { "data-key": `day${i}-borrowbox${dd}` }, `Lån fra ${lower(plan.days[dd].day)} (${mine.length} retter)`),
        el("div", { class: "swaps" }, ...mine.map((mv) => swapTile(mv.m, { class: "borrow", "data-key": `day${i}-borrow${mv.d}-${mv.o}`,
          "aria-pressed": String(active && b.o === mv.o), on: { click: () => { BR()[i] = { d: mv.d, o: mv.o }; changed(); } } }))));
    });
    root.append(el("article", { id: `day-${i}`, class: "day" + (x > 1 ? " doubled" : "") + (m.image ? " has-badge" : "") },
      photoOf(m, i),
      el("div", { class: "body" },
        el("h3", {}, m.name, m.kid >= 3 ? el("span", { class: "fav", title: "Børnefavorit", "aria-label": "Børnefavorit" }, "♥") : ""),
        el("p", { class: "facts" }, `${m.time || "?"} · ca. ${kr0(m.cost * x)}${x > 1 ? " (dobbelt)" : ""}`,
          saving >= 0.5 ? el("span", { class: "pill offer" }, `spar ${kr0(saving)}`) : ""),
        el("div", { class: "actions" },
          m.url ? el("a", { class: "recipe", href: m.url, target: "_blank", rel: "noopener noreferrer" }, "Opskrift →") : "",
          lo),
        LO()[i] ? el("p", { class: "lo-hint" }, `${next[0].toUpperCase() + next.slice(1)}: rester, ingen indkøb.`) : "",
        ingredients(m, i, x)),
      el("p", { class: "swaplabel" }, b ? "Tilbage til dagens egne retter" : "Byt retten"),
      el("div", { class: "swaps" }, ...ownBtns),
      ...borrowBoxes));
  });
}

// saving on one product line, same rule as planner/build_plan.py item_saving():
// normal price known -> (before - price) * qty; multi-buy "N for Y" -> only for complete sets of N
function itemSaving(p, qty) {
  if (p.before && p.before > p.price) return (p.before - p.price) * qty;
  if (p.multi && qty >= p.multi.n) return Math.max(0, Math.floor(qty / p.multi.n) * (p.multi.n * p.price - p.multi.total));
  return 0;
}
const dishSaving = (m, x = 1) => m.products.filter((p) => !p.pantry).reduce((s, p) => s + itemSaving(p, p.qty * x), 0);

// fold-out ingredient overview: what the dinner needs and which parts are on offer (the saving sits in the pills above)
function ingredients(m, i, x = 1) {
  const buy = m.products.filter((p) => !p.pantry), home = m.products.filter((p) => p.pantry);
  const offers = buy.filter((p) => p.offer).length;
  const summary = el("summary", { "data-key": `day${i}-ing` },
    el("span", { class: "ing-title" }, `Ingredienser (${buy.length})${x > 1 ? " · dobbelt" : ""}`),
    offers ? el("span", { class: "pill offer" }, `${offers} på tilbud`) : "");
  const row = (p) => el("li", { class: p.offer ? "on-offer" : "" },
    el("span", { class: "ing-name" }, `${p.qty * x > 1 ? p.qty * x + " × " : ""}${p.name}`, el("small", {}, p.size || "")),
    el("span", { class: "ing-price" },
      p.before && p.before > p.price ? el("s", { "aria-label": `før ${kr(p.before * p.qty * x)}` }, kr(p.before * p.qty * x)) : "",
      el("b", {}, kr(p.price * p.qty * x)),
      p.offer ? el("em", {}, p.multi && p.qty * x < p.multi.n ? `${p.offer} · spar kun ved ${p.multi.n} stk` : p.offer) : ""));
  return el("details", { class: "ing", ...(state.open && state.open[i] ? { open: "" } : {}),
    on: { toggle: (e) => { state.open = state.open || {}; state.open[i] = e.target.open; save(); } } },
    summary,
    el("ul", {}, ...buy.map(row)),
    home.length ? el("p", { class: "ing-home" }, "Har I måske: " + home.map((p) => p.name).join(", ")) : "");
}

function stepper(key, name, get, set) {
  return el("span", { class: "qty" },
    el("button", { "data-key": `${key}-dec`, "aria-label": `Færre ${name}`, on: { click: () => set(Math.max(0, get() - 1)) } }, "−"),
    el("span", { "aria-live": "polite" }, get()),
    el("button", { "data-key": `${key}-inc`, "aria-label": `Flere ${name}`, on: { click: () => set(Math.min(20, get() + 1)) } }, "+"));
}

function renderBasics() {
  const root = $("#basics"); root.replaceChildren();
  plan.basics.forEach((b, i) => {
    const s = state.basics[i] || (state.basics[i] = { on: true, choice: 0, qty: b.qty });
    if (s.on && s.qty === 0) s.on = false;               // 0 means "not this week": keep checkbox and amount in sync
    const c = b.choices[s.choice] || b.choices[0];
    root.append(el("div", { class: "basic" + (s.on ? "" : " off") },
      el("label", { class: "chk" },
        el("input", { type: "checkbox", "data-key": `basic${i}-chk`, ...(s.on ? { checked: "" } : {}), "aria-label": `Køb ${b.search}`,
          on: { change: (e) => { s.on = e.target.checked; if (s.on && s.qty === 0) s.qty = b.qty || 1; changed(); } } })),
      el("div", { class: "name" },
        el("select", { "data-key": `basic${i}-sel`, "aria-label": `Vælg vare: ${b.search}`, on: { change: (e) => { s.choice = +e.target.value; changed(); } } },
          ...b.choices.map((ch, j) => el("option", { value: j, ...(j === s.choice ? { selected: "" } : {}) },
            `${ch.name} ${ch.size || ""}${ch.offer ? " · tilbud" : ""}`))),
        c.offer ? el("small", { class: "tag", title: c.offer }, c.offer.split(" (")[0]) : ""),
      stepper(`basic${i}`, c.name, () => (s.on ? s.qty : 0), (v) => { s.qty = v; s.on = v > 0; changed(); }),
      el("span", { class: "price" }, kr(c.price * (s.on ? s.qty : 0)))));
  });
}

// --- day model: leftovers ("Rester til dagen efter") and borrowed dinners -------------------------------
// state.leftover[i] = true  -> day i is cooked double; day i+1 is covered (greyed, nothing bought for it)
// state.borrow[i] = {d, o}  -> day i uses plan.days[d].options[o] (a dinner displaced from a covered day)
const LO = () => (state.leftover = state.leftover || {});
const BR = () => (state.borrow = state.borrow || {});
const covered = (i) => i > 0 && !!LO()[i - 1];
const own = (i) => plan.days[i].options[state.pick[i]];
function dishFor(i) {
  if (covered(i)) return null;
  const b = BR()[i];
  if (b && covered(b.d) && plan.days[b.d] && plan.days[b.d].options[b.o]) return plan.days[b.d].options[b.o];
  return own(i);
}
const mult = (i) => (LO()[i] && !covered(i) ? 2 : 1);
// every dinner (main + swaps) of a day covered by leftovers can be borrowed by the other days: [{d, o, m}]
const displaced = () => plan.days.map((_, i) => i).filter(covered)
  .flatMap((i) => plan.days[i].options.map((m, o) => ({ d: i, o, m })));
function setLeftover(i, on) {
  if (on) {
    LO()[i] = true; delete LO()[i + 1];           // the next day becomes leftovers, so it can't make leftovers itself
    delete BR()[i + 1];
  } else {
    delete LO()[i];
    for (const k of Object.keys(BR())) if (BR()[k].d === i + 1) delete BR()[k];  // its dinner is back on its own day
  }
  changed();
}
function chosenDinners() {
  return plan.days.map((d, i) => ({ i, m: dishFor(i), x: mult(i) })).filter((c) => c.m);
}

function pantryItems() {
  const map = new Map();
  for (const { m } of chosenDinners()) for (const p of m.products) if (p.pantry && !map.has(p.id)) map.set(p.id, p);
  return [...map.values()];
}

function renderPantry() {
  const root = $("#pantry"); root.replaceChildren();
  const items = pantryItems();
  if (!items.length) { root.append(el("p", { class: "hint" }, "Intet ekstra.")); return; }
  for (const p of items) {
    root.append(el("label", { class: "row" },
      el("input", { type: "checkbox", "data-key": `pantry${p.id}`, ...(state.pantry[p.id] ? { checked: "" } : {}),
        on: { change: (e) => { state.pantry[p.id] = e.target.checked; changed(); } } }),
      el("span", { class: "name" }, p.name, el("small", {}, p.size || "")),
      el("span", { class: "price" }, kr(p.price))));
  }
}

function lines() {
  const map = new Map();
  const add = (p, qty, why) => {
    if (qty <= 0) return;
    const l = map.get(p.id) || { id: p.id, name: p.name, size: p.size || null, price: p.price, qty: 0, for: [] };
    l.qty += qty; if (!l.for.includes(why)) l.for.push(why); map.set(p.id, l);
  };
  chosenDinners().forEach(({ m, x }) => m.products.forEach((p) => {
    if (!p.pantry) add(p, p.qty * x, x > 1 ? `${m.name} (dobbelt)` : m.name);
    else if (state.pantry[p.id]) add({ ...p, qty: 1 }, map.has(p.id) ? 0 : 1, m.name);  // staples: once
  }));
  plan.basics.forEach((b, i) => {
    const s = state.basics[i]; if (s && s.on) add(b.choices[s.choice] || b.choices[0], s.qty, "Faste varer");
  });
  return [...map.values()].map((l) => ({ ...l, qty: Math.min(l.qty, 20) }));
}

const feeTotal = () => Object.values(plan.fees || {}).reduce((a, v) => a + (+v || 0), 0);

function renderList() {
  const ls = lines(), items = ls.reduce((a, l) => a + l.price * l.qty, 0), fees = feeTotal(), total = items + fees;
  const groups = new Map();
  for (const l of ls) { const g = l.for[0]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(l); }
  $("#list").replaceChildren(
    ...[...groups].flatMap(([g, rows]) => [el("p", { class: "group" }, g),
      ...rows.map((l) => el("div", { class: "row" },
        el("div", { class: "name" }, `${l.qty} × ${l.name}`,
          el("small", {}, [l.size, l.for.length > 1 ? "også: " + l.for.slice(1).join(", ") : ""].filter(Boolean).join(" · "))),
        el("span", { class: "price" }, kr(l.price * l.qty))))]),
    fees ? el("div", { class: "row" }, el("div", { class: "name" }, "Levering og pakning", el("small", {}, "BilkaToGo-gebyrer")),
      el("span", { class: "price" }, kr(fees))) : "");
  $("#listsum").textContent = `Se alle varer (${ls.length})`;
  $("#total").textContent = `ca. ${kr0(total)}`;
  const min = plan.minimum_order || 0;                     // BilkaToGo's minimum counts everything incl. fees
  const meter = $(".meter");
  meter.setAttribute("aria-valuemax", String(min || 1));
  meter.setAttribute("aria-valuenow", String(Math.round(Math.min(total, min || total))));
  meter.setAttribute("aria-valuetext", min && total < min ? `${kr(min - total)} mangler til minimumskøb` : "Minimumskøb nået");
  $("#meterfill").style.width = min ? Math.min(100, (total / min) * 100) + "%" : "100%";
  const m = $("#minimum");
  $("#bar").classList.toggle("ok", !!min && total >= min && !justSaved);
  m.classList.toggle("saved", justSaved);
  m.textContent = justSaved ? "Hentet ✓ Læg filen i Drive › Madplan › inbox"
    : `${ls.length} varer · levering ${kr0(fees)}` + (min && total < min ? ` · mangler ${kr0(min - total)} til min.køb` : "");
}

function download() {
  if (plan.week !== current) return;  // archived weeks: product ids and prices are out of date
  const ls = lines();
  const doc = {
    schema: "tmtl-meal-planner/grocery-list@1",
    store: "bilkatogo",
    week: plan.week,
    created: new Date().toISOString().slice(0, 16),
    how_to_use: "Agent: put these products in the BilkaToGo cart with handle-mcp " +
      "set_cart_quantities(store='bilkatogo', items={id: qty}). qty is the absolute count per product id. " +
      "Only fill the cart: never order, pay or book a delivery time. The human checks the cart and pays.",
    dinners: plan.days.map((d, i) => covered(i)
      ? { day: d.day, name: `Rester fra ${lower(plan.days[i - 1].day)}`, leftovers: true }
      : { day: d.day, name: dishFor(i).name, url: dishFor(i).url, ...(mult(i) > 1 ? { double: true } : {}) }),
    items: ls.map(({ id, name, size, qty, price, for: f }) => ({ id, name, size, qty, price, for: f })),
    estimated_total: Math.round(ls.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100,
    estimated_fees: Math.round(feeTotal() * 100) / 100,
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `bilkatogo-liste-${plan.week}.json` });
  document.body.append(a); a.click(); a.remove();
  justSaved = true; renderList();
  toast("Listen er hentet ✓");
}

function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", { class: "toast", role: "status" }); document.body.append(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 7000);
}

$("#save").addEventListener("click", download);
init().catch(() => { $("#meta").textContent = "Kunne ikke hente madplanen."; });
