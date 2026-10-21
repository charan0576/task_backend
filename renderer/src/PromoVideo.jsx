import React from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, Video, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// ---------------------------------------------------------------------------
// Motion vocabulary. Every value is a function of the frame number, so renders are deterministic.
// ---------------------------------------------------------------------------
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const smooth = { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) }; // expo-out: fast start, soft landing
const CAUSE_LABEL = { food: "Food", money: "Giving", community: "Community", education: "Education", health: "Health" };

// Deterministic pseudo-random numbers.
const seeded = (n) => { const x = Math.sin(n * 91.345 + 17.13) * 43758.5453; return x - Math.floor(x); };

// Relative luminance of a #rrggbb colour (0 = black, 1 = white).
function luminance(hex) {
  const h = String(hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h.padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) || 0);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Light grades (ivory, cream) get dark ink; dark grades keep white text.
function themeOf(p) {
  if (luminance(p.backgroundColor) > 0.6) {
    return { light: true, ink: "#1d2433", muted: "#4b5563", panel: "rgba(255,255,255,.88)", edge: p.secondaryColor, accent: p.primaryColor, track: "#e5e0d3", shadow: "none", glow: 0.18 };
  }
  return { light: false, ink: "#ffffff", muted: "#e2e8f0", panel: "rgba(7,16,29,.72)", edge: p.primaryColor, accent: p.primaryColor, track: "#25304a", shadow: "0 4px 28px #0009", glow: 0.45 };
}

// ---------------------------------------------------------------------------
// Atmosphere: mesh gradient, grain, particles, light sweep, sparkles, flash.
// ---------------------------------------------------------------------------

// Three soft colour orbs that drift slowly, giving the background a living, gradient-mesh look.
function Mesh({ p, t, frame }) {
  const orbs = [
    { c: p.primaryColor, x: 18, y: 28, r: 900, s: 0.011, a: 0 },
    { c: p.secondaryColor, x: 80, y: 68, r: 1000, s: 0.008, a: 2.1 },
    { c: p.primaryColor, x: 62, y: 8, r: 700, s: 0.014, a: 4.2 },
  ];
  return <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden", opacity: t.light ? 0.32 : 0.5 }}>
    {orbs.map((o, i) => {
      const x = o.x + Math.cos(frame * o.s + o.a) * 12;
      const y = o.y + Math.sin(frame * o.s * 1.2 + o.a) * 10;
      return <div key={i} style={{
        position: "absolute", left: `${x}%`, top: `${y}%`, width: o.r, height: o.r,
        marginLeft: -o.r / 2, marginTop: -o.r / 2, borderRadius: "50%",
        background: `radial-gradient(circle, ${o.c} 0%, transparent 62%)`,
      }} />;
    })}
  </AbsoluteFill>;
}

// Film grain: a noise texture that shifts every couple of frames.
const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
function Grain({ frame, t }) {
  const step = Math.floor(frame / 2);
  return <AbsoluteFill style={{
    pointerEvents: "none", backgroundImage: GRAIN, opacity: t.light ? 0.05 : 0.08,
    transform: `translate(${(step * 37) % 61}px, ${(step * 53) % 47}px)`, mixBlendMode: "overlay",
  }} />;
}

// Floating glowing particles drifting upward.
function Particles({ p, t, count = 30, speed = 1 }) {
  const frame = useCurrentFrame();
  const items = Array.from({ length: count }, (_, i) => ({
    x: seeded(i * 3 + 1) * 100, y: seeded(i * 3 + 2) * 100,
    size: 2 + seeded(i * 3 + 3) * 8, drift: 0.04 + seeded(i * 7 + 5) * 0.09, phase: seeded(i + 11) * Math.PI * 2,
  }));
  return <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
    {items.map((it, i) => {
      const y = (((it.y - frame * it.drift * speed) % 100) + 100) % 100;
      const x = it.x + Math.sin(frame / 40 + it.phase) * 2.5;
      const o = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(frame / 25 + it.phase));
      return <div key={i} style={{
        position: "absolute", left: `${x}%`, top: `${y}%`, width: it.size, height: it.size, borderRadius: "50%",
        background: i % 3 === 0 ? p.secondaryColor : p.primaryColor,
        opacity: o * (t.light ? 0.45 : 0.85), boxShadow: `0 0 ${it.size * 2.5}px ${p.primaryColor}`,
      }} />;
    })}
  </AbsoluteFill>;
}

