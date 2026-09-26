"""Fetch every active source in data/sources.json and update the data files.

Each source has a "method":
  feed      RSS/Atom feed read directly
  substack  *.substack.com feed read through rss2json (Substack blocks
            GitHub's servers)
  scrape    server-rendered article listing page (Webflow cards or <article>)
  arxiv     arXiv API query in "query"
  watch     page with no feed: its headings and links are compared with the
            previous run, and any new ones are reported as a change
  auto      added from the admin panel as a plain web address: the first run
            looks for a feed on the page (or its /feed, /rss ... addresses)
            and falls back to watching the page; the result is remembered in
            data/health.json and re-checked weekly

Writes:
  data/items.json   all fetched items, newest first
  data/watch.json   per watched page: last change and what was added
  data/health.json  per source: status, last success, error, item count

Usage: python scripts/fetch_all.py
"""
import hashlib
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urljoin, urlencode

import feedparser
import requests
from bs4 import BeautifulSoup

from utils import (HEALTH_PATH, ITEMS_PATH, WATCH_PATH, clean_summary, clean_title,
                   load_config, load_json, now_iso, save_json)

UA = "Mozilla/5.0 (compatible; ai-dev-dashboard-bot/2.0; +https://github.com/singulairtyinai/ai-dev-dashboard)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
TIMEOUT = 25
PER_SOURCE_LIMIT = 25        # newest items taken from each source per run
KEEP_PER_SOURCE = 40         # items kept per source across runs
MAX_AGE = timedelta(days=120)
MIN_KEEP_PER_SOURCE = 5      # keep a few items even from quiet sources
WATCH_KEEP_ADDED = 6

COUNTRIES = [
    ("China", ["china", "chinese", "beijing", "prc"]),
    ("United States", ["u.s.", "united states", "american", "pentagon", "white house", "congress", "washington"]),
    ("United Kingdom", ["u.k.", "united kingdom", "britain", "british"]),
    ("European Union", ["european union", "european commission", "brussels", " eu "]),
    ("Taiwan", ["taiwan", "tsmc"]),
    ("Japan", ["japan", "japanese"]),
    ("South Korea", ["south korea", "korean"]),
    ("India", ["india", "indian"]),
    ("Pakistan", ["pakistan"]),
    ("Russia", ["russia", "russian", "moscow", "kremlin"]),
    ("Ukraine", ["ukraine", "ukrainian"]),
    ("Israel", ["israel", "israeli"]),
    ("Iran", ["iran", "iranian"]),
    ("France", ["france", "french"]),
    ("Germany", ["germany", "german"]),
    ("Canada", ["canada", "canadian"]),
    ("Australia", ["australia", "australian"]),
    ("Saudi Arabia", ["saudi"]),
    ("United Arab Emirates", ["uae", "emirates", "abu dhabi"]),
    ("Singapore", ["singapore"]),
    ("Brazil", ["brazil"]),
    ("African Union", ["african union"]),
    ("United Nations", ["united nations", "u.n.", "un security council", "general assembly"]),
    ("NATO", ["nato"]),
]


def get(url, **kw):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT, **kw)
    if r.status_code == 403:
        r = requests.get(url, headers={"User-Agent": BROWSER_UA}, timeout=TIMEOUT, **kw)
    r.raise_for_status()
    return r


def iso_from_struct(t):
    return datetime(*t[:6], tzinfo=timezone.utc).isoformat() if t else None


def item(title, url, published, preview):
    title = clean_title(title)
    if not title or not url:
        return None
    return {"title": title, "url": url, "published": published, "preview": clean_summary(preview)}


def fetch_feed(src):
    feed = feedparser.parse(get(src["url"]).content)
    if not feed.entries:
        # Some sites answer a browser-like request with an HTML page but serve
        # the feed to feed readers, so let feedparser fetch it itself.
        feed = feedparser.parse(src["url"], agent="feedparser/6.0 +https://github.com/singulairtyinai/ai-dev-dashboard")
    if not feed.entries and feed.bozo:
        raise ValueError(f"not a readable feed ({type(feed.bozo_exception).__name__})")
    out = []
    for e in feed.entries[:PER_SOURCE_LIMIT * 2]:
        t = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
        out.append(item(e.get("title"), e.get("link"), iso_from_struct(t), e.get("summary", "")))
    return out


