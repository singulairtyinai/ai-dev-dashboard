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

for line in open(PATH):
    if "|" not in line or line.startswith("#"):
        continue
    name, url = [x.strip() for x in line.split("|", 1)]
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
