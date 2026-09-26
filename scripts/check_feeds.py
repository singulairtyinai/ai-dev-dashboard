"""Check candidate sources: find a working RSS/Atom feed for each and report
how fresh it is. Tries the listed feed URLs first, then falls back to feed
autodiscovery (<link rel="alternate">) on the homepage.

Also reports whether a plain feedparser.parse(url) works, since that is
exactly what fetch_rss.py does in the scheduled workflow.

Usage: python scripts/check_feeds.py
"""
import json
from datetime import datetime, timezone
from urllib.parse import urljoin

import feedparser
import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; ai-dev-dashboard-bot/1.0)"
TIMEOUT = 20

CANDIDATES = [
    ("policy.ai (CSET)", "https://cset.georgetown.edu/newsletters/",
     ["https://cset.georgetown.edu/newsletters/feed/", "https://cset.georgetown.edu/feed/"]),
    ("Transformer (Shakeel Hashim)", "https://www.transformernews.ai/",
     ["https://www.transformernews.ai/feed"]),
    ("Hyperdimensional (Dean Ball)", "https://www.hyperdimensional.co/",
     ["https://www.hyperdimensional.co/feed"]),
    ("Policy Gradients (FAI)", "https://policygradients.thefai.org/",
     ["https://policygradients.thefai.org/feed", "https://www.policygradients.com/feed"]),
    ("AI as Normal Technology", "https://www.normaltech.ai/",
     ["https://www.normaltech.ai/feed"]),
    ("Getting Out of Control (Neil Chilson)", "https://outofcontrol.substack.com/",
     ["https://outofcontrol.substack.com/feed"]),
    ("Rising Tide (Helen Toner)", "https://helentoner.substack.com/",
     ["https://helentoner.substack.com/feed"]),
    ("Second Thoughts (Steve Newman)", "https://secondthoughts.ai/",
     ["https://secondthoughts.ai/feed"]),
    ("Threading the Needle (Anton Leicht)", "https://writing.antonleicht.me/",
     ["https://writing.antonleicht.me/feed"]),
    ("Miles's Substack (Miles Brundage)", "https://milesbrundage.substack.com/",
     ["https://milesbrundage.substack.com/feed"]),
    ("Import AI (Jack Clark)", "https://importai.substack.com/",
     ["https://importai.substack.com/feed", "https://jack-clark.net/feed/"]),
    ("Interconnects (Nathan Lambert)", "https://www.interconnects.ai/",
     ["https://www.interconnects.ai/feed"]),
    ("ChinaTalk (Jordan Schneider)", "https://www.chinatalk.media/",
     ["https://www.chinatalk.media/feed"]),
    ("Appleseed AI (Kevin Frazier)", "https://appleseedai.substack.com/",
     ["https://appleseedai.substack.com/feed"]),
    ("AI Futures Project", "https://blog.aifutures.org/",
     ["https://blog.aifutures.org/feed"]),
    ("AI Policy Bulletin", "https://www.aipolicybulletin.org/",
     ["https://newsletter.aipolicybulletin.org/feed", "https://www.aipolicybulletin.org/feed",
      "https://www.aipolicybulletin.org/rss.xml"]),
    ("FYI This Week (AIP)", "https://ww2.aip.org/fyi",
     ["https://ww2.aip.org/fyi/rss.xml", "https://ww2.aip.org/fyi/feed", "https://www.aip.org/fyi/rss.xml"]),
    ("Tech Policy Press", "https://www.techpolicy.press/",
     ["https://www.techpolicy.press/rss/", "https://www.techpolicy.press/feed/"]),
    ("Axios AI+ (Axios)", "https://www.axios.com/newsletters/axios-ai-plus",
     ["https://api.axios.com/feed/technology", "https://api.axios.com/feed/"]),
    ("ChinAI (Jeff Ding)", "https://chinai.substack.com/",
     ["https://chinai.substack.com/feed"]),
    ("Choosing Victory (Ryan Fedasiuk)", "https://www.choosingvictory.com/",
     ["https://www.choosingvictory.com/feed", "https://choosingvictory.substack.com/feed"]),
    ("The Algorithm (MIT Tech Review)", "https://www.technologyreview.com/topic/artificial-intelligence/",
     ["https://www.technologyreview.com/topic/artificial-intelligence/feed",
      "https://www.technologyreview.com/feed/"]),
]


def entry_date(entry):
    for key in ("published_parsed", "updated_parsed"):
        t = getattr(entry, key, None)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc)
    return None


def try_feed(url):
    """Return (feed, http_status) if url serves a parseable feed with entries."""
    try:
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    except Exception as e:
        return None, f"error: {type(e).__name__}"
    if resp.status_code != 200:
        return None, resp.status_code
    feed = feedparser.parse(resp.content)
    if not feed.entries:
        return None, "200 but no feed entries"
    return feed, 200


def discover(homepage):
    try:
        resp = requests.get(homepage, headers={"User-Agent": UA}, timeout=TIMEOUT)
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return []
    links = soup.find_all("link", rel="alternate")
    return [urljoin(homepage, l["href"]) for l in links
            if l.get("href") and "xml" in (l.get("type") or "")]


def check(name, homepage, feeds):
    tried = {}
    for url in feeds + [u for u in discover(homepage) if u not in feeds]:
        feed, status = try_feed(url)
        tried[url] = status
        if not feed:
            continue
        dated = [(entry_date(e), e) for e in feed.entries]
        dated = [d for d in dated if d[0]]
        latest = max(dated, key=lambda d: d[0]) if dated else (None, feed.entries[0])
        # Mirror production: fetch_rss.py calls feedparser.parse(url) directly.
        direct = feedparser.parse(url)
        now = datetime.now(timezone.utc)
        return {
            "name": name, "ok": True, "feed": url,
            "entries": len(feed.entries),
            "latest": latest[0].isoformat() if latest[0] else None,
            "age_days": round((now - latest[0]).total_seconds() / 86400, 1) if latest[0] else None,
            "latest_title": latest[1].get("title", "")[:90],
            "posts_last_30d": sum(1 for d, _ in dated if (now - d).days <= 30),
            "feedparser_direct_ok": bool(direct.entries),
        }
    return {"name": name, "ok": False, "tried": tried}


def main():
    results = [check(*c) for c in CANDIDATES]
    for r in results:
        if r["ok"]:
            print(f"OK   {r['name']:<42} {r['feed']}\n     latest {r['latest']} ({r['age_days']}d ago), "
                  f"{r['posts_last_30d']} posts/30d, direct={r['feedparser_direct_ok']} :: {r['latest_title']}")
        else:
            print(f"FAIL {r['name']:<42} tried {r['tried']}")
    print("\nJSON_RESULTS=" + json.dumps(results))


if __name__ == "__main__":
    main()
