"""Generic scraper for sources without an RSS feed.

Reads any source (in ANY category) in data/sources.json marked with
"fetch_type": "scrape", and pulls recent articles from a plain HTTP GET of
that source's URL.

IMPORTANT — this only works for simple, server-rendered article-listing
pages, i.e. sites where "view source" already shows the article titles and
links in the raw HTML (like AI Frontiers' Webflow-based topic pages, which
this was built and tuned against). It does NOT work for sites that render
their article list client-side via JavaScript after the page loads (common
on many modern news sites, Product Hunt, most .mil/.gov sites, etc.) —
those will silently return zero items rather than error, so don't assume a
source works just because it's marked active; check the Action log after
each new source's first run, or run this locally against a single URL to
sanity-check before flipping "active": true in sources.json.

Extraction strategy (best-effort, not site-specific):
  1. Find repeated "card" containers — tries Webflow's own generated class
     `.w-dyn-item` first (used by ~all Webflow CMS collection lists, so this
     is a safe bet for any Webflow-based site, not just AI Frontiers), then
     falls back to <article> tags for non-Webflow sites.
  2. Within each card: first <a href> is treated as the article URL; the
     first heading (h1/h2/h3) as the title.
  3. A date is pulled via regex looking for a "Month D, YYYY" pattern
     anywhere in the card's text.
  4. A summary is the longest <p>/<div> text block in the card that isn't
     the title or a date string (heuristic, not guaranteed clean).

If a new source doesn't fit this shape, don't force it through this engine —
either write a small site-specific override function, or leave it inactive.
"""
import re
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from utils import load_sources, save_items, clean_summary

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ai-dev-dashboard-bot/1.0)"}
REQUEST_TIMEOUT = 20
MAX_CARDS_PER_SOURCE = 30

DATE_PATTERN = re.compile(
    r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
    r"Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+"
    r"(\d{1,2}),?\s+(\d{4})"
)


def parse_date(text):
    """Extract a 'Month D, YYYY' style date from free text, return ISO or None."""
    m = DATE_PATTERN.search(text or "")
    if not m:
        return None
    try:
        dt = datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y")
        return dt.isoformat()
    except ValueError:
        return None


def scrape_source(src):
    """Best-effort generic scrape of one source. Returns a list of item dicts
    in the same shape fetch_rss.py produces, or raises on hard failure
    (network error, non-200) so the caller can log and skip it."""
    resp = requests.get(src["url"], headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    cards = soup.select(".w-dyn-item") or soup.find_all("article")
    items = []
    seen_urls = set()

    for card in cards[:MAX_CARDS_PER_SOURCE]:
        link = card.find("a", href=True)
        if not link:
            continue
        url = urljoin(src["url"], link["href"])
        if url in seen_urls:
            continue
        seen_urls.add(url)

        heading = card.find(["h1", "h2", "h3"])
        title = (heading.get_text(strip=True) if heading else link.get_text(strip=True))
        if not title:
            continue

        full_text = card.get_text(" ", strip=True)
        published = parse_date(full_text)

        summary = ""
        for el in card.find_all(["p", "div"]):
            t = el.get_text(" ", strip=True)
            if t and t != title and not DATE_PATTERN.fullmatch(t) and len(t) > len(summary):
                summary = t

        item = {
            "title": title,
            "url": url,
            "source": src["name"],
            "published": published,
            "preview": clean_summary(summary, max_len=220) if summary else None,
        }
        if src.get("country"):
            item["country"] = src["country"]
        items.append(item)

    return items


def run():
    categories = load_sources()
    # Group by category so save_items() is called once per category, same
    # as fetch_rss.py / fetch_arxiv.py — save_items merges + dedupes by URL,
    # so it's safe to call it again for a category another script already
    # touched in the same pipeline run.
    by_category = {}

    for cat_key, cfg in categories.items():
        for src in cfg.get("sources", []):
            if src.get("fetch_type") != "scrape":
                continue
            if not src.get("active", True):
                continue
            try:
                items = scrape_source(src)
                by_category.setdefault(cat_key, []).extend(items)
                print(f"[{cat_key}] scraped {len(items)} item(s) from {src['name']}")
            except Exception as e:
                print(f"[{cat_key}] failed to scrape {src['name']}: {e}")

    for cat_key, items in by_category.items():
        save_items(cat_key, items)


if __name__ == "__main__":
    run()