// A soft diagonal light band that sweeps across the beat once.
function LightSweep({ frame, color, t }) {
  const x = interpolate(frame, [0, 46], [-70, 170], smooth);
  return <AbsoluteFill style={{
    pointerEvents: "none",
    background: `linear-gradient(105deg, transparent 40%, ${color}${t.light ? "1a" : "30"} 50%, transparent 60%)`,
    transform: `translateX(${x}%)`,
  }} />;
}

// Four-point sparkles that twinkle around a beat's headline.
function Sparkles({ p, frame, count = 7 }) {
  return <AbsoluteFill style={{ pointerEvents: "none" }}>
    {Array.from({ length: count }, (_, i) => {
      const x = 50 + seeded(i + 40) * 45;
      const y = 10 + seeded(i + 60) * 70;
      const ph = seeded(i + 80) * 100;
      const s = 0.5 + 0.5 * Math.sin((frame + ph) / 13);
      const size = 12 + seeded(i + 5) * 18;
      return <svg key={i} viewBox="0 0 24 24" style={{
        position: "absolute", left: `${x}%`, top: `${y}%`, width: size, height: size,
        opacity: s * 0.9, transform: `scale(${0.5 + s * 0.7}) rotate(${frame * 1.5 + ph}deg)`,
      }}>
        <path d="M12 0 L14.2 9.8 L24 12 L14.2 14.2 L12 24 L9.8 14.2 L0 12 L9.8 9.8 Z" fill={i % 2 ? p.secondaryColor : p.primaryColor} />
      </svg>;
    })}
  </AbsoluteFill>;
}

// A brief bloom of light as each beat arrives, right after the wipe clears.
function Flash({ frame, color, t }) {
  const o = interpolate(frame, [18, 34], [t.light ? 0.25 : 0.55, 0], clamp);
  return <AbsoluteFill style={{ pointerEvents: "none", background: `radial-gradient(circle at 60% 35%, ${color}, transparent 65%)`, opacity: o }} />;
}

// ---------------------------------------------------------------------------
// Cause artwork: line icons that draw themselves, plus a slow orbit ring.
// ---------------------------------------------------------------------------
function CauseIcon({ cause, color }) {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [0, 70], [0, 1], smooth);
  const stroke = (w = 9) => ({
    stroke: color, strokeWidth: w, fill: "none", strokeLinecap: "round", strokeLinejoin: "round",
    pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw,
  });
  const svg = (children) => <svg viewBox="0 0 200 200" width="100%" height="100%">{children}</svg>;
  switch (cause) {
    case "food":
      return svg(<>
        <path d="M30 100 H170 A70 70 0 0 1 30 100 Z" {...stroke()} />
        <line x1="18" y1="100" x2="182" y2="100" {...stroke()} />
        <path d="M70 70 Q80 45 70 22 M100 70 Q110 45 100 22 M130 70 Q140 45 130 22" {...stroke(6)} />
      </>);
    case "money":
      return svg(<>
        <circle cx="100" cy="100" r="72" {...stroke()} />
        <circle cx="100" cy="100" r="52" {...stroke(4)} />
        <text x="100" y="128" textAnchor="middle" fontSize="92" fontFamily="Arial, sans-serif" fontWeight="700" fill={color} opacity={draw}>$</text>
      </>);
    case "education":
      return svg(<>
        <path d="M100 60 Q60 42 20 56 V158 Q60 144 100 164 Q140 144 180 158 V56 Q140 42 100 60 Z" {...stroke()} />
        <line x1="100" y1="60" x2="100" y2="164" {...stroke(6)} />
      </>);
    case "health":
      return svg(<path d="M80 30 H120 V80 H170 V120 H120 V170 H80 V120 H30 V80 H80 Z" {...stroke()} />);
    default:
      return svg(<>
        <circle cx="70" cy="82" r="17" {...stroke(7)} />
        <circle cx="130" cy="82" r="17" {...stroke(7)} />
        <circle cx="100" cy="70" r="21" {...stroke(7)} />
        <path d="M36 158 Q70 108 100 126 Q130 108 164 158" {...stroke()} />
      </>);
  }
}

