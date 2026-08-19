"""Generate a short "what happened today" summary per category.

Primary path: GitHub Models (free tier, OpenAI-compatible API), authenticated
with the GITHUB_TOKEN that's automatically available in every GitHub Actions
run -- no new secret, no new signup, no billing. See:
https://docs.github.com/en/github-models

Fallback path: if the API call fails for ANY reason (rate limited, network
error, no token available e.g. when running this locally, model refuses,
malformed response, request timeout) -- a small local extractive summarizer
runs instead. It picks the most representative sentences from the day's
titles/previews using basic word-frequency scoring. Lower quality than an
LLM summary, but it has zero external dependency and can never break from a
third party changing their free-tier terms.

Self-throttling: this only generates a NEW summary once per category per UTC
calendar day, even though the workflow runs every 2 hours. If
data/summaries/<category>.json already has today's date, it's skipped. This
keeps usage well within GitHub Models' free-tier limits and avoids
regenerating the same content 12x/day for no benefit.
"""
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone

import requests

from utils import DATA_DIR, load_sources, load_existing

SUMMARIES_DIR = os.path.join(DATA_DIR, "summaries")

# GitHub Models: OpenAI-compatible endpoint, authenticated with GITHUB_TOKEN.
GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions"
GITHUB_MODELS_MODEL = "gpt-4o-mini"  # smaller/cheaper model = more headroom on free-tier limits
REQUEST_TIMEOUT = 30

STOPWORDS = set(['the','a','an','of','to','in','on','for','and','or','is','are',
  'at','by','with','from','as','it','its','this','that','be','has','have','will','new',
  'says','after','over','into','how','why','what','ai','vs','amid','than','their','not'])


def today_str():
    return datetime.now(timezone.utc).date().isoformat()


def already_summarized_today(category):
    path = os.path.join(SUMMARIES_DIR, f"{category}.json")
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r") as f:
            data = json.load(f)
        return (data.get("generated_at") or "")[:10] == today_str()
    except (json.JSONDecodeError, KeyError):
        return False


def build_source_text(items, max_items=25):
    """Titles + preview blurbs for the most recent items, capped to keep the
    request small (this is meant to be cheap, not exhaustive)."""
    lines = []
    for item in items[:max_items]:
        title = item.get("title", "").strip()
        preview = (item.get("preview") or "").strip()
        if preview:
            lines.append(f"- {title}: {preview}")
        else:
            lines.append(f"- {title}")
    return "\n".join(lines)


def summarize_via_github_models(category_label, source_text, token):
    prompt = (
        f"Here are today's items from the \"{category_label}\" section of an AI "
        f"developments dashboard:\n\n{source_text}\n\n"
        "Summarize the 3-5 developments that actually matter here, as short "
        "bullet points. Be concrete and specific (name the actual model, "
        "company, policy, or paper -- don't write vague generalities). If "
        "the items don't have enough substance for 3 distinct points, write "
        "fewer. Output ONLY the bullet points, one per line, starting each "
        "with '- '. No preamble, no closing remarks."
    )
    resp = requests.post(
        GITHUB_MODELS_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "model": GITHUB_MODELS_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 300,
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    bullets = [
        line.lstrip("- ").strip()
        for line in content.strip().splitlines()
        if line.strip().startswith("-")
    ]
    if not bullets:
        raise ValueError("Model response contained no bullet points")
    return bullets


def summarize_extractive(items, max_bullets=5):
    """Zero-dependency fallback: score sentences from titles/previews by
    word frequency (excluding stopwords) and return the top-scoring ones.
    Not a real synthesis -- just surfaces the most-repeated, most salient
    lines from what was actually fetched."""
    sentences = []
    freq = Counter()
    for item in items:
        for text in (item.get("title", ""), item.get("preview") or ""):
            for sentence in re.split(r'(?<=[.!?])\s+', text):
                sentence = sentence.strip()
                if len(sentence) < 15:
                    continue
                sentences.append(sentence)
                words = re.findall(r"[a-z0-9][a-z0-9\-]{2,}", sentence.lower())
                for w in words:
                    if w not in STOPWORDS:
                        freq[w] += 1

    def score(sentence):
        words = re.findall(r"[a-z0-9][a-z0-9\-]{2,}", sentence.lower())
        return sum(freq[w] for w in words if w not in STOPWORDS) / max(len(words), 1)

    ranked = sorted(set(sentences), key=score, reverse=True)
    return ranked[:max_bullets]


def run():
    os.makedirs(SUMMARIES_DIR, exist_ok=True)
    categories = load_sources()
    token = os.environ.get("GITHUB_TOKEN")

    for cat_key, cfg in categories.items():
        if already_summarized_today(cat_key):
            print(f"[{cat_key}] already summarized today, skipping")
            continue

        existing = load_existing(cat_key)
        items = existing.get("items", [])
        if not items:
            print(f"[{cat_key}] no items to summarize, skipping")
            continue

        source_text = build_source_text(items)
        method = None
        bullets = []

        if token:
            try:
                bullets = summarize_via_github_models(cfg["label"], source_text, token)
                method = "llm"
            except Exception as e:
                print(f"[{cat_key}] GitHub Models summary failed ({e}), falling back to extractive")
        else:
            print(f"[{cat_key}] no GITHUB_TOKEN available, using extractive fallback")

        if not bullets:
            bullets = summarize_extractive(items)
            method = "extractive"

        out = {
            "category": cat_key,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "method": method,
            "bullets": bullets,
        }
        path = os.path.join(SUMMARIES_DIR, f"{cat_key}.json")
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
        print(f"[{cat_key}] wrote {len(bullets)} bullet(s) via {method}")


if __name__ == "__main__":
    run()
