import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

// Vertical text-slide videos rendered on the server, so an AI client without ffmpeg
// (Claude on a phone) can still "make" a Reel: it sends the script, we draw it.
// Text is drawn into PNG layers here: the static ffmpeg build on Render has no
// libfreetype, so its `drawtext` filter doesn't exist. ffmpeg only fades and overlays.

export type Slide = { title: string; subtitle?: string; seconds?: number };
export type VideoSpec = {
  slides: Slide[];
  theme?: keyof typeof THEMES;
  brand?: string; // small label at the top of every slide
  footer?: string; // band at the bottom of every slide, e.g. a phone number
};

const THEMES = {
  sky: { c0: "0x38BDF8", c1: "0x1D4ED8", text: "#FFFFFF", accent: "#FDE68A" },
  ocean: { c0: "0x0EA5E9", c1: "0x312E81", text: "#FFFFFF", accent: "#67E8F9" },
  red: { c0: "0xF87171", c1: "0xB91C1C", text: "#FFFFFF", accent: "#FDE68A" },
  sunset: { c0: "0xFB923C", c1: "0xDB2777", text: "#FFFFFF", accent: "#FEF08A" },
  dark: { c0: "0x1E293B", c1: "0x020617", text: "#FFFFFF", accent: "#38BDF8" },
  light: { c0: "0xF0F9FF", c1: "0xBAE6FD", text: "#0B1B33", accent: "#1677FF" },
} as const;

export const THEME_NAMES = Object.keys(THEMES) as (keyof typeof THEMES)[];

// layout is designed on a 1080×1920 grid; the video itself is 720×1280 (still 9:16,
// accepted by Reels) — a full-HD frame pipeline didn't fit in the free server's 512 MB
const W = 1080;
const H = 1920;
// GitHub Actions runner sets VIDEO_HD=1 (full 1080×1920); a small server renders 720×1280
const OW = process.env.VIDEO_HD ? 1080 : 720;
const OH = process.env.VIDEO_HD ? 1920 : 1280;

function tuval() {
  const c = createCanvas(OW, OH);
  const ctx = c.getContext("2d");
  ctx.scale(OW / W, OH / H);
  return { c, ctx };
}
const FONT_BOLD = path.join(process.cwd(), "assets/fonts/Montserrat-ExtraBold.ttf");
const FONT_SEMI = path.join(process.cwd(), "assets/fonts/Montserrat-SemiBold.ttf");

let shriftlar = false;
function shrift() {
  if (shriftlar) return;
  GlobalFonts.registerFromPath(FONT_BOLD, "MontserratXB");
  GlobalFonts.registerFromPath(FONT_SEMI, "MontserratSB");
  shriftlar = true;
}

// Montserrat has no emoji glyphs — they would render as boxes
const tozala = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim();

