"""Email a digest of new items, grouped by category.

Runs on a schedule (see .github/workflows/send-alerts.yml). Each run:
  1. Loads data/items.json and the categories and alert settings in
     data/sources.json (editable in the dashboard's admin panel).
  2. Picks the items not included in a previous email (tracked by URL in
     data/alerts/state.json).
  3. If anything is new, sends one email with a section per updated category.

Nothing is sent when no category has new items, or when alerts are switched
off in the admin panel.

Configuration comes from environment variables so that no address or
password is ever committed to this public repo:
  ALERT_EMAIL_TO       recipient address (GitHub secret)
  GMAIL_ADDRESS        Gmail account the email is sent from (GitHub secret)
  GMAIL_APP_PASSWORD   16-character app password for that account (GitHub secret)
  DASHBOARD_URL        link to the live dashboard (optional)

Usage:
  python scripts/send_alerts.py            # send and update state
  python scripts/send_alerts.py --dry-run  # write alert-preview.html, send nothing
"""
import html
import json
import os
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from utils import DATA_DIR, ITEMS_PATH, load_config, load_json

STATE_PATH = os.path.join(DATA_DIR, "alerts", "state.json")
DEFAULT_DASHBOARD = "https://singulairtyinai.github.io/ai-dev-dashboard/"
MAX_ITEMS_PER_CATEGORY = 8
MAX_SEEN_URLS = 5000
# On the very first run there is no record of what was already sent, so only
# items published in this window are emailed; everything else is marked seen.
FIRST_RUN_WINDOW = timedelta(hours=24)


def load_state():
    if not os.path.exists(STATE_PATH):
        return None
    with open(STATE_PATH) as f:
        return json.load(f)


def save_state(seen, now):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump({"last_run": now.isoformat(), "seen_urls": seen[-MAX_SEEN_URLS:]}, f, indent=2)


def parse_time(value):
    if not value:
        return None
    try:
        t = datetime.fromisoformat(value)
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def clean(value):
    """Feeds sometimes double-encode entities (e.g. "&amp;#8220;"); decode fully."""
    return html.unescape(html.unescape(value or "")).strip()