// Background for each beat, in order: predefined cause artwork, stock clip, animated cause artwork.
function BeatBackground({ p, t, scene, frame, durationInFrames }) {
  const overlay = t.light
    ? `linear-gradient(90deg, ${p.backgroundColor}f5, ${p.backgroundColor}cc 60%, ${p.backgroundColor}88)`
    : `linear-gradient(90deg, ${p.backgroundColor}f2, ${p.backgroundColor}aa 55%, ${p.backgroundColor}60)`;
  // Slow push-in with a slight drift, so photos and clips never sit still.
  const zoom = 1.04 + (frame / durationInFrames) * 0.08;
  const pan = `translate(${-(frame / durationInFrames) * 16}px, 0)`;
  const media = { width: "100%", height: "100%", objectFit: "cover", transform: `${pan} scale(${zoom})` };
  if (scene.artPath) {
    return <AbsoluteFill>
      <Img src={staticFile(scene.artPath)} style={media} />
      <AbsoluteFill style={{ background: overlay }} />
    </AbsoluteFill>;
  }
  if (scene.mediaPath) {
    return <AbsoluteFill>
      <Video src={staticFile(scene.mediaPath)} muted volume={0} startFrom={0} style={media} />
      <AbsoluteFill style={{ background: overlay }} />
    </AbsoluteFill>;
  }
  const drift = Math.sin(frame / 30) * 4;
  const pulse = 1 + Math.sin(frame / 24) * 0.03;
  return <AbsoluteFill style={{ overflow: "hidden", background: t.light
    ? `radial-gradient(circle at ${70 + drift}% ${25 + drift}%, ${p.primaryColor}22, transparent 50%), linear-gradient(135deg, ${p.backgroundColor}, ${p.backgroundColor})`
    : `radial-gradient(circle at ${70 + drift}% ${25 + drift}%, ${p.primaryColor}88, transparent 45%), linear-gradient(135deg, ${p.backgroundColor}, #050a14 80%)` }}>
    <div style={{ position: "absolute", right: "5%", top: "15%", width: 300, height: 300, transform: `rotate(${frame * 0.25}deg)`, opacity: t.light ? 0.3 : 0.45 }}>
      <CauseIcon cause={p.cause} color={t.light ? p.primaryColor : p.secondaryColor} />
    </div>
    <div style={{ position: "absolute", right: -120, bottom: -260, width: 640, height: 640, border: `2px solid ${p.primaryColor}55`, borderRadius: "50%", transform: `scale(${pulse})` }} />
    <div style={{ position: "absolute", right: 60, bottom: -180, width: 420, height: 420, border: `2px dashed ${p.secondaryColor}55`, borderRadius: "50%", transform: `rotate(${-frame * 0.4}deg)` }} />
  </AbsoluteFill>;
}

// ---------------------------------------------------------------------------
// Transitions and progress.
// ---------------------------------------------------------------------------

// Wipe transition. Beats alternate between a straight wipe and a slanted one.
// The curtain sweeps in from the left at the start of a beat and out to the right at the end.
function Curtain({ p, frame, durationInFrames, isLast, slanted }) {
  const enter = interpolate(frame, [0, 22], [0, 100], smooth);
  const exit = isLast ? 100 : interpolate(frame, [durationInFrames - 16, durationInFrames - 1], [-100, 0], clamp);
  const x = frame < durationInFrames / 2 ? enter : exit;
  return <AbsoluteFill style={{ pointerEvents: "none", transform: `translateX(${x}%) skewX(${slanted ? -12 : 0}deg)` }}>
    <AbsoluteFill style={{ background: `linear-gradient(${slanted ? 100 : 90}deg, ${p.primaryColor}, ${p.secondaryColor})` }} />
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, background: "#fff", boxShadow: "0 0 30px 8px rgba(255,255,255,.6)" }} />
  </AbsoluteFill>;
}

