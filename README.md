# Advent Tech Studio: backend (API + video renderer)

This package is the API, the Remotion video renderer and the Docker image. It is deployed to **Render** as a Docker web service with a persistent disk. The website is a separate package (`advent-frontend`), deployed to **Vercel**.

## Contents

```
Dockerfile          the image: Python API + Node renderer + Chromium
render.yaml         Render Blueprint: service, disk, environment variables
backend/
  app.py            API routes, job handling, limits, QR and profile links
  timeline_helper.py    30-second beat plan, word budgets, storyline (Gemini or fallback), CAUSES and STYLES
  voiceover_helper.py   narration voices (edge-tts)
  media_helper.py       finds cause artwork and closing cards
  storyboard_helper.py  loads backend/.env for local runs
  requirements.txt  Python packages
  assets/brand/logo.png     logo on the closing card (no uploaded logo)
  assets/cause-art/         default photos per cause (see its README)
  assets/closing/           optional finished closing card (see its README)
renderer/
  render.mjs        the render script (Chromium launch settings)
  src/PromoVideo.jsx        the video design: text, timing, colours, AI disclosure
  package.json      renderer packages (Remotion 4.0.300)
```

## Run it on your computer

Requires Python 3.11+ and Node.js 20 or 22.

```bash
# API
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env               # add GEMINI_API_KEY if you have one
uvicorn app:app --reload           # check http://localhost:8000/health

# Renderer (in another terminal)
cd renderer
npm ci
```

If Remotion cannot launch its browser on your computer, install Google Chrome and set, before starting the API:
- Windows PowerShell: `$env:ADVENT_BROWSER_EXECUTABLE = "C:\Program Files\Google\Chrome\Application\chrome.exe"` then `$env:ADVENT_CHROME_MODE = "chrome-for-testing"`
- macOS or Linux: `export ADVENT_BROWSER_EXECUTABLE=/path/to/chrome` and `export ADVENT_CHROME_MODE=chrome-for-testing`

## Where to change things

### Environment variables (set in Render → service → Environment)

| Variable | Purpose | Example |
|---|---|---|
| `PUBLIC_BASE_URL` | This API's public address. Used in QR codes, video links and cover links. | `https://advent-tech-api.onrender.com` |
| `FRONTEND_URL` | The Vercel studio address. Used for CORS and the QR redirect to the profile page. | `https://advent-tech-studio.vercel.app` |
| `CORS_ORIGIN_REGEX` (optional) | Extra front-end addresses, such as Vercel previews | `^https://advent-tech-studio-[a-z0-9-]+\.vercel\.app$` |
| `GEMINI_API_KEY` (optional) | AI-written storyline. Blank = built from the organisation's summary. | your key |
| `GEMINI_MODEL` (optional) | Gemini model name | `gemini-3.8-flash` |

Set these in Render, not in files. Changing a variable makes Render redeploy the service.

### Render settings in `render.yaml`

| Setting | Current | Change it to |
|---|---|---|
| `plan` | `standard` (2 GB RAM) | a larger plan if renders run out of memory |
| `region` | `oregon` | the region closest to your users |
| `disk.sizeGB` | `10` | more space if you keep many videos |
| `disk.mountPath` | `/data` | leave as is (must match `DATA_DIR` in the Dockerfile) |
| `healthCheckPath` | `/health` | leave as is |

### Code

| What | Where | Notes |
|---|---|---|
| Narration voices per tone | `backend/voiceover_helper.py`, `VOICE_BY_STYLE` (line 10) | Voice names are edge-tts voices. |
| Narration speed | `backend/voiceover_helper.py`, `rate="-5%"` (line 21) | Negative is slower. |
| Words per second (word budgets) | `backend/timeline_helper.py`, `WORDS_PER_SECOND` (line 16) | Lower it if narration runs past its beat and the video becomes longer than 30 seconds. |
| Beat timing | `backend/timeline_helper.py`, `beat_plan()` (line 22) | Each plan must add up to 30 seconds. |
| Cause and style IDs | `backend/timeline_helper.py`, `CAUSES` and `STYLES` (lines 18–19) | Must match `CAUSES` in `frontend/src/App.jsx`. |
| Storyline wording and Gemini prompt | `backend/timeline_helper.py` | The fallback text is built from the summary here. |
| AI disclosure line | `backend/timeline_helper.py`, line 159 (footnote); `renderer/src/PromoVideo.jsx`, around line 466 (closing scene) | Keep the disclosure. |
| Video look (fonts, colours, animation) | `renderer/src/PromoVideo.jsx` | Fonts are set in the file (Georgia for Premium, Arial for News). |
| Upload limits | `backend/app.py`: `MAX_LOGO_SIZE` (line 28), `MAX_COVER_SIZE` (line 44) | The frontend has matching limits in `src/api.js`. |
| Frame rate | `backend/app.py`, `FPS` (line 31) | 30 by default. |
| Chromium launch | `Dockerfile` (`ADVENT_BROWSER_EXECUTABLE`, `ADVENT_CHROME_MODE`), `renderer/render.mjs` | Keep `ADVENT_CHROME_MODE=chrome-for-testing` with the Debian Chromium in the image. |
| Start command | `Dockerfile`, last line | Must keep `${PORT:-8000}` for Render. |
| Default photos and logo | `backend/assets/cause-art/`, `backend/assets/brand/logo.png` | Use only images you have rights to. |

