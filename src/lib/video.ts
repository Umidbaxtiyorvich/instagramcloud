import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";

// Vertical text-slide videos rendered on the server, so an AI client without ffmpeg
// (Claude on a phone) can still "make" a Reel: it sends the script, we draw it.

export type Slide = { title: string; subtitle?: string; seconds?: number };
export type VideoSpec = {
  slides: Slide[];
  theme?: keyof typeof THEMES;
  brand?: string; // small label at the top of every slide
  footer?: string; // band at the bottom of every slide, e.g. a phone number
};

const THEMES = {
  sky: { c0: "0x38BDF8", c1: "0x1D4ED8", text: "white", accent: "0xFDE68A" },
  ocean: { c0: "0x0EA5E9", c1: "0x312E81", text: "white", accent: "0x67E8F9" },
  red: { c0: "0xF87171", c1: "0xB91C1C", text: "white", accent: "0xFDE68A" },
  sunset: { c0: "0xFB923C", c1: "0xDB2777", text: "white", accent: "0xFEF08A" },
  dark: { c0: "0x1E293B", c1: "0x020617", text: "white", accent: "0x38BDF8" },
  light: { c0: "0xF0F9FF", c1: "0xBAE6FD", text: "0x0B1B33", accent: "0x1677FF" },
} as const;

export const THEME_NAMES = Object.keys(THEMES) as (keyof typeof THEMES)[];

const W = 1080;
const H = 1920;
const FONT_BOLD = path.join(process.cwd(), "assets/fonts/Montserrat-ExtraBold.ttf");
const FONT_SEMI = path.join(process.cwd(), "assets/fonts/Montserrat-SemiBold.ttf");

// drawtext doesn't wrap, so lines are broken here by an approximate character budget
function wrap(text: string, max: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > max) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

// a Windows drive colon must be escaped for the option parser (quotes only protect it from the graph parser)
const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

export function validateSpec(spec: VideoSpec) {
  const slides = (spec.slides || []).filter((s) => s && String(s.title || "").trim());
  if (!slides.length) throw new Error("Kamida bitta slayd (title) kerak");
  if (slides.length > 12) throw new Error("Ko'pi bilan 12 ta slayd");
  const norm = slides.map((s) => ({
    title: String(s.title).trim().slice(0, 120),
    subtitle: s.subtitle ? String(s.subtitle).trim().slice(0, 200) : "",
    seconds: Math.min(Math.max(Number(s.seconds) || 3, 1.5), 10),
  }));
  const total = norm.reduce((a, s) => a + s.seconds, 0);
  if (total < 3) norm[norm.length - 1].seconds += 3 - total;
  if (total > 60) throw new Error("Video 60 soniyadan oshmasin");
  const theme = spec.theme && spec.theme in THEMES ? spec.theme : "sky";
  return { slides: norm, theme, brand: (spec.brand || "").trim().slice(0, 40), footer: (spec.footer || "").trim().slice(0, 60) };
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

export async function renderVideo(input: VideoSpec) {
  const spec = validateSpec(input);
  const t = THEMES[spec.theme];
  const total = spec.slides.reduce((a, s) => a + s.seconds, 0);
  const dir = await mkdtemp(path.join(tmpdir(), "igv-"));
  try {
    const filters: string[] = [];
    let n = 0;
    // text goes through files so quotes, colons and apostrophes need no escaping
    const textFile = async (s: string) => {
      const f = path.join(dir, `t${n++}.txt`);
      await writeFile(f, s, "utf8");
      return esc(f);
    };
    const draw = (file: string, font: string, size: number, color: string, y: string, enable: string, alpha: string) =>
      `drawtext=fontfile='${esc(font)}':textfile='${file}':fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y='${y}':enable='${enable}':alpha='${alpha}'`;

    if (spec.brand) {
      filters.push(draw(await textFile(spec.brand.toUpperCase()), FONT_SEMI, 44, t.text, "150", "gte(t,0)", "0.85"));
    }
    if (spec.footer) {
      filters.push(`drawbox=x=0:y=${H - 300}:w=${W}:h=300:color=black@0.25:t=fill`);
      filters.push(draw(await textFile(spec.footer), FONT_BOLD, 64, t.accent, `${H - 150}-th/2`, "gte(t,0)", "1"));
    }

    let start = 0;
    for (const s of spec.slides) {
      const a = start;
      const b = start + s.seconds;
      const enable = `between(t,${a.toFixed(2)},${b.toFixed(2)})`;
      // fade in over 0.4 s, fade out over the last 0.3 s
      const alpha = `if(lt(t,${a}+0.4),(t-${a})/0.4,if(gt(t,${b}-0.3),(${b}-t)/0.3,1))`;
      const rise = `40*max(0,1-(t-${a})/0.4)`;
      const titleLines = wrap(s.title, 15);
      const subLines = s.subtitle ? wrap(s.subtitle, 26) : [];
      const titleH = titleLines.length * 128;
      const subH = subLines.length ? 50 + subLines.length * 76 : 0;
      let y = Math.round((H - titleH - subH) / 2) - 60;
      for (const line of titleLines) {
        filters.push(draw(await textFile(line), FONT_BOLD, 104, t.text, `${y}+${rise}`, enable, alpha));
        y += 128;
      }
      if (subLines.length) {
        filters.push(`drawbox=x=${W / 2 - 60}:y=${y + 10}:w=120:h=8:color=${t.accent}:t=fill:enable='${enable}'`);
        y += 50;
        for (const line of subLines) {
          filters.push(draw(await textFile(line), FONT_SEMI, 58, t.text, `${y}+${rise}*1.5`, enable, alpha));
          y += 76;
        }
      }
      start = b;
    }

    const out = path.join(dir, "out.mp4");
    const script = path.join(dir, "vf.txt");
    await writeFile(script, filters.join(",\n"), "utf8");
    await run([
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=${t.c0}:c1=${t.c1}:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.008:d=${total.toFixed(2)}:r=30`,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-filter_script:v", script,
      "-t", total.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart",
      out,
    ]);
    return { bytes: new Uint8Array(await readFile(out)), seconds: total };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
