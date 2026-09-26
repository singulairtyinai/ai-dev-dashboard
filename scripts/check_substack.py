"""Try alternative routes to *.substack.com feeds, which return 403 to
requests from GitHub Actions runners.

Usage: python scripts/check_substack.py
"""
from urllib.parse import quote

import feedparser
import requests

UA = "Mozilla/5.0 (compatible; ai-dev-dashboard-bot/1.0)"
TIMEOUT = 25

SUBDOMAINS = ["helentoner", "milesbrundage", "outofcontrol", "appleseedai", "chinai"]


def routes(sub):
    feed = f"https://{sub}.substack.com/feed"
    return {
        "direct": feed,
        "substack_api": f"https://{sub}.substack.com/api/v1/archive?sort=new&limit=5",
        "jina_reader": f"https://r.jina.ai/{feed}",
        "rss2json": f"https://api.rss2json.com/v1/api.json?rss_url={quote(feed, safe='')}",
        "google_news": f"https://news.google.com/rss/search?q=site:{sub}.substack.com&hl=en-US&gl=US&ceid=US:en",
    }


def probe(name, url):
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    except Exception as e:
        return f"error {type(e).__name__}"
    if r.status_code != 200:
        return f"HTTP {r.status_code}"
    if name == "substack_api":
        try:
            posts = r.json()
            return f"OK {len(posts)} posts, latest {posts[0].get('post_date')} :: {posts[0].get('title')}"
        except Exception:
            return "200 but not JSON"
    if name == "rss2json":
        j = r.json()
        items = j.get("items") or []
        if j.get("status") != "ok" or not items:
            return f"200 but status={j.get('status')} msg={j.get('message')}"
        return f"OK {len(items)} items, latest {items[0].get('pubDate')} :: {items[0].get('title')}"
    feed = feedparser.parse(r.content)
    if feed.entries:
        e = feed.entries[0]
        return f"OK {len(feed.entries)} entries, latest {e.get('published')} :: {e.get('title', '')[:70]}"
    return f"200 but no feed entries ({r.text[:80]!r})"


def main():
    for sub in SUBDOMAINS:
        print(f"== {sub}.substack.com")
        for name, url in routes(sub).items():
            print(f"   {name:<13} {probe(name, url)}")


if __name__ == "__main__":
    main()
