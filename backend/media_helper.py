"""Artwork lookup for each beat: cause artwork and the closing card."""
from pathlib import Path

ART_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
ASSET_DIR = Path(__file__).resolve().parent / "assets" / "cause-art"


def find_cause_art(cause: str, beat_id: str):
    """Predefined template artwork. Drop files in backend/assets/cause-art/ as food-intro.jpg, food.jpg, etc."""
    for name in (f"{cause}-{beat_id}", cause):
        for ext in ART_EXTENSIONS:
            candidate = ASSET_DIR / f"{name}{ext}"
            if candidate.exists():
                return str(candidate.resolve())
    return None


CLOSING_DIR = Path(__file__).resolve().parent / "assets" / "closing"


def find_closing_art(cause: str, style: str):
    """Predefined closing card (logo, spotlight title, AI disclosure). QR is added on top at render time.
    Drop files in backend/assets/closing/ as food-premium.png, premium.png or closing.png."""
    for name in (f"{cause}-{style}", style, "closing"):
        for ext in ART_EXTENSIONS:
            candidate = CLOSING_DIR / f"{name}{ext}"
            if candidate.exists():
                return str(candidate.resolve())
    return None
