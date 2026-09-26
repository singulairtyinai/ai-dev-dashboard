import json
import os
import re
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SOURCES_PATH = os.path.join(DATA_DIR, "sources.json")
ITEMS_PATH = os.path.join(DATA_DIR, "items.json")
WATCH_PATH = os.path.join(DATA_DIR, "watch.json")
HEALTH_PATH = os.path.join(DATA_DIR, "health.json")
SUMMARIES_PATH = os.path.join(DATA_DIR, "summaries.json")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_config():
    with open(SOURCES_PATH) as f:
        return json.load(f)


def load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError:
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def clean_summary(raw_html, max_len=220):
    """Strip HTML tags from a feed summary and truncate for card previews."""
    if not raw_html:
        return ""
    import html
    text = html.unescape(html.unescape(raw_html))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        text = text[:max_len].rsplit(" ", 1)[0] + "…"
    return text


def clean_title(raw):
    import html
    return re.sub(r"\s+", " ", html.unescape(html.unescape(raw or ""))).strip()
