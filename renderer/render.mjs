import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (key, fallback = "") => { const i = args.indexOf(key); return i >= 0 ? (args[i + 1] ?? fallback) : fallback; };
const output = path.resolve(arg("--output", "./out/video.mp4"));
// Optional: point Remotion at a Chrome/Chromium you installed, e.g. when the bundled headless browser will not launch.
const browserExecutable = process.env.ADVENT_BROWSER_EXECUTABLE || null;
// Remotion's launch mode: "headless-shell" (old headless build) or "chrome-for-testing" (new headless, full Chrome/Chromium).
// Modern Chrome/Chromium binaries no longer support the old headless mode, so set this when using a system Chromium.
const chromeMode = process.env.ADVENT_CHROME_MODE || undefined;
const publicDir = path.join(dir, "public");

const copyToPublic = (source, folder, prefix) => {
  if (!source) return "";
  const absolute = path.resolve(source);
  if (!fs.existsSync(absolute)) throw new Error(`File not found: ${absolute}`);
  const filename = `${prefix}-${path.basename(absolute)}`;
  const targetDir = path.join(publicDir, folder);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(absolute, path.join(targetDir, filename));
  return `${folder}/${filename}`;
};

const logoPath = copyToPublic(arg("--logo"), "uploads", "logo");
const qrPath = copyToPublic(arg("--qr-image"), "qr", "profile");
let beats = [];
try { beats = JSON.parse(arg("--beats-json", "[]")); } catch { beats = []; }
if (!Array.isArray(beats) || !beats.length) throw new Error("No storyline beats were supplied by the backend.");

const scenes = beats.map((beat, index) => ({
  id: String(beat.id || `beat-${index + 1}`),
  narration: String(beat.narration || ""),
  caption: String(beat.caption || `SCENE ${index + 1}`),
  visual_category: String(beat.visual_category || "community"),
  durationInFrames: Math.max(45, Number(beat.duration_in_frames) || 90),
  audioPath: copyToPublic(beat.audio_path, "audio", `beat-${index + 1}`),
  mediaPath: copyToPublic(beat.video_path, "beat-media", `beat-${index + 1}`),
  artPath: copyToPublic(beat.art_path, "beat-art", `beat-${index + 1}`),
  title: String(beat.title || ""),
  subline: beat.subline || null,
  footnote: String(beat.footnote || ""),
}));

const inputProps = {
  organizationName: arg("--name", "Your Organization"),
  tagline: arg("--tagline", ""),
  websiteUrl: arg("--website", ""),
  qrPath,
  primaryColor: arg("--color", "#2563eb"),
  secondaryColor: arg("--secondary-color", "#7c3aed"),
  backgroundColor: arg("--background-color", "#0b1020"),
  cause: arg("--cause", "community"),
  style: arg("--style", "news"),
  logoPath,
  scenes,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
console.log(`Prepared ${scenes.length} timed beats (${scenes.reduce((s, b) => s + b.durationInFrames, 0) / 30}s).`);
console.log("Bundling Advent Tech video...");
const serveUrl = await bundle({ entryPoint: path.join(dir, "src", "index.jsx") });
const composition = await selectComposition({ serveUrl, id: "PromoVideo", inputProps, browserExecutable, chromeMode });
console.log("Rendering MP4...");
let lastProgress = -1;
await renderMedia({
  composition, serveUrl, codec: "h264", outputLocation: output, inputProps, browserExecutable, chromeMode,
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 100);
    if (pct >= lastProgress + 5 || pct === 100) { lastProgress = pct; console.log(`ADVENT_PROGRESS:${pct}`); }
  },
});
if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error("Render did not produce a valid MP4.");
console.log(`\nRendered successfully: ${output}`);
