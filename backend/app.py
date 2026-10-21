from fastapi import FastAPI, HTTPException, BackgroundTasks, Form, File, UploadFile, Depends
from PIL import Image, ImageDraw, ImageFont
import textwrap
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from uuid import uuid4
import subprocess, json, time, math, os

from voiceover_helper import generate_voiceover_sync
from timeline_helper import build_timeline, CAUSES, STYLES, WORDS_PER_SECOND
from media_helper import find_cause_art, find_closing_art, ART_EXTENSIONS, ASSET_DIR as CAUSE_ART_DIR
from mutagen.mp3 import MP3
import qrcode

ROOT = Path(__file__).resolve().parent
# Everything the app writes (rendered videos, uploads, profile and organisation data) lives in DATA_DIR.
# Locally that is this backend folder; in Docker it is a persistent volume at /data.
DATA = Path(os.getenv("DATA_DIR", str(ROOT))).resolve()
DATA.mkdir(parents=True, exist_ok=True)
OUTPUT = DATA / "output"
UPLOADS = DATA / "uploads"
OUTPUT.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)
MAX_LOGO_SIZE = 5 * 1024 * 1024
DEFAULT_LOGO = ROOT / "assets" / "brand" / "logo.png"
ALLOWED_LOGO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
FPS = 30
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
# FRONTEND_URL may list more than one website, separated by commas (for example the live Vercel site and a custom domain).
FRONTEND_URLS = [u.strip().rstrip("/") for u in os.getenv("FRONTEND_URL", "http://localhost:5173").split(",") if u.strip()]
FRONTEND_URL = FRONTEND_URLS[0]
JOBS = {}

# Advent Tech runs as one workspace: there is no sign-in. Every profile and the organisation
# details belong to this single owner.
OWNER = "workspace"

PROFILES_FILE = DATA / "profiles.json"
ORG_FILE = DATA / "organization.json"
COVERS_DIR = UPLOADS / "covers"
COVERS_DIR.mkdir(parents=True, exist_ok=True)
MAX_COVER_SIZE = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except (OSError, ValueError):
        return default


def load_profiles() -> dict:
    """Organization profiles are saved to disk so QR codes keep working after a restart."""
    return _read_json(PROFILES_FILE, {})


def save_profiles() -> None:
    PROFILES_FILE.write_text(json.dumps(PUBLIC, indent=2, ensure_ascii=False), encoding="utf-8")


PUBLIC = load_profiles()


def load_org() -> dict:
    return _read_json(ORG_FILE, {})


def save_org(data: dict) -> None:
    ORG_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