def fetch_substack(src):
    api = "https://api.rss2json.com/v1/api.json?rss_url=" + quote(src["url"], safe="")
    data = get(api).json()
    if data.get("status") != "ok":
        raise ValueError(f"rss2json: {data.get('message', 'error')}")
    out = []
    for e in data.get("items", []):
        pub = None
        if e.get("pubDate"):
            try:
                pub = datetime.strptime(e["pubDate"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                pass
        out.append(item(e.get("title"), e.get("link"), pub, e.get("description", "")))
    return out


DATE_RE = re.compile(
    r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
    r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})")


def fetch_scrape(src):
    soup = BeautifulSoup(get(src["url"]).text, "html.parser")
    cards = soup.select(".w-dyn-item") or soup.find_all("article")
    out, seen = [], set()
    for card in cards[:30]:
        link = card.find("a", href=True)
        if not link:
            continue
        url = urljoin(src["url"], link["href"])
        if url in seen:
            continue
        seen.add(url)
        heading = card.find(["h1", "h2", "h3"])
        title = heading.get_text(" ", strip=True) if heading else link.get_text(" ", strip=True)
        text = card.get_text(" ", strip=True)
        pub = None
        m = DATE_RE.search(text)
        if m:
            try:
                pub = datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y").replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                pass
        summary = max((p.get_text(" ", strip=True) for p in card.find_all("p")), key=len, default="")
        out.append(item(title, url, pub, summary if summary != title else ""))
    return out


def fetch_arxiv(src):
    params = {"search_query": src["query"], "sortBy": "submittedDate", "sortOrder": "descending", "max_results": 15}
    feed = feedparser.parse(get("https://export.arxiv.org/api/query?" + urlencode(params)).content)
    return [item(e.get("title"), e.get("link"), iso_from_struct(getattr(e, "published_parsed", None)), e.get("summary", ""))
            for e in feed.entries]


def page_signature(url):
    """Headings and meaningful link texts on a page, used to detect changes."""
    soup = BeautifulSoup(get(url).text, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "form"]):
        tag.decompose()
    entries = {}
    for el in soup.find_all(["h1", "h2", "h3", "h4", "a"]):
        text = re.sub(r"\s+", " ", el.get_text(" ", strip=True))
        if len(text) < 25 or len(text) > 200:
            continue
        parent = el if el.name == "a" else el.find_parent("a")
        href = parent.get("href") if parent else None
        entries.setdefault(text, urljoin(url, href) if href else url)
    return entries


def run_watch(src, prev):
    entries = page_signature(src["url"])
    if not entries:
        raise ValueError("page loaded but has no readable headings; it is probably built by JavaScript and can't be watched")
    digest = hashlib.sha1("\n".join(sorted(entries)).encode()).hexdigest()
    now = now_iso()
    state = dict(prev or {})
    state["checked_at"] = now
    if not prev or not prev.get("hash"):
        state.update(hash=digest, known=sorted(entries)[:400], changed_at=None, added=[])
    elif digest != prev["hash"]:
        known = set(prev.get("known", []))
        added = [{"text": t, "url": entries[t]} for t in entries if t not in known][:WATCH_KEEP_ADDED]
        state.update(hash=digest, known=sorted(entries)[:400])
        if added:
            state.update(changed_at=now, added=added)
    return state


FEED_SUFFIXES = ["feed", "feed/", "rss", "rss.xml", "feed.xml", "index.xml", "atom.xml"]


def looks_like_feed(url):
    try:
        return bool(feedparser.parse(get(url).content).entries)
    except Exception:
        return False


def resolve_auto(src, prev):
    """Decide how to read a source added as a plain web address."""
    cached = (prev or {}).get("resolved")
    if cached and cached.get("at", "") > (datetime.now(timezone.utc) - timedelta(days=7)).isoformat():
        return cached
    url = src["url"]
    if ".substack.com" in url:
        found = {"method": "substack", "url": url.rstrip("/") + ("" if url.rstrip("/").endswith("/feed") else "/feed")}
    elif looks_like_feed(url):
        found = {"method": "feed", "url": url}
    else:
        candidates = []
        try:
            soup = BeautifulSoup(get(url).text, "html.parser")
            candidates = [urljoin(url, l["href"]) for l in soup.find_all("link", rel="alternate")
                          if l.get("href") and "xml" in (l.get("type") or "")]
        except Exception:
            pass
        base = url.rstrip("/") + "/"
        candidates += [base + s for s in FEED_SUFFIXES]
        feed = next((c for c in dict.fromkeys(candidates) if looks_like_feed(c)), None)
        found = {"method": "feed", "url": feed} if feed else {"method": "watch", "url": url}
    found["at"] = now_iso()
    return found


def keep_item(src, it):
    words = src.get("filter")
    if not words:
        return True
    text = f"{it['title']} {it['preview']}"
    for w in words:
        if len(w) <= 3:
            if re.search(rf"\b{re.escape(w)}\b", text):
                return True
        elif w.lower() in text.lower():
            return True
    return False


def tag_countries(src, it):
    text = f" {it['title']} {it['preview']} ".lower()
    found = [name for name, kws in COUNTRIES if any(k in text for k in kws)]
    if src.get("country") and src["country"] not in found:
        found.append(src["country"])
    return found


