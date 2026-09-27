"""Check a list of candidate feed URLs from scripts/candidates.txt (one per
line, "Name | URL"). Prints item count, newest date and sample titles.

Usage: python scripts/check_urls.py
"""
import os
from datetime import datetime, timezone

import feedparser
import requests

UA = "Mozilla/5.0 (compatible; ai-dev-dashboard-bot/2.0)"
PATH = os.path.join(os.path.dirname(__file__), "candidates.txt")

def check_page(name, url):
    """For pages without a feed: show the feed links the page advertises and
    the article links a scraper could pick up."""
    import re
    from urllib.parse import urljoin
    from bs4 import BeautifulSoup
    r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
    soup = BeautifulSoup(r.text, "html.parser")
    alts = [urljoin(url, l["href"]) for l in soup.find_all("link", rel="alternate") if l.get("href")]
    links = []
    for a in soup.find_all("a", href=True):
        text = re.sub(r"\s+", " ", a.get_text(" ", strip=True))
        href = urljoin(url, a["href"])
        if len(text) >= 20 and href.startswith(url.rstrip("/") + "/") and href.rstrip("/") != url.rstrip("/"):
            links.append((text[:80], href))
    print(f"PAGE {name}: HTTP {r.status_code}, {len(r.text)} bytes, {len(soup.find_all('article'))} <article>, "
          f"{len(soup.select('.w-dyn-item'))} webflow cards, feed links: {alts or 'none'}")
    for t, h in list(dict.fromkeys(links))[:8]:
        print(f"       - {t} -> {h}")
    print(f"       ({len(set(links))} article-like links)")


for line in open(PATH):
    if "|" not in line or line.startswith("#"):
        continue
    name, url = [x.strip() for x in line.split("|", 1)]
    if name.startswith("PAGE "):
        try:
            check_page(name[5:], url)
        except Exception as ex:
            print(f"FAIL {name}: {type(ex).__name__}: {str(ex)[:100]}")
        continue
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
        feed = feedparser.parse(r.content)
        if not feed.entries:
            print(f"FAIL {name}: HTTP {r.status_code}, no entries")
            continue
        dates = [datetime(*t[:6], tzinfo=timezone.utc) for e in feed.entries
                 if (t := getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None))]
        newest = max(dates).date() if dates else "undated"
        print(f"OK   {name}: {len(feed.entries)} items, newest {newest}")
        for e in feed.entries[:4]:
            print(f"       - {e.get('title', '')[:90]}")
    except Exception as ex:
        print(f"FAIL {name}: {type(ex).__name__}: {str(ex)[:100]}")
