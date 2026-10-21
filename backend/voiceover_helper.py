"""Generate an English narration MP3 with edge-tts.
Install: python -m pip install edge-tts
This uses an online TTS service; check its terms and availability before production use.
If the service is unreachable, app.py renders the video without narration and reports a warning.
"""
import asyncio
from pathlib import Path
import edge_tts

VOICE_BY_STYLE = {
    "professional": "en-US-GuyNeural",
    "warm": "en-US-JennyNeural",
    "energetic": "en-US-AriaNeural",
}


async def generate_voiceover(text: str, output_path: str, voice_style: str = "professional"):
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    voice = VOICE_BY_STYLE.get(voice_style, VOICE_BY_STYLE["professional"])
    communicate = edge_tts.Communicate(text=text, voice=voice, rate="-5%")
    await communicate.save(str(target))
    return str(target.resolve())


def generate_voiceover_sync(text: str, output_path: str, voice_style: str = "professional"):
    return asyncio.run(generate_voiceover(text, output_path, voice_style))