app = FastAPI(title="Advent Tech API", version="3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *FRONTEND_URLS],
    # Optional regex for extra front-end origins, e.g. Vercel preview deployments:
    # CORS_ORIGIN_REGEX=^https://advent-tech-[a-z0-9-]+\.vercel\.app$
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX", "").strip() or None,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
CAUSE_ART_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/output", StaticFiles(directory=str(OUTPUT)), name="output")
app.mount("/cause-art", StaticFiles(directory=str(CAUSE_ART_DIR)), name="cause-art")
app.mount("/covers", StaticFiles(directory=str(COVERS_DIR)), name="covers")


def save_logo(logo: UploadFile | None) -> str:
    if not logo or not logo.filename:
        return ""
    if logo.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(400, "Logo must be PNG, JPG, or WebP.")
    data = logo.file.read(MAX_LOGO_SIZE + 1)
    if not data:
        raise HTTPException(400, "The uploaded logo is empty.")
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(400, "Logo must be smaller than 5 MB.")
    signatures = {
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/webp": len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    }
    if not signatures.get(logo.content_type, False):
        raise HTTPException(400, "The uploaded file does not match its image type.")
    path = UPLOADS / f"{uuid4().hex}{ALLOWED_LOGO_TYPES[logo.content_type]}"
    path.write_bytes(data)
    return str(path.resolve())


def estimate_seconds(text: str) -> float:
    return len(text.split()) / WORDS_PER_SECOND + 0.5


def render_job(job_id: str, payload: dict, public_id: str):
    output_path = OUTPUT / f"{job_id}.mp4"
    renderer = ROOT.parent / "renderer"
    qr_url = f"{PUBLIC_BASE_URL}/o/{public_id}"
    JOBS[job_id]["status"] = "rendering"
    warnings = []
    try:
        beats, story_source = build_timeline(payload)
        for beat in beats:
            beat["art_path"] = find_cause_art(payload["cause"], beat["id"])
            if beat["id"] == "closing":
                beat["art_path"] = find_closing_art(payload["cause"], payload["style"]) or beat["art_path"]
        manifest = []
        for index, beat in enumerate(beats):
            voice_path = OUTPUT / f"{job_id}-beat-{index + 1}.mp3"
            audio_seconds = None
            try:
                generate_voiceover_sync(beat["narration"], str(voice_path), payload.get("voice_style", "professional"))
                audio_seconds = float(MP3(str(voice_path)).info.length)
            except Exception as exc:
                # Voice needs online edge-tts. Keep the timed visuals and warn instead of failing the job.
                warnings.append(f"Narration unavailable for {beat['id']} (rendered without voice): {exc}")
                voice_path = None
            seconds = max(beat["window"], (audio_seconds or estimate_seconds(beat["narration"])) + 0.3)
            manifest.append({
                **beat,
                "audio_path": str(voice_path.resolve()) if voice_path else "",
                "duration_in_frames": max(45, math.ceil(seconds * FPS)),
            })

        qr_path = OUTPUT / f"{job_id}-qr.png"
        qrcode.make(qr_url).save(qr_path)

        start = 0.0
        public_scenes = []
        for beat in manifest:
            seconds = beat["duration_in_frames"] / FPS
            public_scenes.append({
                "id": beat["id"], "caption": beat["caption"], "narration": beat["narration"],
                "start_seconds": round(start, 1), "end_seconds": round(start + seconds, 1),
                "video_source": "Cause artwork",
            })
            start += seconds
        JOBS[job_id].update(story_source=story_source, scenes=public_scenes, status="rendering", progress=12, warnings=warnings)

        cmd = [
            "node", str(renderer / "render.mjs"), "--output", str(output_path),
            "--name", payload["organization_name"],
            "--color", payload["primary_color"], "--secondary-color", payload["secondary_color"],
            "--background-color", payload["background_color"], "--tagline", payload.get("tagline", ""),
            "--qr-url", qr_url, "--qr-image", str(qr_path.resolve()),
            "--website", payload.get("website_url") or qr_url,
            "--cause", payload["cause"], "--style", payload["style"],
            "--spotlight-title", payload.get("spotlight_title", "Organization Spotlight"),
            "--beats-json", json.dumps(manifest),
        ]
        if payload.get("logo_path"):
            cmd.extend(["--logo", payload["logo_path"]])
        process = subprocess.Popen(cmd, cwd=str(renderer), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        render_logs = []
        try:
            for line in process.stdout:
                line = line.rstrip()
                if line:
                    render_logs.append(line)
                    if line.startswith("ADVENT_PROGRESS:"):
                        try:
                            pct = int(line.split(":", 1)[1])
                            JOBS[job_id]["progress"] = min(99, 15 + round(pct * 0.84))
                        except ValueError:
                            pass
                    elif len(render_logs) > 120:
                        render_logs = render_logs[-120:]
            return_code = process.wait(timeout=900)
        except Exception:
            process.kill()
            raise
        if return_code:
            raise RuntimeError("\n".join(render_logs)[-5000:] or "Renderer failed")
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("Renderer did not produce a non-empty MP4.")
        JOBS[job_id].update(
            status="completed", progress=100, video_url=f"{PUBLIC_BASE_URL}/output/{job_id}.mp4",
            qr_url=qr_url, file_size_bytes=output_path.stat().st_size, completed_at=time.time(),
        )
    except Exception as exc:
        JOBS[job_id].update(status="failed", error=str(exc), warnings=warnings)


class OrganizationUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    what_we_do: str = Field("", max_length=500)
    how_we_help: str = Field("", max_length=500)


class ProfileUpdate(BaseModel):
    organization_name: str = Field(..., min_length=1, max_length=100)
    tagline: str = Field("", max_length=150)
    summary: str = Field(..., min_length=1, max_length=500)
    highlights: list[str] = Field(default_factory=list, max_length=5)
    website_url: str = Field("", max_length=300)


def current_owner() -> str:
    return OWNER


async def save_cover_file(upload: UploadFile) -> str:
    """Validate an uploaded image (type, size and file signature) and store it. Returns the stored file name."""
    extension = ALLOWED_IMAGE_TYPES.get(upload.content_type or "")
    if not extension:
        raise HTTPException(400, "Use a PNG, JPG or WebP image.")
    data = await upload.read(MAX_COVER_SIZE + 1)
    if not data:
        raise HTTPException(400, "The image is empty.")
    if len(data) > MAX_COVER_SIZE:
        raise HTTPException(400, "The image must be smaller than 5 MB.")
    signatures = {
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/webp": len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    }
    if not signatures.get(upload.content_type or "", False):
        raise HTTPException(400, "The uploaded file does not match its image type.")
    name = f"{uuid4().hex}{extension}"
    (COVERS_DIR / name).write_bytes(data)
    return name


def discard_cover(name: str) -> None:
    """Delete an image file only when no profile or organisation setting still uses it."""
    if not name or Path(name).name != name:
        return
    org = load_org()
    in_org = org.get("cover") == name or name in org.get("template_covers", {}).values()
    in_profiles = any(d.get("cover") == name for d in PUBLIC.values())
    if in_org or in_profiles:
        return
    (COVERS_DIR / name).unlink(missing_ok=True)


CAUSE_COLORS = {
    "food": (217, 119, 6), "money": (190, 18, 60), "community": (29, 78, 216),
    "education": (14, 116, 144), "health": (21, 128, 61),
}
DEFAULT_COVER_BASE = (30, 58, 138)
DEFAULT_COVER_DEEP = (15, 29, 74)


def _font(size: int):
    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def make_default_cover(organization_name: str, cause: str) -> str:
    """Draw a default cover from the cause colour and the organisation name. Returns the stored file name."""
    width, height = 1600, 600
    top = CAUSE_COLORS.get(cause, DEFAULT_COVER_BASE)
    image = Image.new("RGB", (width, height), top)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / (height - 1)
        draw.line([(0, y), (width, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, DEFAULT_COVER_DEEP)))
    font = _font(84)
    lines = textwrap.wrap(organization_name or "Advent Tech", width=24)[:2] or ["Advent Tech"]
    y = height - 80 - len(lines) * 100
    for line in lines:
        draw.text((80, y), line, font=font, fill=(255, 255, 255))
        y += 100
    name = f"{uuid4().hex}.png"
    image.save(COVERS_DIR / name, "PNG")
    return name


def valid_template_key(key: str) -> bool:
    kind, _, ident = key.partition(":")
    return (kind == "cause" and ident in CAUSES) or (kind == "style" and ident in STYLES)


def org_view() -> dict:
    org = load_org()
    return {
        "name": org.get("name", ""),
        "what_we_do": org.get("what_we_do", ""),
        "how_we_help": org.get("how_we_help", ""),
        "cover": f"/covers/{org['cover']}" if org.get("cover") else None,
        "template_covers": {k: f"/covers/{v}" for k, v in org.get("template_covers", {}).items()},
    }


@app.get("/health")
def health():
    return {"status": "ok"}


# ---- Organisation details (the Profile tab) ------------------------------------------------

@app.get("/organization")
def get_organization():
    return org_view()


@app.put("/organization")
def update_organization(body: OrganizationUpdate):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "The organisation name is required.")
    org = load_org()
    org.update(name=name[:100], what_we_do=body.what_we_do.strip()[:500], how_we_help=body.how_we_help.strip()[:500])
    save_org(org)
    return org_view()


@app.post("/organization/cover", status_code=201)
async def set_organization_cover(photo: UploadFile = File(...)):
    name = await save_cover_file(photo)
    org = load_org()
    previous = org.get("cover")
    org["cover"] = name
    save_org(org)
    if previous:
        discard_cover(previous)
    return org_view()


@app.delete("/organization/cover")
def remove_organization_cover():
    org = load_org()
    previous = org.pop("cover", None)
    save_org(org)
    if previous:
        discard_cover(previous)
    return org_view()


# ---- Cover for each cause and style box in the studio --------------------------------------

@app.post("/organization/template-covers/{key}", status_code=201)
async def set_template_cover(key: str, photo: UploadFile = File(...)):
    if not valid_template_key(key):
        raise HTTPException(404, "Unknown cause or style.")
    name = await save_cover_file(photo)
    org = load_org()
    covers = org.setdefault("template_covers", {})
    previous = covers.get(key)
    covers[key] = name
    save_org(org)
    if previous:
        discard_cover(previous)
    return org_view()


@app.delete("/organization/template-covers/{key}")
def remove_template_cover(key: str):
    if not valid_template_key(key):
        raise HTTPException(404, "Unknown cause or style.")
    org = load_org()
    previous = org.get("template_covers", {}).pop(key, None)
    save_org(org)
    if previous:
        discard_cover(previous)
    return org_view()


# ---- Videos ---------------------------------------------------------------------------------

@app.get("/defaults/{cause}")
def default_photos(cause: str):
    """Default photos for a cause template, shown while a video is generating.
    Files in backend/assets/cause-art/ named food.jpg or food-*.jpg (any beat) are used."""
    if cause not in CAUSES:
        raise HTTPException(404, "Unknown cause")
    images = [
        f"/cause-art/{path.name}"
        for path in sorted(CAUSE_ART_DIR.iterdir())
        if path.suffix.lower() in ART_EXTENSIONS and (path.stem == cause or path.stem.startswith(f"{cause}-"))
    ]
    return {"cause": cause, "images": images}


@app.get("/options")
def options():
    return {"causes": sorted(CAUSES), "styles": sorted(STYLES)}


@app.post("/videos/generate", status_code=202)
async def generate(
    background_tasks: BackgroundTasks,
    organization_name: str = Form(...),
    summary: str = Form(...),
    tagline: str = Form(""),
    website_url: str = Form(""),
    template_id: str = Form("community-news"),
    primary_color: str = Form("#2563eb"),
    secondary_color: str = Form("#7c3aed"),
    background_color: str = Form("#0b1020"),
    highlights: str = Form("[]"),
    stats: str = Form("[]"),
    campaign_title: str = Form(""),
    campaign_goal: str = Form(""),
    campaign_raised: str = Form(""),
    spotlight_title: str = Form("Organization Spotlight"),
    voice_style: str = Form("professional"),
    logo: UploadFile | None = File(default=None),
    owner: str = Depends(current_owner),
):
    if not organization_name.strip() or not summary.strip():
        raise HTTPException(400, "Organization name and summary are required.")
    cause, _, style = template_id.partition("-")
    if cause not in CAUSES or style not in STYLES:
        raise HTTPException(400, "Choose a cause (food, money, community, education, health) and a style (news, premium).")
    try:
        highlights_list = json.loads(highlights or "[]")
        stats_list = json.loads(stats or "[]")
        if not isinstance(highlights_list, list) or not isinstance(stats_list, list):
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "Highlights and statistics must be valid JSON arrays.")
    highlights_list = [str(x)[:100] for x in highlights_list if str(x).strip()][:5]
    normalized_stats = []
    for item in stats_list[:3]:
        if isinstance(item, dict) and str(item.get("value", "")).strip() and str(item.get("label", "")).strip():
            normalized_stats.append({"value": str(item.get("value", ""))[:24], "label": str(item.get("label", ""))[:70]})
    campaign = {}
    if campaign_goal.strip():
        try:
            goal, raised = float(campaign_goal), float(campaign_raised or 0)
        except ValueError:
            raise HTTPException(400, "Campaign goal and raised amounts must be numbers.")
        if goal <= 0 or raised < 0:
            raise HTTPException(400, "Campaign goal must be positive and raised cannot be negative.")
        campaign = {"title": campaign_title.strip()[:80], "goal": goal, "raised": raised}
    logo_path = save_logo(logo) or str(DEFAULT_LOGO.resolve())
    # The cover for the chosen cause box is used for this profile; otherwise the organisation cover.
    org = load_org()
    cover_name = org.get("template_covers", {}).get(f"cause:{cause}") or org.get("cover")
    if not cover_name:
        cover_name = make_default_cover(organization_name.strip()[:100], cause)
    job_id, public_id = str(uuid4()), str(uuid4())[:8]
    payload = {
        "organization_name": organization_name.strip()[:100], "summary": summary.strip()[:500],
        "tagline": tagline[:150], "website_url": website_url[:300], "cause": cause, "style": style,
        "primary_color": primary_color, "secondary_color": secondary_color, "background_color": background_color,
        "highlights": highlights_list, "stats": normalized_stats, "campaign": campaign,
        "voice_style": voice_style, "logo_path": logo_path, "spotlight_title": spotlight_title.strip()[:60] or "Organization Spotlight",
    }
    PUBLIC[public_id] = {k: payload.get(k) for k in ("organization_name", "summary", "tagline", "highlights", "website_url", "cause", "style")}
    PUBLIC[public_id]["created_at"] = time.time()
    PUBLIC[public_id]["public_id"] = public_id
    PUBLIC[public_id]["owner"] = owner
    PUBLIC[public_id]["cover"] = cover_name
    save_profiles()
    JOBS[job_id] = {"job_id": job_id, "public_id": public_id, "status": "queued", "progress": 2, "created_at": time.time(),
                    "video_url": None, "qr_url": None, "error": None, "scenes": [], "warnings": [], "owner": owner}
    background_tasks.add_task(render_job, job_id, payload, public_id)
    return {"job_id": job_id, "status": "queued"}


@app.get("/videos/{job_id}/status")
def status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Video job not found")
    return JOBS[job_id]


@app.get("/videos/{job_id}")
def details(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Video job not found")
    return JOBS[job_id]


# ---- Profiles -------------------------------------------------------------------------------

def ensure_profile_cover(public_id: str) -> None:
    """Every profile has a cover. When none was chosen, a default one is generated."""
    data = PUBLIC[public_id]
    if not data.get("cover") or not (COVERS_DIR / data["cover"]).exists():
        data["cover"] = make_default_cover(data.get("organization_name", ""), data.get("cause", ""))
        save_profiles()


def profile_view(public_id: str) -> dict:
    ensure_profile_cover(public_id)
    data = PUBLIC[public_id]
    fields = ("public_id", "organization_name", "tagline", "summary", "highlights", "website_url", "cause", "style")
    return {
        **{k: data.get(k) for k in fields},
        # Absolute URL so the image also loads on a phone that scanned the QR code.
        "cover": f"{PUBLIC_BASE_URL}/covers/{data['cover']}",
        "qr_url": f"{PUBLIC_BASE_URL}/o/{public_id}",
        "is_owner": True,
    }


@app.get("/my/profiles")
def my_profiles(owner: str = Depends(current_owner)):
    """Every organisation profile, newest first, for the dashboard list."""
    ids = sorted(PUBLIC, key=lambda pid: PUBLIC[pid].get("created_at", 0), reverse=True)
    return {"profiles": [profile_view(pid) for pid in ids]}


@app.get("/profiles/{public_id}")
def profile(public_id: str):
    if public_id not in PUBLIC:
        raise HTTPException(404, "Profile not found")
    return profile_view(public_id)


@app.put("/profiles/{public_id}")
def update_profile(public_id: str, body: ProfileUpdate):
    if public_id not in PUBLIC:
        raise HTTPException(404, "Profile not found")
    name, summary = body.organization_name.strip(), body.summary.strip()
    if not name or not summary:
        raise HTTPException(400, "Organization name and summary are required.")
    website = body.website_url.strip()
    if website and not website.lower().startswith(("http://", "https://")):
        website = f"https://{website}"
    PUBLIC[public_id].update(
        organization_name=name[:100], tagline=body.tagline.strip()[:150], summary=summary[:500],
        highlights=[h.strip()[:100] for h in body.highlights if h.strip()][:5], website_url=website[:300],
    )
    save_profiles()
    return profile_view(public_id)


@app.post("/profiles/{public_id}/cover", status_code=201)
async def set_profile_cover(public_id: str, photo: UploadFile = File(...)):
    if public_id not in PUBLIC:
        raise HTTPException(404, "Profile not found")
    name = await save_cover_file(photo)
    previous = PUBLIC[public_id].get("cover")
    PUBLIC[public_id]["cover"] = name
    save_profiles()
    if previous:
        discard_cover(previous)
    return profile_view(public_id)


@app.delete("/profiles/{public_id}/cover")
def remove_profile_cover(public_id: str):
    if public_id not in PUBLIC:
        raise HTTPException(404, "Profile not found")
    previous = PUBLIC[public_id].pop("cover", None)
    save_profiles()
    if previous:
        discard_cover(previous)
    return profile_view(public_id)  # generates the default cover


@app.get("/o/{public_id}")
def organization_redirect(public_id: str):
    """QR target: scanning opens the profile page on the website."""
    if public_id not in PUBLIC:
        raise HTTPException(404, "Profile not found")
    return RedirectResponse(f"{FRONTEND_URL}/#/profile/{public_id}", status_code=302)
