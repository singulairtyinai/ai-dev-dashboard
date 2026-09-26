"""Write a short "what happened" summary per category to data/summaries.json.

Primary path: GitHub Models (OpenAI-compatible API), authenticated with the
GITHUB_TOKEN every Actions run gets (the workflow grants `models: read`).
Fallback: a small extractive summarizer that ranks sentences from the last
48 hours of titles and previews by word frequency.

Each category gets one AI summary per UTC day. A category that only got the
fallback summary is retried on the next run.
"""
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

import requests

from utils import ITEMS_PATH, SUMMARIES_PATH, item_categories, load_config, load_json, save_json

# Current GitHub Models endpoint first, then the older Azure-hosted one.
ENDPOINTS = [
    ("https://models.github.ai/inference/chat/completions", "openai/gpt-4o-mini"),
    ("https://models.inference.ai.azure.com/chat/completions", "gpt-4o-mini"),
]
WINDOW = timedelta(hours=48)

STOPWORDS = set("the a an of to in on for and or is are at by with from as it its this that be has have will new "
                "says after over into how why what ai vs amid than their not".split())


def llm_bullets(label, lines, token):
    prompt = (
        f'Here are the latest items from the "{label}" section of an AI developments dashboard:\n\n'
        + "\n".join(lines)
        + "\n\nSummarize the 3-5 developments that matter most, as short bullet points. Be concrete: name the "
        "model, company, country, policy or paper. If there is not enough substance for 3 points, write fewer. "
        "Output only the bullet points, one per line, each starting with '- '."
    )
    errors = []
    for url, model in ENDPOINTS:
        body = ""
        try:
            r = requests.post(url, timeout=40, headers={
                "Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json",
            }, json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "max_tokens": 350})
            body = r.text[:160]
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
            break
        except Exception as e:
            errors.append(f"{url} -> {type(e).__name__}: {str(e)[:120]} (response: {body!r})")
    else:
        raise RuntimeError(" | ".join(errors))
    bullets = [l.strip().lstrip("-•* ").strip() for l in text.splitlines() if l.strip().startswith(("-", "•", "*"))]
    if not bullets:
        raise ValueError("model returned no bullet points")
    return bullets


def extractive(items, n=4):
    freq, sentences = Counter(), []
    for it in items:
        for text in (it["title"], it.get("preview") or ""):
            for s in re.split(r"(?<=[.!?])\s+", text):
                if len(s) < 25:
                    continue
                sentences.append(s.strip())
                freq.update(w for w in re.findall(r"[a-z0-9][a-z0-9\-]{2,}", s.lower()) if w not in STOPWORDS)

    def score(s):
        words = re.findall(r"[a-z0-9][a-z0-9\-]{2,}", s.lower())
        return sum(freq[w] for w in words if w not in STOPWORDS) / max(len(words), 1)

    return sorted(set(sentences), key=score, reverse=True)[:n]


def main():
    cfg = load_config()
    sources = {s["id"]: s for s in cfg["sources"]}
    cats_of = {i["url"]: item_categories(cfg, sources[i["source"]], i) for i in load_json(ITEMS_PATH, {"items": []})["items"] if i.get("source") in sources}
    items = load_json(ITEMS_PATH, {"items": []})["items"]
    out = load_json(SUMMARIES_PATH, {})
    token = os.environ.get("GITHUB_TOKEN")
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    cutoff = (now - WINDOW).isoformat()

    for cat in cfg["categories"]:
        key = cat["key"]
        prev = out.get(key, {})
        if (prev.get("generated_at") or "")[:10] == today and prev.get("method") == "llm":
            print(f"[{key}] already summarized today")
            continue
        recent = [i for i in items if key in cats_of.get(i["url"], []) and (i["published"] or "") >= cutoff][:25]
        if len(recent) < 2:
            print(f"[{key}] not enough recent items")
            continue
        lines = [f"- {i['title']}" + (f": {i['preview']}" if i.get("preview") else "") for i in recent]
        method, bullets = "extractive", []
        if token:
            try:
                bullets, method = llm_bullets(cat["name"], lines, token), "llm"
            except Exception as e:
                print(f"[{key}] GitHub Models failed ({e}); using extractive summary")
        if not bullets:
            bullets = extractive(recent)
        out[key] = {"generated_at": now.isoformat(timespec="seconds"), "method": method, "bullets": bullets, "based_on": len(recent)}
        print(f"[{key}] {len(bullets)} bullets via {method}")

    save_json(SUMMARIES_PATH, out)


if __name__ == "__main__":
    main()
