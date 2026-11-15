import re

"""What Danish children tend to like for dinner, as name keywords with a weight (0-3).

Sources (2026-11 research):
- Landbrug & Fødevarer: frikadeller are the absolute favourite of families with children (whole family likes them),
  followed by soup, stews and spaghetti with meat sauce; newer analyses add pizza, burgers and pasta.
- Karolines Køkken (all Danes): pasta med kødsovs, chicken with potatoes, frikadeller top the weekday list.
- Sundhedsstyrelsen (small children): boller i karry, pizza, fiskefrikadeller with fries.
Plus common Danish family classics (tarteletter, pandekager, hakkebøf, brændende kærlighed, tacos, lasagne).
"""

KID = {  # keyword (lowercase, in the recipe name) -> weight
    "frikadelle": 3, "kødsovs": 3, "bolognese": 3, "bologenese": 3, "spaghetti": 3, "lasagne": 3, "pizza": 3,
    "burger": 3, "boller i karry": 3, "fiskefrikadelle": 3, "pandekage": 3, "tartelet": 3, "taco": 3,
    "pølse": 3, "nugget": 3, "karbonade": 3, "hakkebøf": 3, "brændende kærlighed": 3, "kylling med kartof": 3,
    "pasta": 2, "kylling": 2, "burrito": 2, "wrap": 2, "pita": 2, "fiskefilet": 2, "fish": 2, "schnitzel": 2,
    "millionbøf": 2, "gullasch": 2, "kartoffel": 1, "fiskeburger": 2, "madvafl": 2, "toast": 1,
    "croque": 1, "risotto": 1, "frikassé": 2, "flæskesteg": 2, "medister": 2, "kotelet": 2, "mørbrad": 1,
    "butter chicken": 1, "kebab": 2, "sandwich": 1, "gnocchi": 1, "pastasalat": 1,
}

AVOID = [  # names that make a dinner unlikely to please children (or not a dinner)
    "græskar", "suppe", "chili", "panang", "rød karry", "grøn karry", "laks", "bagel", "salat", "falafel",
    "koldskål", "sushi", "tatar", "carpaccio", "østers", "lever", "blodpølse", "kål", "rødbede", "smørrebrød",
]

FAMILY = [  # for variety: no two mains of the same family on consecutive days
    ("pasta", ["pasta", "spaghetti", "lasagne", "bolognese", "bologenese", "gnocchi"]),
    ("burger", ["burger"]), ("pizza", ["pizza", "flammkuchen"]),
    ("fisk", ["fisk", "laks", "torsk", "rødspætte"]),
    ("kylling", ["kylling", "chicken"]), ("tex-mex", ["taco", "burrito", "wrap", "pita"]),
]


def kid_score(name: str) -> int:
    n = name.lower()
    if any(a in n for a in AVOID):
        return -5
    return max((w for k, w in KID.items() if k in n), default=0)


def family(name: str) -> str:
    n = name.lower()
    return next((f for f, keys in FAMILY if any(k in n for k in keys)), "andet")


STAPLES = [  # kitchen staples most homes have: shown under "Har du det hjemme?", unticked, bought once
    "salt", "flagesalt", "peber", "olie", "rapsolie", "olivenolie", "sukker", "hvedemel", "mel", "eddike", "bouillon", "krydderi", "paprika", "karry",
    "spidskommen", "oregano", "timian", "laurbær", "kanel", "bagepulver", "natron", "ketchup", "sennep",
    "soja", "worcestershire", "honning", "majsstivelse", "maizena", "rasp", "hvidløgspulver", "chiliflager",
]


def is_staple(name: str) -> bool:
    words = re.findall(r"[a-zæøå]+", name.lower())
    return any(w in STAPLES or w.endswith(("bouillon", "eddike", "olie", "salt")) for w in words)
