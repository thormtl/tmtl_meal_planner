"""Build this week's BilkaToGo dinner plan -> docs/plan.json (public, no personal data).

  python3 -m planner.build_plan            # writes docs/plan.json
  python3 -m planner.build_plan --publish  # + commit and push (the pre-commit scan gates it)

Candidates: Bilka's weekly "Madplan" + its dinner categories (aftensmad/*, nemme, boern-i-koekkenet).
Score = children's-favourite likelihood (planner/favourites.py) + share of the cost on offer + quick to cook.
7 days x (1 dinner + 3 swaps), all different; no two mains of the same kind on consecutive days.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import subprocess
import urllib.request
import sys

from planner import config
from planner.favourites import family, is_staple, kid_score
from planner.mcp import Handle, StoreError

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "plan.json"
DAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"]
EXTRA = ["nemme", "boern-i-koekkenet"]


def money(x) -> float:
    try:
        return round(float(str(x).replace(",", ".")), 2)
    except (TypeError, ValueError):
        return 0.0


def minutes(t) -> int | None:
    m = re.search(r"(\d+)\s*min", str(t or ""))
    h = re.search(r"(\d+)\s*(t|time)", str(t or ""))
    return (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0) or None


def candidates(h: Handle) -> dict[str, dict]:
    seen: dict[str, dict] = {}
    def add(lst, source):
        for r in lst if isinstance(lst, list) else []:
            if r.get("id", "").startswith("aftensmad/") and r["id"] not in seen:
                seen[r["id"]] = {**r, "source": source}
    add(h.call("list_recipes", stores=["bilkatogo"]), "Ugens madplan")
    subs = set()
    try:
        h.call("list_recipes", stores=["bilkatogo"], category="ukendt-kategori")
    except StoreError as e:  # the error lists every known category path
        subs = set(re.findall(r"aftensmad/[a-z0-9-]+", str(e)))
    for c in ["aftensmad", *sorted(subs), *EXTRA]:
        try:
            add(h.call("list_recipes", stores=["bilkatogo"], category=c), "Bilka opskrifter")
        except StoreError:
            pass
    return seen


def priced(h: Handle, r: dict, persons: int) -> dict | None:
    try:
        d = h.call("get_recipe", store="bilkatogo", recipe=r["id"], persons=persons)
    except StoreError:
        return None
    prods, cost, offer = [], 0.0, 0.0
    for it in d.get("items", []):
        p = it.get("product")
        if not p or not p.get("available", True):
            continue
        q = int(p.get("quantity") or 1); line = money(p.get("price")) * q
        pantry = bool(it.get("have_at_home")) or is_staple(p["name"])
        prods.append({"id": str(p["id"]), "name": p["name"], "size": p.get("size"), "price": money(p.get("price")),
                      "qty": q, "offer": p.get("offer_text"), "pantry": pantry})
        if not pantry:
            cost += line; offer += line if p.get("offer_text") else 0
    if len([p for p in prods if not p["pantry"]]) < 2:
        return None
    mins = minutes(d.get("time"))
    return {"id": d["id"], "name": d["name"], "url": d.get("url"), "image": d.get("image"), "time": d.get("time"),
            "minutes": mins, "source": r["source"], "kid": kid_score(d["name"]), "family": family(d["name"]),
            "cost": round(cost, 2), "offer_share": round(offer / cost, 2) if cost else 0, "products": prods,
            "ingredients": d.get("ingredients", [])}


FOER = re.compile(r"før\s*([\d.]+,\d{2}|[\d.]+)", re.I)
MULTI = re.compile(r"(\d+)\s*for\s*([\d.]+,\d{2}|[\d.]+)", re.I)


def dkk(txt: str) -> float:
    return money(txt.replace(".", "").replace(",", ".")) if "," in txt else money(txt)


def item_saving(p: dict, qty: int) -> float:
    """What buying `qty` of this product saves on its offer. Normal price known -> (before - price) * qty.
    Multi-buy "N for Y" -> only for complete sets of N: sets * (N * price - Y)."""
    if p.get("before") and p["before"] > p["price"]:
        return (p["before"] - p["price"]) * qty
    mb = p.get("multi")
    if mb and qty >= mb["n"]:
        return max(0.0, (qty // mb["n"]) * (mb["n"] * p["price"] - mb["total"]))
    return 0.0


def annotate_offers(p: dict, before: dict | None = None) -> None:
    """Normal price for an offer product: from product search (before_price, matched on id), else from the offer
    text ("Tilbud, før 24,95 kr"). Multi-buy offers ("Mix 10 for 25,00") get {"n", "total"}."""
    t = p.get("offer") or ""
    if not t:
        return
    b = (before or {}).get(p["id"]) or p.get("before")
    if not b and (m := FOER.search(t)):
        b = dkk(m.group(1))
    if b and b > p["price"]:
        p["before"] = round(b, 2)
    if (m := MULTI.search(t)) and not p.get("before"):
        p["multi"] = {"n": int(m.group(1)), "total": dkk(m.group(2))}


def add_savings(h: Handle | None, plan: list[list[dict]]) -> None:
    """Annotate every offer product in the chosen dinners and the saving per dinner (non-pantry items, recipe qty).
    With a Handle, missing normal prices are looked up via search_products; without one (re-annotating an existing
    plan), only the offer text is used."""
    before: dict[str, float] = {}
    if h:
        offered = {p["id"]: p["name"] for opts in plan for m in opts for p in m["products"] if p.get("offer")}
        for pid, name in offered.items():
            try:
                res = h.call("search_products", query=name, stores=["bilkatogo"])
            except StoreError:
                continue
            hit = next((x for x in res if isinstance(x, dict) and str(x.get("id")) == pid), None) if isinstance(res, list) else None
            if hit and hit.get("before_price"):
                before[pid] = money(hit["before_price"])
    for opts in plan:
        for m in opts:
            for p in m["products"]:
                annotate_offers(p, before)
            m["saving"] = round(sum(item_saving(p, p["qty"]) for p in m["products"] if not p["pantry"]), 2)
            m["offer_count"] = sum(1 for p in m["products"] if p.get("offer") and not p["pantry"])


PAGE_IMG = re.compile(r"<img[^>]+>", re.I)


def page_photo(url: str | None) -> str | None:
    """Real dish photo from the public recipe page when get_recipe has none: the first full-width Salling image
    (the recipe hero, w_1000+). Public page, no login; only https://www.bilkatogo.dk/ URLs are fetched."""
    if not url or not url.startswith("https://www.bilkatogo.dk/"):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh) tmtl_meal_planner"})
        html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001  a missing photo never breaks the build
        return None
    for tag in PAGE_IMG.findall(html):
        m = re.search(r'src="(https://digitalassets\.sallinggroup\.com/image/upload/w_(\d+)[^"]+)"', tag)
        if m and int(m.group(2)) >= 1000:
            return re.sub(r"/w_\d+,dpr_\d+,", "/w_1000,dpr_1,", m.group(1))
    return None


