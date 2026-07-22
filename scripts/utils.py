import json
import os
import re
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SOURCES_PATH = os.path.join(DATA_DIR, "sources.json")
ARTICLES_DIR = os.path.join(DATA_DIR, "articles")
HISTORY_DIR = os.path.join(DATA_DIR, "history")

MAX_ITEMS_PER_CATEGORY = 40
MAX_HISTORY_POINTS = 60  # ~5 days at 2-hour cadence, plenty for a sparkline


def _append_history(category, item_count):
    os.makedirs(HISTORY_DIR, exist_ok=True)
    path = os.path.join(HISTORY_DIR, f"{category}.json")
    history = []
    if os.path.exists(path):
        with open(path, "r") as f:
            try:
                history = json.load(f)
            except json.JSONDecodeError:
                history = []
    history.append({
        "t": datetime.now(timezone.utc).isoformat(),
        "count": item_count,
    })
    history = history[-MAX_HISTORY_POINTS:]
    with open(path, "w") as f:
        json.dump(history, f, indent=2)


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
    _append_history(category, len(merged))
    print(f"[{category}] wrote {len(merged)} items")


def clean_summary(raw_html, max_len=160):
    """Strip HTML tags from an RSS summary/description and truncate for card previews."""
    if not raw_html:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw_html)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        text = text[:max_len].rsplit(" ", 1)[0] + "…"
    return text
