# AI Watchtower

A dashboard for AI developments across ten categories: geopolitics, governance,
security and risk, jobs and economy, peace and disarmament, military, research,
hardware, models, and multilateral organizations. Sources are fetched every two
hours, and an email digest goes out every 2.5 hours when something is new.

**Stack:** static site on GitHub Pages, GitHub Actions for fetching and email,
JSON files in `data/` as the data store. No server or paid hosting.

## Pages

- **Briefing** – the top developments of the week, ranked by your focus
  keywords, source type and recency; category tiles with 14-day trend lines;
  changes on watched institution pages; the most active sources.
- **Categories** – one feed per category, filterable by source type and source,
  with a daily AI summary at the top. Items new since your last visit get an
  amber dot.
- **World** – countries and blocs mentioned in the news; select one for its
  timeline.
- **Library** – key reports, readings and trackers.
- **Saved** – items you starred (kept in your browser).
- **Admin** – manage sources, categories, focus keywords, email alerts and the
  library.

Press `/` to search everything. In a feed, `j`/`k` move, `o` opens, `s` saves
and `m` marks read or unread.

## How sources are read

Each source in `data/sources.json` has a `method`:

| Method | Used for |
|---|---|
| `feed` | RSS/Atom feeds |
| `substack` | `*.substack.com` newsletters, read through rss2json because Substack blocks GitHub's servers |
| `scrape` | article listing pages without a feed (e.g. AI Frontiers topic pages) |
| `arxiv` | arXiv search queries such as `cat:cs.AI` |
| `watch` | pages with no feed: new headings and links are reported as changes |
| `auto` | plain web addresses added in the admin panel: the next run finds a feed, or falls back to `watch` |

`scripts/fetch_all.py` writes `data/items.json`, `data/watch.json` and
`data/health.json` (status of every source, shown in Admin → Sources).
`scripts/summarize.py` writes a daily summary per category to
`data/summaries.json` using GitHub Models, with a simple extractive fallback.

## Category filters

A category can require keywords, so general news from its sources is left
out. Military, for example, only shows items that mention an AI term *and* a
military term. Edit the lists in Admin → Categories → Filter. ALL-CAPS words
(AI, LLM, CDAO) match exactly; other words also match longer forms (drone →
drones). The filter applies to everything already fetched, the email alerts
and the category summaries.

## Admin panel

Open **Admin** in the sidebar (or `control-panel.html`, which redirects there).
You need the admin password and a fine-grained GitHub token for this repository
with:

- **Contents: read and write** – to save changes to `data/sources.json`
- **Actions: read and write** – for the "Refresh all sources now" and "Send
  alert now" buttons

The token is kept in the browser tab's session storage only. The password hash
in `assets/js/site-config.js` is public, so the password only keeps casual
visitors out; the token is what protects the repository.

To change the password, put the SHA-256 of the new one in `site-config.js`:

```
echo -n "new-password" | shasum -a 256
```

## Email alerts

`.github/workflows/send-alerts.yml` runs every 2.5 hours (00:00, 02:30, 05:00 …
UTC) and emails the items not included in an earlier email, grouped by
category. Nothing is sent when nothing is new. Categories, "focus keywords
only" and an on/off switch are in Admin → Email alerts.

It sends through Gmail and needs three repository secrets (Settings → Secrets
and variables → Actions):

| Secret | Value |
|---|---|
| `ALERT_EMAIL_TO` | the address that receives alerts |
| `GMAIL_ADDRESS` | the Gmail account that sends them |
| `GMAIL_APP_PASSWORD` | an app password for that account (Google Account → Security → 2-Step Verification → App passwords) |

The recipient address is kept as a secret so it never appears in this public
repository.

## Checking new sources

`scripts/check_feeds.py`, `scripts/check_doc_sources.py` and
`scripts/check_substack.py` test candidate sources from GitHub Actions (run
"Check candidate feeds" in the Actions tab).

## Local development

```
pip install -r requirements.txt
python scripts/fetch_all.py
python -m http.server 8000   # then open http://localhost:8000
```