// Thin progress line along the top edge.
function BeatProgress({ p, frame, durationInFrames }) {
  return <div style={{
    position: "absolute", left: 0, top: 0, height: 5, zIndex: 5,
    width: `${Math.min(1, frame / durationInFrames) * 100}%`,
    background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor})`,
  }} />;
}

// ---------------------------------------------------------------------------
// Text animation.
// ---------------------------------------------------------------------------

// Reads "1,050", "85", "4.5" or "40%" into a number plus its formatting, so it can count up.
function parseStat(value) {
  const m = String(value).match(/^([^0-9]*)([0-9][0-9,]*(?:\.[0-9]+)?)(.*)$/);
  if (!m) return null;
  return { prefix: m[1], n: Number(m[2].replace(/,/g, "")), decimals: (m[2].split(".")[1] || "").length, hasComma: m[2].includes(","), suffix: m[3] };
}

function formatStat(v, parsed) {
  const fixed = v.toFixed(parsed.decimals);
  return parsed.hasComma
    ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals })
    : fixed;
}

// Headline: each word slides up out of a mask, un-blurs and settles with a slight tilt.
// The longest word is picked out with a moving gradient fill and a line that draws beneath it.
function Words({ text, frame, p, startFrame = 6, step = 3 }) {
  const { fps } = useVideoConfig();
  const words = String(text || "").split(" ");
  const longest = words.reduce((best, w, i) => (w.length > (words[best]?.length || 0) ? i : best), 0);
  const highlight = words.length >= 3 && (words[longest] || "").length >= 6 ? longest : -1;
  return <span>{words.map((w, i) => {
    const start = startFrame + i * step;
    const r = spring({ frame: frame - start, fps, config: { damping: 200 } });
    const isHi = i === highlight;
    const hiStyle = isHi ? {
      background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor}, ${p.primaryColor})`,
      backgroundSize: "200% auto", backgroundPosition: `${(frame * 1.2) % 100}% center`,
      WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent",
    } : {};
    const line = interpolate(frame, [start + 10, start + 34], [0, 100], smooth);
    return <span key={i} style={{ display: "inline-block", overflow: "hidden", position: "relative", verticalAlign: "bottom", marginRight: "0.28em", paddingBottom: "0.1em" }}>
      <span style={{
        display: "inline-block",
        transform: `translateY(${interpolate(r, [0, 1], [110, 0], clamp)}%) rotate(${interpolate(r, [0, 1], [5, 0], clamp)}deg)`,
        transformOrigin: "left bottom",
        filter: `blur(${interpolate(r, [0, 1], [5, 0], clamp)}px)`,
        opacity: interpolate(r, [0, 0.25], [0, 1], clamp),
        ...hiStyle,
      }}>{w}</span>
      {isHi && <span style={{ position: "absolute", left: 0, bottom: 0, height: 5, width: `${line}%`, borderRadius: 3, background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor})` }} />}
    </span>;
  })}</span>;
}

// Caption: the letter-spacing opens up as the label appears, with a short accent rule before it.
function Caption({ text, frame, color }) {
  const spacing = interpolate(frame, [0, 26], [14, 4], smooth);
  return <div style={{ display: "flex", alignItems: "center", gap: 14, color, fontSize: 16, fontWeight: 800, marginBottom: 16, opacity: interpolate(frame, [0, 12], [0, 1], clamp) }}>
    <span style={{ display: "inline-block", height: 3, width: interpolate(frame, [0, 24], [0, 56], smooth), background: color, borderRadius: 2 }} />
    <span style={{ letterSpacing: `${spacing}px`, textTransform: "uppercase" }}>{text}</span>
  </div>;
}

// ---------------------------------------------------------------------------
// Data components: stats, campaign ring, call-to-action chips.
// ---------------------------------------------------------------------------

// A gradient bar with a light shine that keeps travelling across the filled part.
function Bar({ percent, p, t, frame, height = 4, radius = 2, marginTop = 14 }) {
  const width = Math.max(0, Math.min(100, percent));
  return <div style={{ height, background: t.track, borderRadius: radius, marginTop, overflow: "hidden" }}>
    <div style={{ position: "relative", overflow: "hidden", height: "100%", width: `${width}%`, background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor})` }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, width: "35%", left: `${((frame * 4) % 160) - 50}%`, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)" }} />
    </div>
  </div>;
}

// Circular progress ring that fills with a gradient.
function Ring({ percent, p, t, size = 150, stroke = 14 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
  const id = `ring-${p.primaryColor.slice(1)}`;
  return <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flex: "0 0 auto" }}>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={p.primaryColor} />
        <stop offset="1" stopColor={p.secondaryColor} />
      </linearGradient>
    </defs>
    <circle cx={size / 2} cy={size / 2} r={r} stroke={t.track} strokeWidth={stroke} fill="none" />
    <circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
  </svg>;
}

// A card whose border is a slowly rotating gradient.
function GlassCard({ p, t, frame, children, minWidth = 220 }) {
  return <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, padding: 2, minWidth, boxShadow: "0 14px 40px rgba(0,0,0,.14)" }}>
    <div style={{
      position: "absolute", left: "-50%", top: "-50%", width: "200%", height: "200%",
      background: `conic-gradient(from ${frame * 3}deg, ${p.primaryColor}, ${p.secondaryColor}, ${p.primaryColor})`,
    }} />
    <div style={{ position: "relative", background: t.panel, backdropFilter: "blur(10px)", borderRadius: 16, padding: "18px 22px 20px", height: "100%", boxSizing: "border-box" }}>
      {children}
    </div>
  </div>;
}

