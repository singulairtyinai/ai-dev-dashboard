"""Fetch RSS-type sources for all applicable categories and write to data/articles/*.json"""
import feedparser
from datetime import datetime, timezone
from utils import load_sources, save_items, clean_summary


def parse_entry(entry, source_name, country=None):
    published = None
    if getattr(entry, "published_parsed", None):
        published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
    item = {
        "title": entry.get("title", "Untitled"),
        "url": entry.get("link", ""),
        "source": source_name,
        "published": published,
        "preview": clean_summary(entry.get("summary", "")),
    }
    if country:
        item["country"] = country
    return item


def run():
    categories = load_sources()
    for cat_key, cfg in categories.items():
        if cfg.get("type") != "rss":
            continue
        new_items = []
        for src in cfg["sources"]:
            if not src.get("active", True):
                continue
            try:
                feed = feedparser.parse(src["url"])
                for entry in feed.entries[:15]:
                    new_items.append(parse_entry(entry, src["name"], src.get("country")))
            except Exception as e:
                print(f"[{cat_key}] failed to fetch {src['name']}: {e}")
        save_items(cat_key, new_items)


if __name__ == "__main__":
    run()
