"""Fetch recent posts from configured X accounts via the X API (Basic tier).

Requires env var X_BEARER_TOKEN (set as a GitHub Actions secret).
Uses the recent-search / user-timeline endpoints — check current X API docs
for the exact endpoint your Basic tier plan includes, as this has changed
over time and may again.
"""
import os
import urllib.request
import json
from datetime import datetime, timezone
from utils import load_sources, save_items

X_API_BASE = "https://api.x.com/2"
BEARER_TOKEN = os.environ.get("X_BEARER_TOKEN")


def api_get(path, params=None):
    url = f"{X_API_BASE}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {BEARER_TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_user_id(handle):
    data = api_get(f"/users/by/username/{handle}")
    return data.get("data", {}).get("id")


def get_recent_tweets(user_id, max_results=10):
    data = api_get(
        f"/users/{user_id}/tweets",
        {"max_results": max_results, "tweet.fields": "created_at"},
    )
    return data.get("data", [])


def run():
    if not BEARER_TOKEN:
        print("[x_feed] X_BEARER_TOKEN not set, skipping")
        return

    categories = load_sources()
    cfg = categories.get("x_feed")
    if not cfg:
        return

    new_items = []
    for src in cfg["sources"]:
        if not src.get("active", True):
            continue
        try:
            user_id = get_user_id(src["handle"])
            if not user_id:
                continue
            for tweet in get_recent_tweets(user_id):
                new_items.append({
                    "title": tweet["text"][:180],
                    "url": f"https://x.com/{src['handle']}/status/{tweet['id']}",
                    "source": src["name"],
                    "published": tweet.get("created_at"),
                })
        except Exception as e:
            print(f"[x_feed] failed to fetch {src['name']}: {e}")

    save_items("x_feed", new_items)


if __name__ == "__main__":
    run()