// Statistics: each card springs in turn, the figure counts up, and a bar fills beneath it.
function Stats({ items, p, t, frame }) {
  const { fps } = useVideoConfig();
  return <div style={{ display: "flex", gap: 18, marginTop: 28, flexWrap: "wrap" }}>
    {items.map((item, i) => {
      const start = 10 + i * 12;
      const reveal = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 140 } });
      const parsed = parseStat(item.value);
      const countProgress = interpolate(frame, [start + 4, start + 50], [0, 1], smooth);
      const shown = parsed ? `${parsed.prefix}${formatStat(parsed.n * countProgress, parsed)}${parsed.suffix}` : item.value;
      const barGrow = interpolate(frame, [start + 8, start + 56], [0, 100], smooth);
      return <div key={i} style={{ opacity: interpolate(reveal, [0, 1], [0, 1], clamp), transform: `translateY(${interpolate(reveal, [0, 1], [30, 0], clamp)}px) scale(${interpolate(reveal, [0, 1], [0.92, 1], clamp)})` }}>
        <GlassCard p={p} t={t} frame={frame}>
          <div style={{ fontSize: 50, fontWeight: 800, color: t.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>{shown}</div>
          <Bar percent={barGrow} p={p} t={t} frame={frame} />
          <div style={{ fontSize: 16, color: t.muted, marginTop: 10, letterSpacing: 0.3 }}>{item.label}</div>
        </GlassCard>
      </div>;
    })}
  </div>;
}

// Campaign: a ring and the raised amount count up together.
function Campaign({ sub, p, t, frame }) {
  const progress = interpolate(frame, [10, 64], [0, 1], smooth);
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const percent = Number(sub.percent) || 0;
  const shownPercent = percent * progress;
  return <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 28, maxWidth: 820 }}>
    <div style={{ position: "relative", width: 150, height: 150 }}>
      <Ring percent={shownPercent} p={p} t={t} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 800, color: t.ink, fontVariantNumeric: "tabular-nums" }}>
        {Math.round(shownPercent)}%
      </div>
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: t.ink }}>{sub.title}</div>
      <div style={{ fontSize: 22, marginTop: 10, color: t.muted, fontVariantNumeric: "tabular-nums" }}>
        <strong style={{ color: t.ink }}>{fmt(Math.round((Number(sub.raised) || 0) * progress))}</strong> raised of {fmt(sub.goal)} goal
      </div>
      <Bar percent={shownPercent} p={p} t={t} frame={frame} height={10} radius={8} marginTop={14} />
    </div>
  </div>;
}

// Call-to-action chips pop in one after another, then breathe with a soft glow.
function Chips({ t, p, frame }) {
  const { fps } = useVideoConfig();
  return <div style={{ display: "flex", gap: 14, marginTop: 28 }}>
    {["Give", "Volunteer", "Pray"].map((label, i) => {
      const r = spring({ frame: frame - 14 - i * 6, fps, config: { damping: 9, stiffness: 180 } });
      const breathe = 0.5 + 0.5 * Math.sin((frame - 30 - i * 8) / 10);
      return <span key={label} style={{
        border: `2px solid ${t.accent}`, padding: "10px 22px", fontSize: 20, fontWeight: 700, color: t.ink, background: t.panel,
        opacity: interpolate(r, [0, 1], [0, 1], clamp), transform: `scale(${Math.max(0, r)})`, display: "inline-block", borderRadius: 999,
        boxShadow: r > 0.9 ? `0 0 ${14 + breathe * 12}px ${p.primaryColor}${Math.round((0.2 + breathe * 0.35) * 255).toString(16).padStart(2, "0")}` : "none",
      }}>{label}</span>;
    })}
  </div>;
}

// ---------------------------------------------------------------------------
// Beat content.
// ---------------------------------------------------------------------------
function BeatContent({ p, t, scene, frame }) {
  const sub = scene.subline || {};
  const premium = p.style === "premium";
  const headSize = scene.id === "intro" ? 72 : 52;
  const captionColor = premium ? t.edge : t.accent;
  return <>
    <Caption text={scene.caption} frame={frame} color={captionColor} />
    <div style={{ color: t.ink, fontSize: headSize, lineHeight: 1.12, fontWeight: premium ? 400 : 800, fontFamily: premium ? "Georgia, 'Times New Roman', serif" : "inherit", textShadow: t.shadow, maxWidth: 1040, letterSpacing: premium ? 0 : -0.5 }}>
      <Words text={scene.narration} frame={frame} p={p} />
    </div>
    {sub.type === "tagline" && sub.text && <div style={{ fontSize: 24, color: t.muted, marginTop: 20, opacity: interpolate(frame, [24, 42], [0, 1], clamp), transform: `translateY(${interpolate(frame, [24, 42], [12, 0], smooth)}px)` }}>{sub.text}</div>}
    {sub.type === "stats" && sub.items?.length > 0 && <Stats items={sub.items} p={p} t={t} frame={frame} />}
    {sub.type === "campaign" && <Campaign sub={sub} p={p} t={t} frame={frame} />}
    {scene.id === "cta" && <Chips t={t} p={p} frame={frame} />}
  </>;
}

