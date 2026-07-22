# AI Developments Dashboard

A public, auto-updating dashboard tracking AI developments across seven
channels — overall developments, hardware, governance, tools & applications,
military use, an X/Twitter feed, and recent research papers — plus a
password-gated control panel for managing sources.

**Stack:** static site (GitHub Pages) + GitHub Actions (scheduled fetch jobs)
+ JSON files as the data store. No paid hosting required, aside from the X
API Basic tier you've already decided to use.

## 1. Create the repo

1. Create a new **public** GitHub repo, e.g. `ai-dev-dashboard`.
2. Push everything in this folder to it:
   ```
   git init
   git add .
   git commit -m "Initial dashboard scaffold"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/ai-dev-dashboard.git
   git push -u origin main
   ```
3. In repo Settings → Pages, set source to "Deploy from branch", branch
   `main`, folder `/ (root)`. Your dashboard will be live at
   `https://YOUR_USERNAME.github.io/ai-dev-dashboard/`.

## 2. Set up the X API secret

1. Get a Basic tier key from the X Developer Portal, generate a Bearer Token.
2. In the repo: Settings → Secrets and variables → Actions → New repository
   secret. Name it `X_BEARER_TOKEN`, paste the token.

## 3. Configure the site

Open `assets/js/site-config.js` and fill in the shared config — this one file
is used by both `dashboard.js` (for the manual refresh button) and
`control-panel.js` (for source editing):

```js
const SITE_CONFIG = {
  owner: 'YOUR_GITHUB_USERNAME',
  repo: 'ai-dev-dashboard',
  branch: 'main',
  sourcesPath: 'data/sources.json',
  workflowFile: 'fetch-data.yml',
  passwordHashSHA256: 'REPLACE_WITH_YOUR_PASSWORD_HASH',
};
```

Generate your password hash locally (never send the plaintext password
anywhere):

```
echo -n "your-chosen-password" | shasum -a 256
```

Copy the resulting hash into `passwordHashSHA256`.

### Getting a GitHub token for the control panel

The control panel writes changes to `data/sources.json` via the GitHub API,
authenticated with a **fine-grained Personal Access Token** you paste in each
session (stored only in the browser's `sessionStorage`, cleared when the tab
closes — never written to disk or committed):

1. GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
2. Repository access: only this repo.
3. Permissions: **Contents: Read and write**.
4. Set an expiration (30–90 days is reasonable; regenerate when it lapses).

**Important — read this:** the password gate deters casual visitors, but
since this is a static site, the password hash is visible to anyone who
views the page source. The actual protection is the GitHub token: without a
valid, repo-scoped token, no write can reach your repo. Don't treat the
password as a real security boundary — treat the token as the boundary, and
don't share it.

## 4. Customize your sources

Edit `data/sources.json` directly (via git or the GitHub web UI) to seed your
initial source list, or add them through the control panel once it's live.
Categories: `overall`, `hardware`, `governance`, `tools`, `military`,
`x_feed`, `papers`. Each category has a `type` (`rss`, `x_api`, or `arxiv`)
that determines which fetch script handles it and what field the control
panel asks for (feed URL, X handle, or arXiv search query).

## 5. Test the fetch pipeline

Go to the Actions tab → "Fetch AI Developments Data" → Run workflow (this
uses the `workflow_dispatch` trigger, so you don't have to wait for the daily
schedule). Check that `data/articles/*.json` files get updated and committed.

## 6. Adjust the schedule

Edit the cron expression in `.github/workflows/fetch-data.yml` — it currently
runs every 2 hours. Free-tier scheduled GitHub Actions runs aren't guaranteed
to the minute and can lag under load.

## Dashboard features

- **Search** — the search box filters items across all channels by title,
  preview text, and source name as you type.
- **Category chips** — click a chip to hide/show that channel without
  reloading; state resets on page refresh (not persisted).
- **Expandable cards** — items with preview text (RSS descriptions, arXiv
  abstracts, full X post text) expand on click to show it.
- **Sparklines** — each channel header shows a mini trend line built from
  `data/history/<category>.json`, which the fetch pipeline appends to on
  every run (last ~60 points, roughly 5 days at a 2-hour cadence).
- **Trending keywords** — computed client-side from the currently loaded
  item titles (simple word-frequency, no LLM); click a keyword to filter.
- **Governance signal map** — plots governance items by country on a
  stylized grid using a small built-in coordinate table
  (`COUNTRY_COORDS` in `dashboard.js`). Only appears if at least one
  governance item has a resolvable `country` field — set this per-source
  in `data/sources.json` (see the `governance` category for examples).
  This is an equirectangular approximation for visual signal, not a
  precise map.
- **Manual refresh** — the "Refresh now" button on the dashboard triggers
  the fetch workflow immediately via the GitHub API. It asks for a
  GitHub token the same way the control panel does (fine-grained,
  **Actions: write** scope this time, not Contents) — session-only,
  never stored on disk. Since the dashboard is public, anyone can click
  the button, but without a valid token with write access to your repo's
  Actions, nothing happens — so this is safe to leave live.

## Local development

```
pip install -r requirements.txt
python scripts/fetch_rss.py
python scripts/fetch_arxiv.py
X_BEARER_TOKEN=xxx python scripts/fetch_x.py
python -m http.server 8000   # then open http://localhost:8000
```

## Notes / known limitations

- X API endpoints and rate limits on the Basic tier change periodically —
  check current docs before relying on `fetch_x.py` as-is.
- RSS feed URLs in `data/sources.json` are placeholders/examples — verify and
  replace with the specific outlets you want per category.
- No LLM summarization step yet (raw feed titles/links only) — can be added
  as a later enhancement if you want summarized/filtered items instead of
  raw titles.
