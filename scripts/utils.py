import json
import os
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SOURCES_PATH = os.path.join(DATA_DIR, "sources.json")
ARTICLES_DIR = os.path.join(DATA_DIR, "articles")

MAX_ITEMS_PER_CATEGORY = 40


def load_sources():
    with open(SOURCES_PATH, "r") as f:
        return json.load(f)["categories"]


def load_existing(category):
    path = os.path.join(ARTICLES_DIR, f"{category}.json")
    if not os.path.exists(path):
        return {"category": category, "last_updated": None, "items": []}
    with open(path, "r") as f:
        return json.load(f)


def save_items(category, new_items):
    """Merge new_items into existing, de-duplicate by url, keep newest N, write file."""
    existing = load_existing(category)
    seen = {item["url"] for item in existing["items"] if "url" in item}
    merged = list(existing["items"])
    for item in new_items:
        if item.get("url") and item["url"] not in seen:
            merged.append(item)
            seen.add(item["url"])

    merged.sort(key=lambda x: x.get("published") or "", reverse=True)
    merged = merged[:MAX_ITEMS_PER_CATEGORY]

    out = {
        "category": category,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "items": merged,
    }
    path = os.path.join(ARTICLES_DIR, f"{category}.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"[{category}] wrote {len(merged)} items")