// Organization line for the news layout's lower third: a sheen sweeps across once when it arrives.
function Sheen({ frame, start = 8, duration = 40 }) {
  const x = interpolate(frame, [start, start + duration], [-60, 160], smooth);
  return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,.16) 50%, transparent 60%)", transform: `translateX(${x}%)` }} />;
}

// ---------------------------------------------------------------------------
// Closing: logo (or organization name) with a light sheen, then a QR card with a scanning line.
// ---------------------------------------------------------------------------
function ClosingScene({ p, t, scene, frame, durationInFrames }) {
  const { fps } = useVideoConfig();
  const half = Math.round(durationInFrames * 0.5);
  const logoIn = spring({ frame: frame - 4, fps, config: { damping: 11, stiffness: 120 } });
  const logoOut = interpolate(frame, [half - 12, half], [1, 0], clamp);
  const qrIn = spring({ frame: frame - half, fps, config: { damping: 14, stiffness: 140 } });
  const qrFrame = Math.max(0, frame - half);
  const hasArt = Boolean(scene.artPath);
  const sub = scene.subline || {};
  const sheen = interpolate(frame, [10, 56], [-60, 160], smooth);
  const scan = ((qrFrame % 64) / 64) * 100;

  return <AbsoluteFill style={{ background: p.backgroundColor }}>
    {hasArt && <Img src={staticFile(scene.artPath)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
    {hasArt && <AbsoluteFill style={{ background: t.light ? "rgba(255,255,255,.35)" : "rgba(7,16,29,.35)", opacity: interpolate(qrIn, [0, 1], [0, 1], clamp) }} />}
    <Mesh p={p} t={t} frame={frame} />
    <Particles p={p} t={t} count={44} speed={1.4} />

    {/* First half: logo full screen with a glow and a sheen (or the predefined card). */}
    {!hasArt && <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: logoOut * interpolate(logoIn, [0, 1], [0, 1], clamp) }}>
      <div style={{ position: "absolute", width: 960, height: 960, borderRadius: "50%", background: `radial-gradient(circle, ${p.primaryColor}40, transparent 60%)`, transform: `scale(${interpolate(logoIn, [0, 1], [0.6, 1], clamp)})` }} />
      <div style={{ transform: `scale(${interpolate(logoIn, [0, 1], [0.7, 1], clamp)})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 12 }}>
          {p.logoPath
            ? <Img src={staticFile(p.logoPath)} style={{ width: 620, height: 400, objectFit: "contain", mixBlendMode: t.light ? "multiply" : "normal", display: "block" }} />
            : <div style={{ color: t.ink, fontSize: 98, fontWeight: 700, textAlign: "center", lineHeight: 1.1, maxWidth: 1000 }}><Words text={p.organizationName} frame={frame} p={p} startFrame={6} step={3} /></div>}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,.4) 50%, transparent 60%)", transform: `translateX(${sheen}%)` }} />
        </div>
        <div style={{ color: t.ink, fontSize: 30, fontWeight: 600, letterSpacing: 8, textTransform: "uppercase", marginTop: 26, opacity: interpolate(frame, [22, 40], [0, 1], clamp) }}>{scene.title || "Organization Spotlight"}</div>
        <div style={{ height: 3, background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor})`, marginTop: 18, width: interpolate(frame, [18, 50], [0, 300], smooth), borderRadius: 2 }} />
      </div>
    </AbsoluteFill>}

    {/* Second half: QR card with expanding ripples and a scanning line. */}
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(qrIn, [0, 1], [0, 1], clamp) }}>
      {[0, 0.33, 0.66].map((offset, i) => {
        const q = ((qrFrame / 56) + offset) % 1;
        const size = 300 + q * 900;
        return <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: "50%", border: `2px solid ${p.primaryColor}`, opacity: (1 - q) * 0.35 }} />;
      })}
      <div style={{ position: "relative", borderRadius: 29, padding: 3, background: `linear-gradient(${qrFrame * 2}deg, ${p.primaryColor}, ${p.secondaryColor}, ${p.primaryColor})`, boxShadow: "0 22px 60px rgba(0,0,0,.22)", transform: `translateY(${interpolate(qrIn, [0, 1], [34, 0], clamp)}px) scale(${interpolate(qrIn, [0, 1], [0.94, 1], clamp)})` }}>
      <div style={{ background: t.light ? "#ffffff" : "#0b1424", borderRadius: 26, padding: "40px 56px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <div style={{ color: t.edge, fontSize: 16, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase" }}>{scene.title || "Organization Spotlight"}</div>
        {p.qrPath && <div style={{ position: "relative", overflow: "hidden", borderRadius: 14 }}>
          <Img src={staticFile(p.qrPath)} style={{ width: 300, height: 300, background: "#fff", padding: 16, borderRadius: 14, display: "block" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: `${scan}%`, height: 4, background: `linear-gradient(90deg, transparent, ${p.primaryColor}, transparent)`, boxShadow: `0 0 16px 4px ${p.primaryColor}88` }} />
        </div>}
        <div style={{ fontSize: 28, fontWeight: 700, color: t.ink }}>Scan to view our profile</div>
        {sub.text && <div style={{ fontSize: 20, color: t.muted }}>{sub.text}</div>}
      </div>
      </div>
    </AbsoluteFill>

    {/* AI disclosure stays on screen for the whole closing scene. */}
    <div style={{ position: "absolute", left: 60, right: 60, bottom: 30, textAlign: "center", fontSize: 16, lineHeight: 1.5, color: t.muted }}>{scene.footnote}</div>
  </AbsoluteFill>;
}