def score(m: dict, max_min: int) -> float:
    quick = 1.0 if (m["minutes"] or 30) <= 30 else 0.5 if (m["minutes"] or 30) <= max_min else -2
    photo = 0.3 if m.get("image") else 0  # Thor: strive for a real photo of every dish
    return 3 * m["kid"] + 2 * m["offer_share"] + quick + photo + (0.5 if m["source"] == "Ugens madplan" else 0)


def pick(meals: list[dict], days: int, alts: int) -> list[list[dict]]:
    pool = sorted(meals, key=lambda m: -m["score"])
    need = days * (1 + alts)
    pool = [m for m in pool if m["kid"] >= 0][:max(need, 1)]
    mains, rest = [], []
    for m in pool:
        if len(mains) < days and (not mains or mains[-1]["family"] != m["family"] or m["family"] == "andet"):
            mains.append(m)
        else:
            rest.append(m)
    plan = [[m] for m in mains]
    for i, m in enumerate(rest[: days * alts]):
        plan[i % days].append(m)
    return plan


def basics(h: Handle, cfg: dict) -> list[dict]:
    out = []
    for b in cfg["basics"]:
        try:
            res = h.call("search_products", query=b["search"], stores=["bilkatogo"])
        except StoreError:
            continue
        res = [p for p in res if isinstance(p, dict) and p.get("available", True)][:3] if isinstance(res, list) else []
        if not res:
            continue
        res.sort(key=lambda p: (not p.get("on_offer"), money(p.get("price"))))
        out.append({"search": b["search"], "qty": int(b.get("qty", 1)), "choices": [
            {"id": str(p["id"]), "name": p["name"], "size": p.get("size"), "price": money(p.get("price")),
             "offer": p.get("offer_text") if p.get("on_offer") else None} for p in res]})
    return out


