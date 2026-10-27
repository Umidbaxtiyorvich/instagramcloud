import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "./db";
import { saveBytes, mediaUrl } from "./uploads";
import { configuredUrl } from "./url";
import { validateSpec, type VideoSpec } from "./video";

// Video yasash GitHub Actions'da: Render'ning bepul serveri (0.15 CPU, 512 MB) ffmpeg'ni
// ko'tarolmaydi. Sayt ishni bazaga yozadi va workflow'ni ishga tushiradi; runner ssenariyni
// oladi, videoni yasaydi va qaytaradi. Runner hech qanday parolsiz keladi — sayt uning
// GitHub OIDC tokenini tekshiradi (shu repo, shu workflow).

const REPO = process.env.GITHUB_REPO || "Umidbaxtiyorvich/instagramcloud";
const BRANCH = process.env.GITHUB_BRANCH || "claude/instagram-integration-site-msih8q";
const WORKFLOW = "video.yml";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const jwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

export const githubdaYasash = () => Boolean(process.env.GITHUB_DISPATCH_TOKEN && configuredUrl());

export type Maqsad = { tur: "agent" } | { tur: "miya-reels"; kalit: string; caption: string };

export async function videoNavbat(userId: string, spec: VideoSpec, maqsad: Maqsad) {
  const toza = validateSpec(spec); // xatoni darhol aytamiz, runnerda emas
  const ish = await prisma.videoIsh.create({
    data: {
      userId,
      spec: JSON.stringify({ ...spec, slides: toza.slides }),
      maqsad: maqsad.tur,
      meta: JSON.stringify(maqsad.tur === "miya-reels" ? { kalit: maqsad.kalit, caption: maqsad.caption } : {}),
    },
  });
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: BRANCH, inputs: { ish: ish.id, sayt: configuredUrl() } }),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status !== 204) {
    const m = `GitHub workflow ishga tushmadi: HTTP ${r.status}${r.status === 401 || r.status === 403 ? " (GITHUB_DISPATCH_TOKEN noto'g'ri yoki ruxsati yetmaydi)" : ""}`;
    await prisma.videoIsh.update({ where: { id: ish.id }, data: { holat: "xato", xato: m } });
    throw new Error(m);
  }
  return ish;
}

// Runnerning OIDC tokeni: aynan shu repodagi shu workflow'dan bo'lishi shart
export async function runnerTekshir(req: Request, workflow = WORKFLOW) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("token yo'q");
  const { payload } = await jwtVerify(token, jwks, { issuer: OIDC_ISSUER, audience: configuredUrl() });
  const repo = String(payload.repository || "");
  const wf = String(payload.workflow_ref || "");
  if (repo !== REPO || !wf.startsWith(`${REPO}/.github/workflows/${workflow}@`)) throw new Error("boshqa repo yoki workflow");
}

export async function ishTugadi(id: string, bytes: Uint8Array) {
  const ish = await prisma.videoIsh.findUnique({ where: { id } });
  if (!ish || ish.holat === "tayyor") throw new Error("Ish topilmadi yoki allaqachon tugagan");
  const u = await saveBytes(ish.userId, bytes, `video-${Date.now()}.mp4`, "video/mp4");
  await prisma.videoIsh.update({ where: { id }, data: { holat: "tayyor", uploadId: u.id } });
  const meta = JSON.parse(ish.meta) as { kalit?: string; caption?: string };
  // miya.ts → mcp.ts → video-ish.ts aylanasiga tushmaslik uchun kech yuklaymiz
  const miya = await import("./miya");
  if (ish.maqsad === "miya-reels" && meta.kalit) {
    await miya.reelsVideoTayyor(ish.userId, meta.kalit, u.id, meta.caption ?? "");
  } else {
    await miya.videoXabar(ish.userId, `🎬 Video tayyor: ${u.filename} (upload_id ${u.id}). Ko'rish: ${mediaUrl(u.publicToken)}\nJoylash uchun ofisda ayting yoki «Rejadagi postlar»da vaqtga qo'ying.`, `video:${id}`);
  }
}

export async function ishXato(id: string, xato: string) {
  const ish = await prisma.videoIsh.findUnique({ where: { id } });
  if (!ish || ish.holat === "tayyor") return;
  await prisma.videoIsh.update({ where: { id }, data: { holat: "xato", xato: xato.slice(0, 1000) } });
  const meta = JSON.parse(ish.meta) as { kalit?: string };
  const miya = await import("./miya");
  if (ish.maqsad === "miya-reels" && meta.kalit) await miya.reelsVideoXato(ish.userId, meta.kalit, xato);
  else await miya.videoXabar(ish.userId, `⚠️ Video yasalmadi: ${xato.slice(0, 300)}`, `video:${id}`, "xavf");
}

// 25 daqiqadan beri tugamagan ishlar — runner o'lgan yoki workflow ishga tushmagan
export async function osilganIshlar() {
  const eski = await prisma.videoIsh.findMany({
    where: { holat: { in: ["kutmoqda", "ishlanmoqda"] }, createdAt: { lt: new Date(Date.now() - 25 * 60_000) } },
    take: 10,
  });
  for (const i of eski) await ishXato(i.id, "GitHub'da video 25 daqiqada tayyor bo'lmadi");
}
