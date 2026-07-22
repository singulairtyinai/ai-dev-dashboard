"""Fetch recent papers from arXiv API for the 'papers' category."""
import urllib.request
import urllib.parse
import feedparser
from datetime import datetime, timezone
from utils import load_sources, save_items, clean_summary

ARXIV_API = "http://export.arxiv.org/api/query"


def fetch_query(query, max_results=15):
    params = {
        "search_query": query,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": max_results,
    }
    url = ARXIV_API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        raw = resp.read()
    return feedparser.parse(raw)


def run():
    categories = load_sources()
    cfg = categories.get("papers")
    if not cfg:
        return
    new_items = []
    for src in cfg["sources"]:
        if not src.get("active", True):
            continue
        try:
            feed = fetch_query(src["query"])
            for entry in feed.entries:
                published = None
                if getattr(entry, "published_parsed", None):
                    published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                new_items.append({
                    "title": entry.get("title", "Untitled").replace("\n", " ").strip(),
                    "url": entry.get("link", ""),
                    "source": src["name"],
                    "published": published,
                    "preview": clean_summary(entry.get("summary", ""), max_len=220),
                })
        except Exception as e:
            print(f"[papers] failed to fetch {src['name']}: {e}")
    save_items("papers", new_items)


if __name__ == "__main__":
    run()