## Deploy on Render (Web Service, no Blueprint)

1. Push this folder (the one containing `Dockerfile`) to a GitHub repository.
2. render.com → **New +** → **Web Service** → connect the repository → **Connect**.
3. Fill in the settings:

   | Setting | Value |
   |---|---|
   | Name | `advent-tech-api` |
   | Region | Oregon (or the one you prefer) |
   | Branch | `main` |
   | Root Directory | leave empty (the repository root is this folder) |
   | Runtime | **Docker** (Render detects the `Dockerfile` automatically) |
   | Dockerfile Path | `./Dockerfile` |
   | Instance Type | **Standard** or larger (not Free: rendering needs about 2 GB RAM) |
   | Health Check Path | `/health` |

4. **Add a disk** (on the service page: Disks → Add Disk): name `advent-data`, mount path `/data`, size 10 GB. Persistent disks need a paid plan. The Dockerfile already sets `DATA_DIR=/data`.
5. **Environment variables** (Environment tab):

   | Key | Value |
   |---|---|
   | `PUBLIC_BASE_URL` | your Render address, e.g. `https://advent-tech-api.onrender.com` |
   | `FRONTEND_URL` | your Vercel address, e.g. `https://advent-tech-studio.vercel.app` (no trailing slash; commas separate several) |
   | `GEMINI_API_KEY` | optional, for the AI storyline |
   | `GEMINI_MODEL` | `gemini-3.8-flash` (optional) |
   | `CORS_ORIGIN_REGEX` | optional, e.g. `^https://advent-tech-[a-z0-9-]+\.vercel\.app$` for preview deployments |

6. Click **Create Web Service** and wait for the first build (5–10 minutes). When it shows **Live**, open `https://<your-api>.onrender.com/health`. It should show `{"status":"ok"}`.
7. Give the API address to the frontend (`VITE_API_BASE_URL` on Vercel). If you do not know the Vercel address yet, put a placeholder in `FRONTEND_URL` and change it once Vercel gives you the address; Render redeploys automatically.

`render.yaml` describes the same settings for the Blueprint method. You do not need it for this flow.

## Limits and warnings

- **One instance only.** Video progress is in memory, so a restart or redeploy cancels any render in progress.
- **Standard plan or larger.** Smaller plans run out of memory during rendering. Persistent disks need a paid plan.
- **Data lives on the disk at `/data`** (profiles, covers, MP4s). Back it up regularly.
- **No sign-in.** Anyone who can reach the API can change data and create videos. Protect the write routes before public use.
- **edge-tts** is an online voice service, not an official API. Check its terms before public use.
- **Use only licensed images and music,** and show only statistics that come from the organisation.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Render says "no open ports" | Keep the Dockerfile start command, which uses `$PORT`. |
| Render logs: "Failed to launch the browser process" | Keep `ADVENT_CHROME_MODE=chrome-for-testing` in the Dockerfile. |
| Render logs: out of memory | Use `standard` or a larger plan. |
| CORS error in the browser | `FRONTEND_URL` must exactly match the Vercel address (https, no trailing slash). |
| QR code opens localhost | `PUBLIC_BASE_URL` is missing or wrong. |
| Video has no voice | Check the job's warnings. The service may not reach the voice service, or edge-tts may be unavailable. |
| Storyline looks generic | `GEMINI_API_KEY` is missing or wrong. The app uses the summary instead. |
