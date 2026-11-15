"""Fill the BilkaToGo cart from a saved shopping list (the file the page downloads).

  python3 -m planner.fill_cart path/to/bilkatogo-liste-2026-W47.json   # one file
  python3 -m planner.fill_cart --inbox                                  # every *.json in the Drive inbox (launchd)

Only the cart is touched: absolute quantities per product id via handle-mcp `set_cart_quantities`. It never
orders, pays or books a delivery time. A receipt (Markdown) goes to the Drive `done` folder next to the list.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import shutil
import sys

from planner import config
from planner.mcp import Handle, StoreError

SCHEMA = "tmtl-meal-planner/grocery-list@1"
MAX_ITEMS, MAX_QTY = 150, 20  # handle-mcp limits: 50 per call (chunked), 50 per product


def validate(doc: dict) -> dict[str, int]:
    if doc.get("schema") != SCHEMA or doc.get("store") != "bilkatogo":
        raise ValueError("not a BilkaToGo grocery list from tmtl_meal_planner")
    items = doc.get("items")
    if not isinstance(items, list) or not 0 < len(items) <= MAX_ITEMS:
        raise ValueError(f"items: 1-{MAX_ITEMS} expected")
    out: dict[str, int] = {}
    for it in items:
        pid, qty = str(it.get("id", "")), it.get("qty")
        if not re.fullmatch(r"\d{1,9}", pid) or not isinstance(qty, int) or not 0 <= qty <= MAX_QTY:
            raise ValueError(f"bad line: {it!r}"[:200])
        out[pid] = out.get(pid, 0) + qty
    return {k: min(v, MAX_QTY) for k, v in out.items()}


def fill(path: pathlib.Path, done: pathlib.Path | None) -> str:
    doc = json.loads(path.read_text(encoding="utf-8"))
    items = validate(doc)
    names = {str(i["id"]): i.get("name", i["id"]) for i in doc["items"]}
    results: list[dict] = []
    ids = list(items)
    with Handle() as h:
        for i in range(0, len(ids), 50):  # handle-mcp takes at most 50 products per call
            res = h.call("set_cart_quantities", store="bilkatogo", items={k: items[k] for k in ids[i:i + 50]})
            results += res.get("results", []) if isinstance(res, dict) else []
        cart = h.call("get_cart", store="bilkatogo")
    failed = [r for r in results if not r.get("ok") or (r.get("applied") is not None and r["applied"] < r["requested"])]
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    rec = [f"# BilkaToGo-kurv fyldt · {doc.get('week', '')}", "", f"- Tid: {stamp}",
           f"- Varer sendt: {len(items)} · fejlede: {len(failed)}",
           f"- Kurv i alt: {cart.get('total')} kr (varer {cart.get('products_total')} kr)",
           f"- Minimumskøb nået: {'ja' if cart.get('minimum_met') else 'nej'}",
           f"- Åbn kurven: https://www.bilkatogo.dk/kurv", ""]
    if failed:
        rec += ["## Kom ikke (helt) i kurven", ""] + [
            f"- {names.get(str(r.get('product_id')), r.get('product_id'))}: ønsket {r.get('requested')}, "
            f"fik {r.get('applied') if r.get('applied') is not None else '?'} {r.get('message') or ''}".rstrip()
            for r in failed] + [""]
    rec += [f"- {w}" for w in cart.get("warnings") or []]
    rec += ["", "Intet er bestilt eller betalt: vælg leveringstid og betal selv på bilkatogo.dk."]
    text = "\n".join(rec) + "\n"
    if done:
        done.mkdir(parents=True, exist_ok=True)
        (done / (path.stem + ".kvittering.md")).write_text(text, encoding="utf-8")
        shutil.move(str(path), done / path.name)
    return text


def main() -> None:
    cfg = config.load()
    if "--inbox" in sys.argv:
        if not cfg["inbox"] or not cfg["done"]:
            sys.exit("set inbox and done in ~/.config/tmtl_meal_planner/config.json")
        inbox, done = pathlib.Path(cfg["inbox"]), pathlib.Path(cfg["done"])
        try:
            names = sorted(n for n in os.listdir(inbox) if n.endswith(".json"))  # raises on no access (glob hides it)
        except OSError as e:
            sys.exit(f"cannot read the inbox ({type(e).__name__}: {e.strerror}). macOS privacy settings may block "
                     "background access to Google Drive: see README 'Watcher access'.")
        print(f"{dt.datetime.now():%Y-%m-%d %H:%M} inbox: {len(names)} list(s)", flush=True)
        for f in (inbox / n for n in names):
            try:
                print(fill(f, done))
            except (ValueError, StoreError, json.JSONDecodeError) as e:
                done.mkdir(parents=True, exist_ok=True)
                (done / (f.stem + ".fejl.md")).write_text(f"# Kunne ikke fylde kurven\n\n{e}\n", encoding="utf-8")
                shutil.move(str(f), done / f.name)
        return
    for a in sys.argv[1:]:
        print(fill(pathlib.Path(a), None))


if __name__ == "__main__":
    main()
