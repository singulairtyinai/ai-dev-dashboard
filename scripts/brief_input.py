"""Helper for the daily brief, which a scheduled Claude session writes.

  python scripts/brief_input.py
      Print the last 24 hours of items (36 if it was quiet), grouped by
      category, in a compact form for writing the brief.

  python scripts/brief_input.py --validate data/brief.json
      Check a written brief against the schema below and the current items.
      Exits non-zero with the problems listed if anything is wrong.

data/brief.json schema:
{
  "generated_at": "2026-09-28T05:47:00+00:00",   # UTC, ISO 8601
  "headline": "One sentence: the single most important development.",
  "points": [                                      # 3-8 developments, most important first
    {"text": "One or two sentences on what happened and why it matters.",
     "cats": ["mil"],                              # category keys
     "item_ids": ["a1b2c3d4e5f6"]}                 # ids of the items it's based on
  ],
  "categories": {                                  # optional; only categories with news
    "mil": ["bullet", "bullet"]                    # 2-4 short bullets each
  }
}
"""
import json
import sys
from datetime import datetime, timedelta, timezone

from utils import ITEMS_PATH, item_categories, load_config, load_json


def recent_items(hours):
    cfg = load_config()
    sources = {s["id"]: s for s in cfg["sources"] if s.get("active", True)}
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    out = []
    for it in load_json(ITEMS_PATH, {"items": []})["items"]:
        src = sources.get(it.get("source"))
        if not src:
            continue
        # Publication date, so pages first collected today don't count as news.
        if (it.get("published") or "") < cutoff:
            continue
        cats = item_categories(cfg, src, it)
        if cats:
            out.append((it, src, cats))
    return cfg, out


def print_input():
    cfg, items = recent_items(24)
    hours = 24
    if len(items) < 15:
        cfg, items = recent_items(36)
        hours = 36
    print(f"# Items from the last {hours} hours ({len(items)} items)")
    print(f"# Now: {datetime.now(timezone.utc).isoformat(timespec='minutes')}")
    print(f"# Reader's focus keywords: {', '.join(cfg['settings'].get('focus_keywords', []))}\n")
    for cat in cfg["categories"]:
        rows = [(it, src) for it, src, cats in items if cat["key"] in cats]
        if not rows:
            continue
        print(f"## {cat['key']}: {cat['name']} ({len(rows)})")
        for it, src in rows:
            preview = (it.get("preview") or "")[:220]
            print(f"- [{it['id']}] {it['title']} | {src['name']} ({src.get('type', '')}) | {it['published'][:10]}"
                  + (f"\n    {preview}" if preview else ""))
        print()


def validate(path):
    cfg = load_config()
    cats = {c["key"] for c in cfg["categories"]}
    ids = {i["id"] for i in load_json(ITEMS_PATH, {"items": []})["items"]}
    problems = []
    try:
        brief = json.load(open(path))
    except Exception as e:
        print(f"Not valid JSON: {e}")
        sys.exit(1)
    try:
        t = datetime.fromisoformat(brief["generated_at"])
        if t.tzinfo is None:
            problems.append("generated_at needs a timezone (use +00:00)")
    except Exception:
        problems.append("generated_at missing or not ISO 8601")
    if not isinstance(brief.get("headline"), str) or not 10 <= len(brief["headline"]) <= 300:
        problems.append("headline must be a sentence of 10-300 characters")
    points = brief.get("points")
    if not isinstance(points, list) or not 3 <= len(points) <= 8:
        problems.append("points must be a list of 3-8 entries")
        points = []
    for n, p in enumerate(points, 1):
        if not isinstance(p.get("text"), str) or not 20 <= len(p["text"]) <= 600:
            problems.append(f"point {n}: text must be 20-600 characters")
        bad_cats = [c for c in p.get("cats", []) if c not in cats]
        if not p.get("cats") or bad_cats:
            problems.append(f"point {n}: cats must be non-empty and from {sorted(cats)} (bad: {bad_cats})")
        bad_ids = [i for i in p.get("item_ids", []) if i not in ids]
        if not p.get("item_ids") or bad_ids:
            problems.append(f"point {n}: item_ids must be non-empty ids from items.json (unknown: {bad_ids})")
    for key, bullets in (brief.get("categories") or {}).items():
        if key not in cats:
            problems.append(f"categories: unknown key {key}")
        elif not isinstance(bullets, list) or not 1 <= len(bullets) <= 5 or not all(isinstance(b, str) and b for b in bullets):
            problems.append(f"categories.{key}: must be 1-5 non-empty strings")
    extra = set(brief) - {"generated_at", "headline", "points", "categories", "model"}
    if extra:
        problems.append(f"unexpected fields: {sorted(extra)}")
    if problems:
        print("Brief has problems:\n- " + "\n- ".join(problems))
        sys.exit(1)
    print(f"OK: {len(points)} points, {len(brief.get('categories') or {})} category summaries")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--validate":
        validate(sys.argv[2])
    else:
        print_input()
