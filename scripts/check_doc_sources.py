"""Probe every source from the "Index of Sources on AI" document and classify
how the dashboard can pull updates from it:

  FEED     a working RSS/Atom feed was found (URL printed)
  PROXY    *.substack.com feed reachable only via rss2json
  PAGE     no feed found, but the page loads (candidate for scraping)
  BLOCKED  page itself refuses GitHub runners (403/429/...)
  DEAD     DNS / connection error or 404

Usage: python scripts/check_doc_sources.py
"""
from datetime import datetime, timezone
from urllib.parse import quote, urljoin

import feedparser
import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; ai-dev-dashboard-bot/1.0)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
TIMEOUT = 20
SUFFIXES = ["feed", "feed/", "rss", "rss.xml", "feed.xml", "index.xml", "atom.xml"]

# (category, name, page, [extra feed candidates])
SOURCES = [
    ("Geopolitics", "ChinaTalk", "https://www.chinatalk.media", ["https://www.chinatalk.media/feed"]),
    ("Geopolitics", "Axios Technology", "https://www.axios.com/technology", ["https://api.axios.com/feed/"]),
    ("Geopolitics", "Carnegie - AI", "https://carnegieendowment.org/topics/ai", []),
    ("Geopolitics", "Belfer Center - TAPP", "https://www.belfercenter.org/technology-and-public-purpose", []),
    ("Geopolitics", "Chatham House - Intl Security", "https://www.chathamhouse.org/about-us/our-departments/international-security-programme", []),
    ("Governance", "AI Policy Bulletin", "https://newsletter.aipolicybulletin.org", []),
    ("Governance", "Policy Gradients", "https://policygradients.thefai.org", []),
    ("Governance", "Transformer", "https://www.transformernews.ai", []),
    ("Governance", "FYI This Week (AIP)", "https://www.aip.org/fyi", ["https://www.aip.org/fyi.rss"]),
    ("Governance", "AI Frontiers - Policy", "https://ai-frontiers.org/topic/policy-and-regulation", []),
    ("Governance", "OECD.AI", "https://oecd.ai", ["https://oecd.ai/en/feed"]),
    ("Governance", "EU AI Act portal", "https://artificialintelligenceact.eu", []),
    ("Governance", "IAPP AI Governance", "https://iapp.org/resources/topics/artificial-intelligence-1/", ["https://iapp.org/rss/daily-dashboard/"]),
    ("Governance", "EFF - AI", "https://www.eff.org/ai", ["https://www.eff.org/rss/updates.xml"]),
    ("Security & Risk", "METR Blog", "https://metr.org/blog/", []),
    ("Security & Risk", "CAIS", "https://www.safe.ai", ["https://newsletter.safe.ai/feed"]),
    ("Security & Risk", "UK AISI", "https://www.aisi.gov.uk", ["https://www.aisi.gov.uk/blog", "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=ai-security-institute"]),
    ("Security & Risk", "NIST AISI / CAISI", "https://www.nist.gov/artificial-intelligence/aisi", ["https://www.nist.gov/news-events/artificial-intelligence/rss.xml"]),
    ("Jobs & Economy", "AI Frontiers - Jobs", "https://ai-frontiers.org/topic/jobs-and-economy", []),
    ("Jobs & Economy", "ILO", "https://www.ilo.org/topics/employment-and-labour-markets", ["https://www.ilo.org/rss.xml"]),
    ("Jobs & Economy", "McKinsey Global Institute", "https://www.mckinsey.com/mgi/our-research", ["https://www.mckinsey.com/insights/rss"]),
    ("Peace & Disarmament", "AI Frontiers - Security", "https://ai-frontiers.org/topic/security", []),
    ("Peace & Disarmament", "UNODA - Emerging Tech", "https://disarmament.unoda.org/emerging-technologies/", ["https://disarmament.unoda.org/feed/"]),
    ("Peace & Disarmament", "SIPRI - Emerging Tech", "https://www.sipri.org/research/armament-and-disarmament/emerging-military-and-security-technologies", ["https://www.sipri.org/rss/combined.xml"]),
    ("Military", "CSET", "https://cset.georgetown.edu", ["https://cset.georgetown.edu/feed/", "https://cset.georgetown.edu/publications/feed/"]),
    ("Military", "NATO CCDCOE", "https://ccdcoe.org", ["https://ccdcoe.org/feed/", "https://ccdcoe.org/news/feed/"]),
    ("Military", "UNIDIR - AI", "https://unidir.org/topics/artificial-intelligence/", ["https://unidir.org/feed/"]),
    ("Military", "CNAS - Defense", "https://www.cnas.org/research/defense", ["https://www.cnas.org/feed", "https://www.cnas.org/rss"]),
    ("Tech & Research", "Interconnects", "https://www.interconnects.ai", []),
    ("Tech & Research", "MIT Tech Review - AI", "https://www.technologyreview.com/topic/artificial-intelligence/", ["https://www.technologyreview.com/topic/artificial-intelligence/feed"]),
    ("Tech & Research", "METR Research", "https://metr.org/research/", []),
    ("Tech & Research", "Papers with Code", "https://paperswithcode.com", []),
    ("Tech & Research", "Hugging Face Papers", "https://huggingface.co/papers", []),
    ("Hardware", "SemiAnalysis", "https://semianalysis.com", ["https://newsletter.semianalysis.com/feed", "https://www.semianalysis.com/feed"]),
    ("Hardware", "IEEE Spectrum - Semis", "https://spectrum.ieee.org/semiconductors", ["https://spectrum.ieee.org/feeds/topic/semiconductors.rss"]),
    ("Models & Trackers", "Import AI", "https://jack-clark.net", ["https://jack-clark.net/feed/"]),
    ("Models & Trackers", "Zvi Mowshowitz (substack)", "https://thezvi.substack.com", ["https://thezvi.substack.com/feed"]),
    ("Models & Trackers", "Zvi Mowshowitz (wordpress mirror)", "https://thezvi.wordpress.com", ["https://thezvi.wordpress.com/feed/"]),
    ("Models & Trackers", "LMSYS / LMArena", "https://lmarena.ai", ["https://lmsys.org/rss.xml", "https://blog.lmarena.ai/rss.xml", "https://news.lmarena.ai/rss/"]),
    ("Models & Trackers", "HF Open LLM Leaderboard", "https://huggingface.co/spaces/HuggingFaceH4/open_llm_leaderboard", []),
    ("Multilateral", "UN Tech Envoy / GDC", "https://www.un.org/techenvoy/global-digital-compact", ["https://www.un.org/techenvoy/rss.xml"]),
    ("Multilateral", "UNESCO - AI", "https://www.unesco.org/en/artificial-intelligence", []),
    ("Multilateral", "ITU AI for Good", "https://aiforgood.itu.int", ["https://aiforgood.itu.int/feed/"]),
    ("Space", "UNOOSA", "https://www.unoosa.org", []),
    ("Space", "Secure World Foundation", "https://swfound.org", ["https://swfound.org/feed/", "https://swfound.org/news/feed/"]),
]