def time_label(published, now):
    t = parse_time(published)
    if not t:
        return ""
    minutes = int((now - t).total_seconds() // 60)
    if minutes < 60:
        return f"{max(minutes, 1)}m ago"
    if minutes < 48 * 60:
        return f"{minutes // 60}h ago"
    return t.strftime("%d %b")


def matches_focus(item, keywords):
    text = f"{item.get('title', '')} {item.get('preview', '')}".lower()
    return any(k.lower() in text for k in keywords)


def collect_new(cfg, items, seen, first_run, now):
    """Return [(category_name, [items])] for categories with unseen items,
    plus every URL currently in the data (to record as seen)."""
    alerts = cfg.get("settings", {}).get("alerts", {})
    wanted = set(alerts.get("categories") or [c["key"] for c in cfg["categories"]])
    focus = cfg.get("settings", {}).get("focus_keywords", [])
    sources = {s["id"]: s for s in cfg["sources"]}
    seen_set = set(seen)
    all_urls, by_cat = [], {}
    for item in items:
        url = item.get("url")
        src = sources.get(item.get("source"))
        if not url or not src:
            continue
        all_urls.append(url)
        if url in seen_set:
            continue
        if first_run:
            t = parse_time(item.get("fetched") or item.get("published"))
            if not t or now - t > FIRST_RUN_WINDOW:
                continue
        if alerts.get("focus_only") and not matches_focus(item, focus):
            continue
        item = dict(item, source=src["name"])
        for key in src["cats"]:
            if key in wanted:
                by_cat.setdefault(key, []).append(item)
    sections = []
    for cat in cfg["categories"]:
        new = by_cat.get(cat["key"])
        if new:
            new.sort(key=lambda i: i.get("published") or "", reverse=True)
            sections.append((cat["name"], new))
    sections.sort(key=lambda s: len(s[1]), reverse=True)
    return sections, all_urls


def unique_count(sections):
    return len({i["url"] for _, items in sections for i in items})


def build_subject(sections):
    total = unique_count(sections)
    n = len(sections)
    return f"AI Watchtower: {total} new update{'s' * (total != 1)} in {n} categor{'ies' if n != 1 else 'y'}"


def build_text(sections, now, dashboard):
    lines = [build_subject(sections), ""]
    for label, items in sections:
        lines.append(f"== {label} ({len(items)} new) ==")
        for item in items[:MAX_ITEMS_PER_CATEGORY]:
            meta = " · ".join(x for x in (item.get("source"), time_label(item.get("published"), now)) if x)
            lines.append(f"- {clean(item.get('title')) or 'Untitled'}")
            if meta:
                lines.append(f"  {meta}")
            lines.append(f"  {item['url']}")
        if len(items) > MAX_ITEMS_PER_CATEGORY:
            lines.append(f"  ...and {len(items) - MAX_ITEMS_PER_CATEGORY} more on the dashboard")
        lines.append("")
    lines.append(f"Open the dashboard: {dashboard}")
    return "\n".join(lines)


def build_html(sections, now, dashboard):
    e = html.escape
    total = unique_count(sections)
    summary = ", ".join(f"{e(label)} ({len(items)})" for label, items in sections)
    parts = []
    for label, items in sections:
        rows = []
        for item in items[:MAX_ITEMS_PER_CATEGORY]:
            meta = " · ".join(e(x) for x in (item.get("source") or "", time_label(item.get("published"), now)) if x)
            preview = clean(item.get("preview"))
            rows.append(
                f'<tr><td style="padding:10px 0;border-top:1px solid #23272F">'
                f'<a href="{e(item["url"], quote=True)}" style="color:#ECE7DD;text-decoration:none;font-size:15px;line-height:1.35;font-weight:600">{e(clean(item.get("title")) or "Untitled")}</a>'
                f'<div style="color:#8C9099;font-size:12px;margin-top:3px;font-family:Menlo,Consolas,monospace">{meta}</div>'
                + (f'<div style="color:#A9ADB5;font-size:13px;line-height:1.45;margin-top:4px">{e(preview)}</div>' if preview else "")
                + "</td></tr>"
            )
        more = len(items) - MAX_ITEMS_PER_CATEGORY
        if more > 0:
            rows.append(f'<tr><td style="padding:8px 0;color:#8C9099;font-size:13px">and {more} more on the dashboard</td></tr>')
        parts.append(
            f'<tr><td style="padding:22px 0 4px">'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
            f'<tr><td style="font-size:17px;font-weight:700;color:#ECE7DD">{e(label)}'
            f'<span style="float:right;color:#F2B84B;font-size:12px;font-weight:600;font-family:Menlo,Consolas,monospace">{len(items)} new</span></td></tr>'
            + "".join(rows)
            + "</table></td></tr>"
        )
    sent_at = now.strftime("%d %b %Y, %H:%M UTC")
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#07080A">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07080A">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0E1014;border:1px solid #23272F;border-radius:12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<tr><td style="padding:24px 24px 8px">
<div style="color:#F2B84B;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-family:Menlo,Consolas,monospace">AI Watchtower · {e(sent_at)}</div>
<div style="color:#ECE7DD;font-size:22px;font-weight:700;margin-top:8px">{total} new update{'s' * (total != 1)} since the last alert</div>
<div style="color:#8C9099;font-size:14px;margin-top:6px">Updated categories: {summary}</div>
</td></tr>
<tr><td style="padding:0 24px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">{''.join(parts)}</table>
</td></tr>
<tr><td style="padding:22px 24px 26px">
<a href="{e(dashboard, quote=True)}" style="display:inline-block;background:#F2B84B;color:#1A1204;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:8px">Open the dashboard</a>
<div style="color:#5A5F69;font-size:12px;margin-top:16px">Sent every 2.5 hours when there is something new. To pause them, switch alerts off in the dashboard's Admin → Email alerts.</div>
</td></tr>
</table></td></tr></table></body></html>"""


def send(subject, text, html_body):
    to_addr = os.environ["ALERT_EMAIL_TO"]
    from_addr = os.environ["GMAIL_ADDRESS"]
    password = os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"AI Watchtower <{from_addr}>"
    msg["To"] = to_addr
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(from_addr, password)
        smtp.send_message(msg)


def main():
    dry_run = "--dry-run" in sys.argv
    now = datetime.now(timezone.utc)
    dashboard = os.environ.get("DASHBOARD_URL") or DEFAULT_DASHBOARD

    state = load_state()
    first_run = state is None
    seen = state["seen_urls"] if state else []

    cfg = load_config()
    if not cfg.get("settings", {}).get("alerts", {}).get("enabled", True):
        print("Email alerts are switched off in the admin panel; nothing sent.")
        return
    items = load_json(ITEMS_PATH, {"items": []})["items"]
    sections, all_urls = collect_new(cfg, items, seen, first_run, now)
    new_seen = seen + [u for u in dict.fromkeys(all_urls) if u not in set(seen)]

    if not sections:
        print("No new items since the last alert; nothing sent.")
        if not dry_run:
            save_state(new_seen, now)
        return

    subject = build_subject(sections)
    text = build_text(sections, now, dashboard)
    html_body = build_html(sections, now, dashboard)

    if dry_run:
        out = os.path.join(os.path.dirname(__file__), "..", "alert-preview.html")
        with open(out, "w") as f:
            f.write(html_body)
        print(f"[dry run] {subject}")
        print(f"[dry run] preview written to {os.path.normpath(out)}")
        return

    missing = [k for k in ("ALERT_EMAIL_TO", "GMAIL_ADDRESS", "GMAIL_APP_PASSWORD") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing secrets: {', '.join(missing)}. Add them in Settings → Secrets and variables → Actions.")

    send(subject, text, html_body)
    save_state(new_seen, now)
    print(f"Sent: {subject}")


if __name__ == "__main__":
    main()
