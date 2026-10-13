import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { randomToken } from "./crypto";
import { configuredUrl } from "./url";

// Render's free instance has 512 MB of memory and the whole file passes through it.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

export type UploadKind = "video" | "image";

export function kindOf(mimeType: string): UploadKind | null {
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") return "video";
  // Instagram only accepts JPEG for image posts
  if (mimeType === "image/jpeg") return "image";
  return null;
}

export function mediaUrl(publicToken: string, base?: string) {
  const origin = configuredUrl() || base || "";
  if (!origin) throw new Error("Sayt manzili noma'lum: APP_URL ni sozlang");
  return `${origin}/api/media/${publicToken}`;
}

// Bytes of old uploads are dropped so the free database (1 GB) doesn't fill up.
async function cleanup() {
  await prisma.mediaUpload.updateMany({
    where: { expiresAt: { lt: new Date() }, data: { not: null } },
    data: { data: null },
  });
}

export async function saveUpload(userId: string, file: File) {
  return saveBytes(userId, new Uint8Array(await file.arrayBuffer()), file.name, file.type);
}

export async function saveBytes(userId: string, bytes: Uint8Array, filename: string, mimeType: string) {
  const kind = kindOf(mimeType);
  if (!kind) throw new Error("Faqat MP4/MOV video yoki JPEG rasm yuklash mumkin");
  const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!bytes.length) throw new Error("Fayl bo'sh");
  if (bytes.length > max) throw new Error(`Fayl juda katta: ko'pi bilan ${Math.round(max / 1024 / 1024)} MB`);
  await cleanup();
  const row = await prisma.mediaUpload.create({
    data: {
      userId,
      publicToken: randomToken(24),
      filename: filename.slice(0, 200) || (kind === "video" ? "video.mp4" : "photo.jpg"),
      mimeType,
      size: bytes.length,
      data: bytes,
      expiresAt: new Date(Date.now() + KEEP_MS),
    },
    select: { id: true, filename: true, mimeType: true, size: true, publicToken: true, createdAt: true },
  });
  return { ...row, kind };
}

// One-time-ish upload links for AI clients that have a shell but no browser session.
const UPLOAD_LINK_MS = 30 * 60 * 1000;

function uploadSecret() {
  return new TextEncoder().encode(`${process.env.AUTH_SECRET || "dev-auth-secret-change-me-please"}:upload`);
}

export async function createUploadToken(userId: string) {
  return new SignJWT({ sub: userId, purpose: "upload" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + UPLOAD_LINK_MS))
    .sign(uploadSecret());
}

export async function userFromUploadToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, uploadSecret());
    return payload.purpose === "upload" && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

export async function listUploads(userId: string) {
  const rows = await prisma.mediaUpload.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, filename: true, mimeType: true, size: true, publishedId: true, createdAt: true, expiresAt: true, data: false },
  });
  const live = await prisma.mediaUpload.findMany({
    where: { userId, id: { in: rows.map((r) => r.id) }, data: { not: null } },
    select: { id: true },
  });
  const available = new Set(live.map((r) => r.id));
  return rows.map((r) => ({ ...r, kind: kindOf(r.mimeType), available: available.has(r.id) }));
}

// Resolves an upload the user owns to the public URL Instagram downloads from.
export async function uploadForPublish(userId: string, uploadId: string, base?: string) {
  const row = await prisma.mediaUpload.findFirst({
    where: { id: uploadId, userId },
    select: { id: true, publicToken: true, mimeType: true, data: false },
  });
  if (!row) throw new Error("Yuklangan fayl topilmadi");
  const has = await prisma.mediaUpload.count({ where: { id: row.id, data: { not: null } } });
  if (!has) throw new Error("Fayl muddati o'tgan yoki allaqachon joylangan — qaytadan yuklang");
  return { id: row.id, kind: kindOf(row.mimeType), url: mediaUrl(row.publicToken, base) };
}

export async function markPublished(uploadId: string, publishedId: string) {
  await prisma.mediaUpload.update({ where: { id: uploadId }, data: { publishedId, data: null } });
}