def get(url):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if r.status_code == 403:
        r = requests.get(url, headers={"User-Agent": BROWSER_UA}, timeout=TIMEOUT)
    return r


def as_feed(url):
    try:
        r = get(url)
    except Exception:
        return None
    if r.status_code != 200:
        return None
    feed = feedparser.parse(r.content)
    return feed if feed.entries else None


def latest(feed):
    best = None
    for e in feed.entries:
        t = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
        if t:
            d = datetime(*t[:6], tzinfo=timezone.utc)
            if not best or d > best[0]:
                best = (d, e.get("title", ""))
    return best


def probe(page, extras):
    try:
        r = get(page)
        page_status = r.status_code
        html = r.text if r.status_code == 200 else ""
    except Exception as e:
        return "DEAD", f"{type(e).__name__}", None
    candidates = list(extras)
    if html:
        soup = BeautifulSoup(html, "html.parser")
        for l in soup.find_all("link", rel="alternate"):
            if l.get("href") and "xml" in (l.get("type") or ""):
                candidates.append(urljoin(page, l["href"]))
    base = page.rstrip("/") + "/"
    candidates += [base + s for s in SUFFIXES]
    seen = set()
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        feed = as_feed(c)
        if feed:
            return "FEED", c, feed
    if ".substack.com" in page:
        url = "https://api.rss2json.com/v1/api.json?rss_url=" + quote(page.rstrip("/") + "/feed", safe="")
        try:
            j = requests.get(url, timeout=TIMEOUT).json()
            if j.get("status") == "ok" and j.get("items"):
                return "PROXY", url, j["items"][0]
        except Exception:
            pass
    if page_status == 200:
        return "PAGE", f"HTTP 200, no feed found", None
    if page_status == 404:
        return "DEAD", "HTTP 404", None
    return "BLOCKED", f"HTTP {page_status}", None


def main():
    now = datetime.now(timezone.utc)
    for cat, name, page, extras in SOURCES:
        status, detail, feed = probe(page, extras)
        extra = ""
        if status == "FEED":
            lt = latest(feed)
            if lt:
                extra = f" | latest {lt[0].date()} ({(now - lt[0]).days}d) :: {lt[1][:60]}"
            else:
                extra = f" | {len(feed.entries)} entries, undated"
        elif status == "PROXY":
            extra = f" | latest {feed.get('pubDate')} :: {feed.get('title', '')[:60]}"
        print(f"{status:<8}| {cat:<20}| {name:<34}| {detail}{extra}")


if __name__ == "__main__":
    main()