ARCHIVE = ROOT / "docs" / "plans"


def archive(doc: dict) -> None:
    """Keep every week's plan (docs/plans/<week>.json) + an index for the page's "Tidligere uger" menu.
    A rebuild in the same week replaces that week's file."""
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    (ARCHIVE / f"{doc['week']}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    weeks = []
    for f in sorted(ARCHIVE.glob("*-W*.json"), reverse=True):
        d = json.loads(f.read_text(encoding="utf-8"))
        weeks.append({"week": d["week"], "generated": d["generated"],
                      "dinners": [day["options"][0]["name"] for day in d["days"]]})
    (ARCHIVE / "index.json").write_text(json.dumps({"weeks": weeks}, ensure_ascii=False, indent=1) + "\n",
                                        encoding="utf-8")


def main() -> None:
    cfg = config.load()
    with Handle() as h:
        cand = candidates(h)
        print(f"{len(cand)} dinner recipes found", file=sys.stderr)
        meals = []
        for r in cand.values():
            m = priced(h, r, cfg["persons"])
            if m:
                m["score"] = round(score(m, cfg["max_minutes"]), 2); meals.append(m)
        plan = pick(meals, cfg["days"], cfg["alternatives"])
        add_savings(h, plan)
        for opts in plan:
            for m in opts:
                if not m.get("image"):
                    m["image"] = page_photo(m.get("url"))
        cart = h.call("get_cart", store="bilkatogo")
        base = basics(h, cfg)
    today = dt.date.today()
    monday = today + dt.timedelta(days=(7 - today.weekday()) % 7 if today.weekday() >= 5 else -today.weekday())
    y, w, _ = monday.isocalendar()  # planned on a weekend = the coming week (as Bilka's Madplan)
    doc = {
        "schema": "tmtl-meal-planner/plan@1", "store": "bilkatogo", "week": f"{y}-W{w:02d}",
        "generated": today.isoformat(), "persons": cfg["persons"],
        "cart_url": "https://www.bilkatogo.dk/kurv", "minimum_order": money(cart.get("minimum_order")),
        "fees": {k: money(v) for k, v in (cart.get("fees") or {}).items()},
        "days": [{"day": DAYS[i % 7], "options": opts} for i, opts in enumerate(plan)],
        "basics": base,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(plan)} days, {sum(len(d) for d in plan)} dinners, {len(base)} basics",
          file=sys.stderr)
    archive(doc)
    if "--publish" in sys.argv:
        subprocess.run(["git", "-C", ROOT, "add", "docs/plan.json", "docs/plans"], check=True)
        subprocess.run(["git", "-C", ROOT, "commit", "-m", f"plan: {doc['week']}"], check=True)
        subprocess.run(["git", "-C", ROOT, "push"], check=True)


if __name__ == "__main__":
    main()