// ---------------------------------------------------------------------------
// Beat layouts and the sequence.
// ---------------------------------------------------------------------------
function Beat({ p, scene, index, total }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = themeOf(p);
  const enter = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const premium = p.style === "premium";
  const rise = interpolate(enter, [0, 1], [26, 0], clamp);
  const orgLine = `${p.organizationName}`.toUpperCase().slice(0, 48);
  const closing = scene.id === "closing";
  const isLast = index === total - 1;
  const slanted = index % 2 === 1;
  const ruleWidth = interpolate(frame, [6, 40], [0, 100], smooth);

  return <AbsoluteFill style={{ color: t.ink, fontFamily: premium ? "Georgia, 'Times New Roman', serif" : "Arial, Helvetica, sans-serif" }}>
    {closing
      ? <ClosingScene p={p} t={t} scene={scene} frame={frame} durationInFrames={durationInFrames} />
      : <>
        <BeatBackground p={p} t={t} scene={scene} frame={frame} durationInFrames={durationInFrames} />
        <Mesh p={p} t={t} frame={frame} />
        <Particles p={p} t={t} />
        <LightSweep frame={frame} color={p.secondaryColor} t={t} />
        {scene.id === "intro" && <Sparkles p={p} frame={frame} />}
        {premium ? <AbsoluteFill style={{ padding: "64px 84px", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, letterSpacing: 4, color: t.muted, opacity: interpolate(frame, [0, 12], [0, 1], clamp) }}>
                <span>{orgLine}</span>
                {p.logoPath ? <Img src={staticFile(p.logoPath)} style={{ width: 54, height: 54, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 4 }} /> : <span>{CAUSE_LABEL[p.cause] || ""}</span>}
              </div>
              <div style={{ height: 1, background: t.edge, width: `${ruleWidth}%`, marginTop: 14, opacity: 0.7 }} />
            </div>
            <div style={{ maxWidth: 1000, transform: `translateY(${rise}px)` }}>
              <BeatContent p={p} t={t} scene={scene} frame={frame} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, letterSpacing: 3, color: t.muted, opacity: interpolate(frame, [8, 22], [0, 1], clamp) }}>
              <span>{(CAUSE_LABEL[p.cause] || "").toUpperCase()} · {p.tagline}</span>
              <span>{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
            </div>
            <PremiumMarquee p={p} frame={frame} />
          </AbsoluteFill> : <AbsoluteFill style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "36px 56px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 15, letterSpacing: 3, background: t.panel, padding: "8px 14px", color: t.ink, transform: `translateX(${interpolate(frame, [0, 18], [-60, 0], smooth)}px)`, opacity: interpolate(frame, [0, 12], [0, 1], clamp), borderRadius: 6 }}>
                {p.logoPath && <Img src={staticFile(p.logoPath)} style={{ width: 34, height: 34, objectFit: "contain", background: "#fff", borderRadius: 4, padding: 2 }} />}
                <span style={{ background: p.primaryColor, color: "#fff", padding: "3px 8px", fontWeight: 800, borderRadius: 3 }}>{(CAUSE_LABEL[p.cause] || "").toUpperCase()}</span>
                <span>{orgLine}</span>
              </div>
              <div style={{ fontSize: 13, letterSpacing: 2, background: t.panel, color: t.ink, padding: "8px 12px", borderRadius: 6 }}>{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</div>
            </div>
            <div style={{ position: "relative", overflow: "hidden", background: t.panel, borderLeft: `8px solid ${t.edge}`, padding: "34px 56px 40px", transform: `translateY(${rise}px)`, borderRadius: "0 14px 14px 0" }}>
              <BeatContent p={p} t={t} scene={scene} frame={frame} />
              <Sheen frame={frame} />
            </div>
            <Ticker p={p} />
          </AbsoluteFill>}
      </>}
    <Grain frame={frame} t={t} />
    {!closing && <Flash frame={frame} color={p.secondaryColor} t={t} />}
    <BeatProgress p={p} frame={frame} durationInFrames={durationInFrames} />
    <Curtain p={p} frame={frame} durationInFrames={durationInFrames} isLast={isLast} slanted={slanted} />
    {scene.audioPath && <Audio src={staticFile(scene.audioPath)} volume={1} />}
  </AbsoluteFill>;
}

