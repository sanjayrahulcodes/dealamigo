"""
Persistent store for the business profile and inventory, kept in
data/business.json so the owner's edits survive restarts and feed both the
negotiation engine (as model context) and the bill letterhead.
"""

import json
import re
from pathlib import Path

DATA_FILE = Path(__file__).parent / "data" / "business.json"

DEFAULTS = {
    "profile": {
        "business_name": "CROSSWORD",
        "tagline": "Books · Stationery · Office Supplies",
        "address": "Shop No. 12, Main Bazaar Road, Hyderabad — 500001",
        "phone": "+91 98765 43210",
        "email": "orders@crossword.example",
        "whatsapp": "919876543210",  # digits only, country code first — used for wa.me links
        "big_order_threshold": 15000,
        "small_order_min": 5,
        "max_discount_pct": 15.0,  # global cap: no product ever exceeds this
    },
    "inventory": [
        {"name": "Long Notebook 200 pages (single line)", "unit": "piece",
         "list_price": 60.0, "max_discount_pct": 15.0, "moq": 10, "stock": 500,
         "pitch": "Thick 58 GSM paper, no ink bleed, hard cover. Schools and coaching centres buy in bulk."},
        {"name": "Blue Ball Pen (0.7mm)", "unit": "piece",
         "list_price": 10.0, "max_discount_pct": 15.0, "moq": 20, "stock": 1000,
         "pitch": "Smooth-writing branded pen, fresh stock. Offices order monthly."},
        {"name": "HB Pencil (dark lead)", "unit": "piece",
         "list_price": 5.0, "max_discount_pct": 12.0, "moq": 30, "stock": 800,
         "pitch": "Dark smooth lead, doesn't break on sharpening. Popular in exam season."},
        {"name": "A4 Copier Paper 75 GSM (500-sheet ream)", "unit": "ream",
         "list_price": 280.0, "max_discount_pct": 10.0, "moq": 3, "stock": 120,
         "pitch": "Jam-free in all printers, bright white. Print shops take 20-30 reams at a time."},
    ],
}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "item"


def load() -> dict:
    if DATA_FILE.exists():
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        # Backfill any profile keys added after the file was first written.
        for k, v in DEFAULTS["profile"].items():
            data.setdefault("profile", {}).setdefault(k, v)
        data.setdefault("inventory", [])
        return data
    save(DEFAULTS)
    return json.loads(json.dumps(DEFAULTS))


def save(data: dict):
    DATA_FILE.parent.mkdir(exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_profile() -> dict:
    return load()["profile"]


def get_catalog() -> dict:
    """Inventory as {product_id: product} with negotiation steps derived from
    the owner's max-discount setting (global cap applies to every product).
    The agent concedes along these steps; the last one is its floor."""
    data = load()
    global_cap = float(data["profile"].get("max_discount_pct", 0) or 0)
    catalog = {}
    for item in data["inventory"]:
        name = str(item.get("name", "")).strip()
        if not name or not item.get("list_price"):
            continue
        cap = min(float(item.get("max_discount_pct", 0) or 0), global_cap)
        if cap <= 0:
            steps = [0.0]
        else:
            steps = [0.0] + sorted({round(cap * f, 1) for f in (0.4, 0.7, 1.0)})
        pid = _slug(name)
        catalog[pid] = {
            "name": name,
            "unit": str(item.get("unit", "piece")),
            "list_price": float(item["list_price"]),
            "discount_steps": steps,
            "moq": int(item.get("moq", 1) or 1),
            "stock": int(item.get("stock", 0) or 0),
            "pitch": str(item.get("pitch", "")),
        }
    return catalog
