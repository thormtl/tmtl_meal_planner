// Ugens madplan: pick a dinner per day, tick weekly basics, save an agent-readable shopping list.
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

let plan, state;
const KEY = () => "madplan:" + plan.week;
const save = () => { try { localStorage.setItem(KEY(), JSON.stringify(state)); } catch {} };

let current = null;  // this week's plan.json week; older weeks come from plans/<week>.json

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
  $("#save").textContent = old ? "Kun inspiration" : "Gem indkøbsliste";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY()) || "null"); } catch {}
  state = saved || {
    pick: plan.days.map(() => 0),
    basics: plan.basics.map((b) => ({ on: true, choice: 0, qty: b.qty })),
    pantry: {},
  };
  $("#meta").textContent = `Uge ${+plan.week.split("-W")[1]} · 7 aftener børnene kan lide · ${plan.persons} personer`;
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

function render() {
  renderDays(); renderBasics(); renderPantry(); renderList();
}

const ART = { pasta: "pasta", burger: "burger", pizza: "pizza", fisk: "fisk", kylling: "kylling",
  "tex-mex": "texmex", dansk: "dansk", andet: "andet" };
const art = (m) => `img/dish-${ART[m.family] || "andet"}.webp`;

function renderDays() {
  const root = $("#days"); root.replaceChildren();
  const moved = displaced();
  plan.days.forEach((d, i) => {
    const cov = covered(i), m = cov ? own(i) : dishFor(i), x = mult(i);
    const photo = el("div", { class: "photo" },
      m.image
        ? el("img", { class: "dish-photo", src: m.image, alt: m.name, loading: i < 2 ? "eager" : "lazy", referrerpolicy: "no-referrer",
            on: { error: (e) => { e.target.replaceWith(el("div", { class: "art-only" }, el("img", { src: art(m), alt: "" }))); } } })
        : el("div", { class: "art-only" }, el("img", { src: art(m), alt: "" })),
      el("span", { class: "daytag" }, d.day),
      cov ? el("span", { class: "leftover-tag" }, `🍲 Rester fra ${plan.days[i - 1].day.toLowerCase()}`) : "",
      el("span", { class: "badge-art" }, el("img", { src: art(m), alt: "" })));
    if (cov) {
      root.append(el("article", { class: "day covered" }, photo,
        el("div", { class: "body" },
          el("h3", {}, `Rester: ${dishFor(i - 1).name}`),
          el("p", { class: "hint" }, `${m.name} er sat på pause. Vælg den på en anden dag under "Byt retten", eller køb den ikke denne uge.`))));
      return;
    }
    const pills = el("div", { class: "pills" },
      el("span", { class: "pill" }, `⏱ ${m.time || "?"}`),
      el("span", { class: "pill" }, `ca. ${kr(m.cost * x)}`),
      x > 1 ? el("span", { class: "pill double" }, "Dobbelt portion") : "",
      dishSaving(m, x) >= 0.5 ? el("span", { class: "pill offer" }, `spar ca. ${kr(dishSaving(m, x))}`) : "",
      m.kid >= 3 ? el("span", { class: "pill kids" }, "Børnefavorit") : "");
    const last = i === plan.days.length - 1;
    const lo = last ? "" : el("button", { class: "lo-btn", "aria-pressed": String(!!LO()[i]),
      on: { click: () => setLeftover(i, !LO()[i]) } },
      LO()[i] ? `✓ Rester til ${plan.days[i + 1].day.toLowerCase()}` : "🍲 Rester til dagen efter");
    const b = BR()[i];
    const ownBtns = d.options.map((o, j) =>
      el("button", { "aria-pressed": String(!b && j === state.pick[i]), title: o.name,
        on: { click: () => { state.pick[i] = j; delete BR()[i]; save(); render(); } } },
        el("img", { src: art(o), alt: "" }), el("span", {}, o.name)));
    const borrowBtns = moved.filter((mv) => mv.d !== i).map((mv) =>
      el("button", { class: "borrow", "aria-pressed": String(!!b && b.d === mv.d && b.o === mv.o), title: mv.m.name,
        on: { click: () => { BR()[i] = { d: mv.d, o: mv.o }; save(); render(); } } },
        el("img", { src: art(mv.m), alt: "" }), el("span", {}, `${mv.m.name} · fra ${plan.days[mv.d].day.toLowerCase()}`)));
    root.append(el("article", { class: "day" + (x > 1 ? " doubled" : "") },
      photo,
      el("div", { class: "body" },
        el("h3", {}, m.name), pills,
        m.url ? el("a", { class: "recipe", href: m.url, target: "_blank", rel: "noopener noreferrer" }, "Se opskriften →") : "",
        lo,
        ingredients(m, i, x)),
      el("p", { class: "swaplabel" }, "Byt retten"),
      el("div", { class: "swaps" }, ...ownBtns, ...borrowBtns)));
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

// fold-out ingredient overview: what the dinner needs, which parts are on offer, and the saving
function ingredients(m, i, x = 1) {
  const buy = m.products.filter((p) => !p.pantry), home = m.products.filter((p) => p.pantry);
  const offers = buy.filter((p) => p.offer).length, saving = dishSaving(m, x);
  const open = state.open && state.open[i];
  const summary = el("summary", {},
    el("span", { class: "ing-title" }, `Ingredienser (${buy.length})${x > 1 ? " · dobbelt" : ""}`),
    offers ? el("span", { class: "pill offer" }, `${offers} på tilbud`) : "",
    saving >= 0.5 ? el("span", { class: "pill save" }, `spar ${kr(saving)}`) : "");
  const row = (p, isHome) => el("li", { class: p.offer && !isHome ? "on-offer" : "" },
    el("span", { class: "ing-name" }, `${p.qty * (isHome ? 1 : x) > 1 ? p.qty * (isHome ? 1 : x) + " × " : ""}${p.name}`, el("small", {}, p.size || "")),
    el("span", { class: "ing-price" },
      p.before && p.before > p.price ? el("s", {}, kr(p.before * p.qty * (isHome ? 1 : x))) : "",
      el("b", {}, kr(p.price * p.qty * (isHome ? 1 : x))),
      p.offer && !isHome ? el("em", {}, p.multi && p.qty * x < p.multi.n
        ? `${p.offer} · spar kun ved ${p.multi.n} stk` : p.offer) : ""));
  const d = el("details", { class: "ing", ...(open ? { open: "" } : {}),
    on: { toggle: (e) => { state.open = state.open || {}; state.open[i] = e.target.open; save(); } } },
    summary,
    el("ul", {}, ...buy.map((p) => row(p, false))),
    home.length ? el("p", { class: "ing-home" }, "Har I måske: " + home.map((p) => p.name).join(", ")) : "");
  return d;
}

function stepper(get, set) {
  return el("span", { class: "qty" },
    el("button", { on: { click: () => { set(Math.max(0, get() - 1)); } }, "aria-label": "færre" }, "−"),
    el("span", {}, get()),
    el("button", { on: { click: () => { set(Math.min(20, get() + 1)); } }, "aria-label": "flere" }, "+"));
}

function renderBasics() {
  const root = $("#basics"); root.replaceChildren();
  plan.basics.forEach((b, i) => {
    const s = state.basics[i] || (state.basics[i] = { on: true, choice: 0, qty: b.qty });
    const c = b.choices[s.choice] || b.choices[0];
    root.append(el("div", { class: "row" },
      el("input", { type: "checkbox", ...(s.on ? { checked: "" } : {}), "aria-label": b.search,
        on: { change: (e) => { s.on = e.target.checked; save(); render(); } } }),
      el("div", { class: "name" },
        el("select", { on: { change: (e) => { s.choice = +e.target.value; save(); render(); } } },
          ...b.choices.map((ch, j) => el("option", { value: j, ...(j === s.choice ? { selected: "" } : {}) },
            `${ch.name} ${ch.size || ""}${ch.offer ? " (tilbud)" : ""}`))),
        c.offer ? el("small", { class: "tag" }, c.offer) : ""),
      stepper(() => s.qty, (v) => { s.qty = v; save(); render(); }),
      el("span", { class: "price" }, kr(c.price * s.qty))));
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
// dinners pushed out by leftovers, offered to the other days: [{d, o, m}]
const displaced = () => plan.days.map((_, i) => i).filter(covered).map((i) => ({ d: i, o: state.pick[i], m: own(i) }));
function setLeftover(i, on) {
  if (on) {
    LO()[i] = true; delete LO()[i + 1];           // the next day becomes leftovers, so it can't make leftovers itself
    delete BR()[i + 1];
  } else {
    delete LO()[i];
    for (const k of Object.keys(BR())) if (BR()[k].d === i + 1) delete BR()[k];  // its dinner is back on its own day
  }
  save(); render();
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
    root.append(el("div", { class: "row" },
      el("input", { type: "checkbox", ...(state.pantry[p.id] ? { checked: "" } : {}), "aria-label": p.name,
        on: { change: (e) => { state.pantry[p.id] = e.target.checked; save(); render(); } } }),
      el("div", { class: "name" }, p.name, el("small", {}, p.size || "")),
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

function renderList() {
  const ls = lines(), total = ls.reduce((a, l) => a + l.price * l.qty, 0);
  const root = $("#list"); root.replaceChildren(
    ...ls.map((l) => el("div", { class: "row" },
      el("div", { class: "name" }, `${l.qty} × ${l.name}`, el("small", {}, `${l.size || ""} · ${l.for.join(", ")}`)),
      el("span", { class: "price" }, kr(l.price * l.qty)))));
  $("#total").textContent = kr(total);
  const min = plan.minimum_order || 0;
  $("#meterfill").style.width = min ? Math.min(100, (total / min) * 100) + "%" : "100%";
  $("#minimum").textContent = `${ls.length} varer · ` + (min && total < min
    ? `${kr(min - total)} til min.køb` : "min.køb nået ✓");
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
      ? { day: d.day, name: `Rester fra ${plan.days[i - 1].day.toLowerCase()}`, leftovers: true }
      : { day: d.day, name: dishFor(i).name, url: dishFor(i).url, ...(mult(i) > 1 ? { double: true } : {}) }),
    items: ls.map(({ id, name, size, qty, price, for: f }) => ({ id, name, size, qty, price, for: f })),
    estimated_total: Math.round(ls.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100,
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `bilkatogo-liste-${plan.week}.json` });
  document.body.append(a); a.click(); a.remove();
  toast("Gemt ✓ Læg den i Drive › Madplan › inbox");
}

function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", { class: "toast", role: "status" }); document.body.append(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3500);
}

$("#save").addEventListener("click", download);
init().catch(() => { $("#meta").textContent = "Kunne ikke hente madplanen."; });