def item_id(url):
    return hashlib.sha1(url.encode()).hexdigest()[:12]


FETCHERS = {"feed": fetch_feed, "substack": fetch_substack, "scrape": fetch_scrape, "arxiv": fetch_arxiv}


def main():
    cfg = load_config()
    sources = [s for s in cfg["sources"] if s.get("active", True)]
    old_items = load_json(ITEMS_PATH, {"items": []})["items"]
    watch = load_json(WATCH_PATH, {})
    health = load_json(HEALTH_PATH, {"sources": {}})["sources"]
    now = now_iso()

    resolved = {}

    def work(src):
        try:
            if src["method"] == "auto":
                res = resolve_auto(src, health.get(src["id"]))
                resolved[src["id"]] = res
                src = dict(src, method=res["method"], url=res["url"])
            if src["method"] == "watch":
                return src, run_watch(src, watch.get(src["id"])), None
            if src["method"] == "arxiv":
                time.sleep(3 * [s["id"] for s in sources if s["method"] == "arxiv"].index(src["id"]))
            got = [i for i in FETCHERS[src["method"]](src) if i]
            return src, got, None
        except Exception as e:
            msg = str(e).split("\n")[0][:200]
            return src, None, f"{type(e).__name__}: {msg}"

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(work, sources))

    by_url = {i["url"]: i for i in old_items}
    for src, got, err in results:
        h = health.get(src["id"], {})
        h["checked_at"] = now
        h["method"] = src["method"]
        if src["id"] in resolved:
            h["resolved"] = resolved[src["id"]]
        if err:
            h.update(status="error", error=err)
            print(f"FAIL {src['name']}: {err}")
        elif src["method"] == "watch":
            watch[src["id"]] = got
            h.update(status="ok", error=None, last_success=now)
            print(f"ok   {src['name']}: watched{' (changed)' if got.get('changed_at') == now else ''}")
        else:
            got = [i for i in got if keep_item(src, i)]
            got.sort(key=lambda i: i["published"] or "", reverse=True)
            added = 0
            for it in got[:PER_SOURCE_LIMIT]:
                if it["url"] in by_url:
                    by_url[it["url"]].update(title=it["title"], preview=it["preview"] or by_url[it["url"]].get("preview", ""))
                    continue
                it.update(id=item_id(it["url"]), source=src["id"], fetched=now, countries=tag_countries(src, it))
                # Undated items get the fetch time. Event listings carry future
                # dates; keep those as "event" and sort them by fetch time.
                if not it["published"]:
                    it["published"] = now
                elif it["published"] > (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat():
                    it["event"], it["published"] = it["published"], now
                by_url[it["url"]] = it
                added += 1
            status = "ok" if got else "warn"
            latest = got[0]["published"] if got else h.get("latest")
            h.update(status=status, error=None if got else "Feed returned no items", last_success=now,
                     latest=latest, count=len(got), added=added)
            print(f"ok   {src['name']}: {len(got)} items, {added} new")
        health[src["id"]] = h

    # Future-dated items (event listings) sort by when we saw them instead.
    soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    for it in by_url.values():
        if (it.get("published") or "") > soon:
            it.setdefault("event", it["published"])
            it["published"] = it["fetched"] = min(it.get("fetched") or now, now)

    # Prune: per source keep the newest KEEP_PER_SOURCE, drop very old ones
    # (but always keep a few so quiet sources don't vanish).
    known_ids = {s["id"] for s in cfg["sources"]}
    cutoff = (datetime.now(timezone.utc) - MAX_AGE).isoformat()
    per_source = {}
    for it in sorted(by_url.values(), key=lambda i: i["published"] or "", reverse=True):
        if it.get("source") not in known_ids:
            continue
        lst = per_source.setdefault(it["source"], [])
        if len(lst) >= KEEP_PER_SOURCE:
            continue
        if len(lst) >= MIN_KEEP_PER_SOURCE and (it["published"] or "") < cutoff:
            continue
        lst.append(it)
    items = sorted((i for lst in per_source.values() for i in lst), key=lambda i: i["published"] or "", reverse=True)

    for sid in list(health):
        if sid not in known_ids:
            del health[sid]
    for sid in list(watch):
        if sid not in known_ids:
            del watch[sid]

    save_json(ITEMS_PATH, {"updated": now, "items": items})
    save_json(WATCH_PATH, watch)
    save_json(HEALTH_PATH, {"updated": now, "sources": health})
    failing = sum(1 for s in sources if health.get(s["id"], {}).get("status") == "error")
    print(f"\n{len(items)} items saved; {len(sources)} sources checked, {failing} failing")


if __name__ == "__main__":
    main()
