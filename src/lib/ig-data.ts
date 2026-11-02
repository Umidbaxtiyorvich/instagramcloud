import type { InstagramAccount } from "@prisma/client";
import { prisma } from "./db";
import { encryptSecret } from "./crypto";
import {
  getMedia,
  listMedia,
  mediaInsights,
  oauthModeIsInstagram,
  refreshInstagramToken,
  tokenOf,
  type IgMedia,
} from "./instagram";

const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

// Instagram Login tokens live 60 days and must be refreshed before they lapse.
export async function freshToken(account: InstagramAccount) {
  const token = tokenOf(account.accessTokenEnc);
  if (account.isDemo || !oauthModeIsInstagram() || !account.tokenExpiresAt) return token;
  if (account.tokenExpiresAt.getTime() - Date.now() > REFRESH_BEFORE_MS) return token;
  try {
    const r = await refreshInstagramToken(token);
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encryptSecret(r.accessToken),
        tokenExpiresAt: r.expiresIn ? new Date(Date.now() + r.expiresIn * 1000) : account.tokenExpiresAt,
      },
    });
    return r.accessToken;
  } catch (e) {
    console.error("token refresh", e);
    return token;
  }
}

function mediaRow(m: IgMedia, ins: Record<string, number>) {
  return {
    mediaType: m.media_product_type === "REELS" ? "REELS" : m.media_product_type || m.media_type,
    caption: m.caption || "",
    permalink: m.permalink || "",
    thumbnail: m.thumbnail_url || m.media_url || "",
    timestamp: m.timestamp ? new Date(m.timestamp) : null,
    views: ins.views || 0,
    reach: ins.reach || 0,
    shares: ins.shares || 0,
    saves: ins.saved || 0,
    likes: ins.likes ?? m.like_count ?? 0,
    comments: ins.comments ?? m.comments_count ?? 0,
    avgWatchSec: Math.round((ins.ig_reels_avg_watch_time || 0) / 1000),
  };
}

export async function safeInsights(m: IgMedia, token: string) {
  try {
    return await mediaInsights(m, token);
  } catch {
    // media posted before the account became professional has no insights
    return {} as Record<string, number>;
  }
}

// Pulls recent posts with their metrics into MediaItem, so the dashboard and AI reports
// have numbers without calling Instagram for every view.
export async function syncMedia(account: InstagramAccount, limit = 25) {
  if (account.isDemo) return;
  const token = await freshToken(account);
  const page = await listMedia(account.igUserId, token, limit);
  for (const m of page.data || []) {
    const row = mediaRow(m, await safeInsights(m, token));
    await prisma.mediaItem.upsert({
      where: { accountId_igMediaId: { accountId: account.id, igMediaId: m.id } },
      create: { accountId: account.id, igMediaId: m.id, ...row },
      update: row,
    });
  }
  await prisma.instagramAccount.update({ where: { id: account.id }, data: { mediaSyncedAt: new Date() } });
}

export async function syncIfStale(account: InstagramAccount, maxAgeMs = 15 * 60 * 1000) {
  if (account.isDemo) return;
  if (account.mediaSyncedAt && Date.now() - account.mediaSyncedAt.getTime() < maxAgeMs) return;
  try {
    await syncMedia(account);
  } catch (e) {
    console.error("media sync", e);
  }
}

export async function mediaWithInsights(account: InstagramAccount, mediaId: string) {
  const token = await freshToken(account);
  const m = await getMedia(mediaId, token);
  const ins = await safeInsights(m, token);
  const row = mediaRow(m, ins);
  await prisma.mediaItem.upsert({
    where: { accountId_igMediaId: { accountId: account.id, igMediaId: m.id } },
    create: { accountId: account.id, igMediaId: m.id, ...row },
    update: row,
  });
  return { media: m, insights: ins };
}