// News-style crawl along the bottom edge, with a LIVE badge.
function Ticker({ p }) {
  const frame = useCurrentFrame();
  const line = [p.organizationName, p.tagline, p.websiteUrl].filter(Boolean).join("   •   ") + "   •   ";
  const shift = frame * 2.4;
  const pulse = 0.6 + 0.4 * Math.sin(frame / 6);
  return <div style={{ background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor})`, color: "#fff", height: 46, display: "flex", alignItems: "center", overflow: "hidden", fontSize: 18, fontWeight: 700, letterSpacing: 1, position: "relative" }}>
    <div style={{ flex: "0 0 auto", height: "100%", display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: p.backgroundColor || "#0b1020", zIndex: 1, fontSize: 14, letterSpacing: 3 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff", opacity: pulse, boxShadow: "0 0 12px #fff" }} />
      <span>LIVE</span>
    </div>
    <div style={{ whiteSpace: "nowrap", transform: `translateX(${-shift}px)`, paddingLeft: 32 }}>{line.repeat(10)}</div>
  </div>;
}


// Premium style: a full-bleed headline marquee along the bottom edge. Headlines are drawn from the
// organization's own text, so every word on screen is one the organization entered.
function PremiumMarquee({ p, frame }) {
  const fontSize = 15;
  const headlines = [p.organizationName, p.tagline, CAUSE_LABEL[p.cause] || "", p.websiteUrl]
    .filter(Boolean)
    .map(s => String(s).toUpperCase());
  const unit = headlines.join("   ◆   ") + "   ◆   ";
  // Approximate width of one unit, used to loop the track without a visible seam.
  const unitPx = unit.length * fontSize * 0.7;
  const offset = (frame * 1.6) % unitPx;
  const fade = interpolate(frame, [4, 24], [0, 1], clamp);
  return <div style={{ width: "calc(100% + 168px)", marginLeft: -84, marginBottom: -64, height: 58, overflow: "hidden", background: `linear-gradient(90deg, ${p.primaryColor}, ${p.secondaryColor})`, display: "flex", alignItems: "center", opacity: fade }}>
    <div style={{ whiteSpace: "nowrap", color: "#fff", fontFamily: "Georgia, 'Times New Roman', serif", fontSize, letterSpacing: 4, fontWeight: 400, transform: `translateX(${-offset}px)` }}>{unit.repeat(8)}</div>
  </div>;
}

export const PromoVideo = (p) => {
  const scenes = Array.isArray(p.scenes) && p.scenes.length ? p.scenes : [];
  let start = 0;
  return <AbsoluteFill style={{ background: p.backgroundColor || "#0b1020" }}>
    {scenes.map((scene, i) => {
      const from = start; const duration = Math.max(45, Number(scene.durationInFrames) || 90); start += duration;
      return <Sequence key={`${scene.id}-${i}`} from={from} durationInFrames={duration}>
        <Beat p={p} scene={scene} index={i} total={scenes.length} />
      </Sequence>;
    })}
  </AbsoluteFill>;
};
