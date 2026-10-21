"""Timed, summary-grounded storyline for Advent Tech (about 30-second donation-focused videos).

The AI (Gemini, when configured) writes one line set per beat. Every beat is bounded by a
word budget, so the narration can fit its window. A deterministic fallback builds the same
beats from the organization's own summary when Gemini is missing or fails.
"""
import json, os, re, urllib.request
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import hashlib

from storyboard_helper import _load_env

MODEL_DEFAULT = "gemini-3.8-flash"
WORDS_PER_SECOND = 2.4  # comfortable narration pace with the edge-tts rate used in voiceover_helper

CAUSES = {"food", "money", "community", "education", "health"}
STYLES = {"news", "premium"}


def beat_plan(has_campaign: bool):
    """Return (beat_id, seconds) pairs. Each plan sums to 30 seconds."""
    if has_campaign:
        return [("intro", 3), ("org", 6), ("services", 6), ("campaign", 7), ("cta", 5), ("closing", 3)]
    return [("intro", 3), ("org", 6), ("services", 13), ("cta", 5), ("closing", 3)]


def word_cap(seconds: int) -> int:
    return max(4, int(seconds * WORDS_PER_SECOND))


def _clean(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _trim_words(text: str, cap: int) -> str:
    words = _clean(text).split()
    if len(words) <= cap:
        return _clean(text)
    return " ".join(words[:cap]).rstrip(",;:") + "."


def _sentences(text: str):
    clean = _clean(text)
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", clean) if p.strip()]
    return parts or ([clean] if clean else [])


def _fallback_lines(name, summary, tagline, highlights, stats, campaign, website, plan_ids):
    sentences = _sentences(summary)
    highlights = [_clean(h) for h in highlights if _clean(h)]
    lines = {}
    lines["intro"] = {"caption": "ORGANIZATION SPOTLIGHT", "narration": f"Introducing {name}."}
    lines["org"] = {"caption": name.upper()[:60], "narration": sentences[0] if sentences else f"{name} is making a difference."}
    if len(sentences) > 1:
        services_text = sentences[1]
    elif highlights:
        services_text = f"Our work includes {', '.join(highlights[:2])}."
    else:
        services_text = f"Learn how {name} serves people in need."
    lines["services"] = {"caption": "OUR WORK", "narration": services_text}
    if "campaign" in plan_ids:
        title = _clean(campaign.get("title")) or "our current campaign"
        lines["campaign"] = {
            "caption": "HELP US REACH OUR GOAL",
            "narration": f"Help us reach our goal for {title}.",
        }
    lines["cta"] = {"caption": "GET INVOLVED", "narration": f"Support {name} by giving, volunteering, or praying."}
    lines["closing"] = {"caption": "VISIT OUR PROFILE", "narration": "Learn more at our profile."}
    return lines


def _build_prompt(name, summary, tagline, highlights, stats, cause, plan):
    beats_spec = {
        bid: {"max_words": word_cap(seconds), "seconds": seconds} for bid, seconds in plan
    }
    return f'''Write a donation-focused, {sum(s for _, s in plan)}-second organization video script using ONLY the facts below.
Organization: {name}
Summary: {summary}
Tagline: {tagline}
Highlights: {json.dumps(highlights)}
Cause category: {cause}
Verified statistics supplied by the organization (use only these numbers): {json.dumps(stats)}
Beats and limits: {json.dumps(beats_spec)}
Return ONLY valid JSON of the form {{"beats": {{"<beat_id>": {{"caption": "max 6 words, uppercase", "narration": "one spoken sentence within max_words"}}}}}} with a key for every beat id listed above.
Rules: the cta beat must invite people to give, volunteer, or pray; never invent numbers, dates, outcomes, locations or claims; the campaign beat may only use supplied campaign figures; do not repeat sentences.'''


def _gemini_lines(prompt):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.getenv("GEMINI_MODEL", MODEL_DEFAULT).strip() or MODEL_DEFAULT
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                       "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3}}).encode()
    # The key goes in a header, not the URL, so it cannot end up in proxy, server or error logs.
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=body, headers={"Content-Type": "application/json", "x-goog-api-key": api_key}, method="POST")
    with urllib.request.urlopen(req, timeout=40) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return json.loads(payload["candidates"][0]["content"]["parts"][0]["text"]).get("beats", {})


def build_timeline(payload: dict):
    """Return (beats, source). Each beat carries its window, text, cause visual query and overlays."""
    _load_env()
    name = payload["organization_name"]
    cause = payload.get("cause", "community")
    cause = cause if cause in CAUSES else "community"
    campaign = payload.get("campaign") or {}
    has_campaign = bool(campaign.get("goal") and campaign.get("raised") is not None and str(campaign.get("raised")) != "")
    plan = beat_plan(has_campaign)
    plan_ids = [bid for bid, _ in plan]
    highlights = payload.get("highlights", [])
    stats = payload.get("stats", [])
    summary = payload["summary"]
    tagline = payload.get("tagline", "")
    website = payload.get("website_url", "")

    fallback = _fallback_lines(name, summary, tagline, highlights, stats, campaign, website, plan_ids)
    lines, source = fallback, "local-fallback"
    try:
        ai = _gemini_lines(_build_prompt(name, summary, tagline, highlights, stats, cause, plan))
        if ai and all(bid in ai for bid in plan_ids):
            merged = {}
            for bid, seconds in plan:
                item = ai.get(bid) or {}
                narration = _trim_words(item.get("narration", ""), word_cap(seconds))
                caption = _clean(item.get("caption", ""))[:60]
                if not narration:
                    narration = fallback[bid]["narration"]
                merged[bid] = {"caption": caption or fallback[bid]["caption"], "narration": narration}
            lines, source = merged, "gemini"
    except Exception as exc:
        print(f"Gemini storyline unavailable; using summary-based timeline: {exc}")

    beats = []
    for bid, seconds in plan:
        line = lines[bid]
        narration = _trim_words(line["narration"], word_cap(seconds))
        beat = {
            "id": bid, "window": seconds, "caption": line["caption"][:60], "narration": narration,
            "visual_category": cause,
            "subline": None, "footnote": "",
        }
        if bid == "intro":
            beat["subline"] = {"type": "tagline", "text": _clean(tagline)}
        if bid == "services" and stats:
            beat["subline"] = {"type": "stats", "items": [s for s in stats if s.get("value") and s.get("label")][:3]}
        if bid == "campaign":
            raised, goal = float(campaign.get("raised") or 0), float(campaign.get("goal") or 0)
            beat["subline"] = {"type": "campaign", "title": _clean(campaign.get("title")) or "Campaign",
                               "raised": campaign.get("raised"), "goal": campaign.get("goal"),
                               "percent": min(100, round(raised / goal * 100)) if goal else 0}
        if bid == "closing":
            beat["subline"] = {"type": "qr", "text": website or ""}
            beat["title"] = _clean(payload.get("spotlight_title")) or "Organization Spotlight"
            beat["footnote"] = f"AI-assisted video. Organization information provided by {name}."
        beats.append(beat)
    return beats, source