// wrap by measured width, so long Uzbek words don't overflow
function wrap(ctx: SKRSContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function validateSpec(spec: VideoSpec) {
  const slides = (spec.slides || []).filter((s) => s && tozala(String(s.title || "")));
  if (!slides.length) throw new Error("Kamida bitta slayd (title) kerak");
  if (slides.length > 12) throw new Error("Ko'pi bilan 12 ta slayd");
  const norm = slides.map((s) => ({
    title: tozala(String(s.title)).slice(0, 120),
    subtitle: s.subtitle ? tozala(String(s.subtitle)).slice(0, 200) : "",
    seconds: Math.min(Math.max(Number(s.seconds) || 3, 1.5), 10),
  }));
  const total = norm.reduce((a, s) => a + s.seconds, 0);
  if (total < 3) norm[norm.length - 1].seconds += 3 - total;
  if (total > 60) throw new Error("Video 60 soniyadan oshmasin");
  const theme = spec.theme && spec.theme in THEMES ? spec.theme : "sky";
  return { slides: norm, theme, brand: tozala(spec.brand || "").slice(0, 40), footer: tozala(spec.footer || "").slice(0, 60) };
}

function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg topilmadi"));
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Video yasalmadi: ${err.trim().split("\n").slice(-12).join(" | ")}`))));
  });
}

type Theme = (typeof THEMES)[keyof typeof THEMES];

// brand at the top and the footer band — the same on every slide
async function doimiyQatlam(theme: Theme, brand: string, footer: string) {
  const { c, ctx } = tuval();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (brand) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme.text;
    ctx.font = "44px MontserratSB";
    ctx.fillText(brand.toUpperCase(), W / 2, 172);
    ctx.globalAlpha = 1;
  }
  if (footer) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, H - 300, W, 300);
    ctx.fillStyle = theme.accent;
    ctx.font = "64px MontserratXB";
    ctx.fillText(footer, W / 2, H - 150, W - 80);
  }
  return c.encode("png");
}

// one slide's title, accent bar and subtitle on a transparent layer
async function slaydQatlam(theme: Theme, title: string, subtitle: string) {
  const { c, ctx } = tuval();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "104px MontserratXB";
  const titleLines = wrap(ctx, title, W - 140);
  ctx.font = "58px MontserratSB";
  const subLines = subtitle ? wrap(ctx, subtitle, W - 160) : [];
  const titleH = titleLines.length * 128;
  const subH = subLines.length ? 50 + subLines.length * 76 : 0;
  let y = Math.round((H - titleH - subH) / 2) - 60;
  ctx.fillStyle = theme.text;
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 18;
  ctx.font = "104px MontserratXB";
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, y);
    y += 128;
  }
  if (subLines.length) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(W / 2 - 60, y + 10, 120, 8);
    y += 50;
    ctx.fillStyle = theme.text;
    ctx.font = "58px MontserratSB";
    for (const line of subLines) {
      ctx.fillText(line, W / 2, y);
      y += 76;
    }
  }
  return c.encode("png");
}

export async function renderVideo(input: VideoSpec) {
  const spec = validateSpec(input);
  const t = THEMES[spec.theme];
  const total = spec.slides.reduce((a, s) => a + s.seconds, 0);
  const mb = () => `${Math.round(process.memoryUsage().rss / 1048576)} MB`;
  console.log(`video: boshlandi, ${spec.slides.length} slayd, ${total.toFixed(1)} s, node ${mb()}`);
  shrift();
  const dir = await mkdtemp(path.join(tmpdir(), "igv-"));
  try {
    // Render's free instance has 512 MB: one ffmpeg holding every full-HD layer at once got
    // the server killed, so each slide is its own short clip (gradient + 2 layers) and the
    // clips are joined without re-encoding.
    const doimiy = path.join(dir, "doimiy.png");
    await writeFile(doimiy, await doimiyQatlam(t, spec.brand, spec.footer));
    console.log(`video: doimiy qatlam chizildi, node ${mb()}`);
    const kliplar: string[] = [];
    for (const [i, s] of spec.slides.entries()) {
      const d = s.seconds.toFixed(2);
      const qatlam = path.join(dir, `s${i}.png`);
      await writeFile(qatlam, await slaydQatlam(t, s.title, s.subtitle));
      console.log(`video: slayd ${i + 1} chizildi, ffmpeg boshlanmoqda, node ${mb()}`);
      const klip = path.join(dir, `k${i}.mp4`);
      // fade in over 0.4 s, fade out over the last 0.3 s, rise 40 px while appearing
      const graph =
        `[0:v][1:v]overlay=0:0:format=auto[b];` +
        `[2:v]format=rgba,fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st=${(s.seconds - 0.3).toFixed(2)}:d=0.3:alpha=1[l];` +
        `[b][l]overlay=x=0:y='27*max(0,1-t/0.4)':format=auto,format=yuv420p[v]`;
      await run([
        "-y", "-loglevel", "error", "-threads", process.env.VIDEO_HD ? "0" : "1", "-filter_threads", process.env.VIDEO_HD ? "0" : "1",
        "-f", "lavfi", "-i", `gradients=s=${OW}x${OH}:c0=${t.c0}:c1=${t.c1}:x0=0:y0=0:x1=${OW}:y1=${OH}:speed=0.008:seed=${i * 7 + 1}:d=${d}:r=30`,
        "-loop", "1", "-framerate", "30", "-t", d, "-i", doimiy,
        "-loop", "1", "-framerate", "30", "-t", d, "-i", qatlam,
        "-f", "lavfi", "-t", d, "-i", "anullsrc=r=44100:cl=stereo",
        "-filter_complex", graph,
        "-map", "[v]", "-map", "3:a", "-t", d,
        "-c:v", "libx264", "-preset", "veryfast", "-x264-params", "rc-lookahead=8:ref=2", "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", "30",
        "-c:a", "aac", "-b:a", "96k", "-ar", "44100",
        klip,
      ]);
      kliplar.push(klip);
    }
    const royxat = path.join(dir, "list.txt");
    await writeFile(royxat, kliplar.map((k) => `file '${k.replace(/\\/g, "/")}'`).join("\n"), "utf8");
    const out = path.join(dir, "out.mp4");
    await run(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", royxat, "-c", "copy", "-movflags", "+faststart", out]);
    const bytes = new Uint8Array(await readFile(out));
    console.log(`video: tayyor, ${Math.round(bytes.length / 1024)} KB, node ${mb()}`);
    return { bytes, seconds: total };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
