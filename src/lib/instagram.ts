import { createHmac, timingSafeEqual } from "crypto";
import { decryptSecret } from "./crypto";
import { configuredUrl } from "./url";

const VERSION = process.env.GRAPH_API_VERSION || "v23.0";

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
].join(",");

const FB_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

function igAppId() {
  return process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || "";
}

function igAppSecret() {
  return process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "";
}

function oauthMode(): "facebook" | "instagram" {
  return process.env.INSTAGRAM_OAUTH_MODE === "instagram" ? "instagram" : "facebook";
}

function redirectUri() {
  return process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${configuredUrl() || "http://localhost:3000"}/api/instagram/callback`;
}

export function instagramAuthUrl(state: string) {
  const redirect = redirectUri();
  if (oauthMode() === "instagram") {
    const params = new URLSearchParams({
      force_reauth: "true",
      client_id: igAppId(),
      redirect_uri: redirect,
      response_type: "code",
      scope: IG_SCOPES,
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: igAppId(),
    redirect_uri: redirect,
    response_type: "code",
    state,
    display: "page",
    scope: FB_SCOPES,
    extras: JSON.stringify({ setup: { channel: "IG_API_ONBOARDING" } }),
  });
  return `https://www.facebook.com/${VERSION}/dialog/oauth?${params.toString()}`;
}

export function instagramAppConfigured() {
  return Boolean(igAppId() && igAppSecret());
}

export function oauthModeIsInstagram() {
  return oauthMode() === "instagram";
}

// Meta signs webhook bodies with the app secret (X-Hub-Signature-256: sha256=<hex>)
export function webhookSignatureValid(rawBody: string, header: string | null) {
  const secret = igAppSecret();
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function metaConfigured() {
  return instagramAppConfigured();
}

function graphHost() {
  return oauthMode() === "instagram" ? "graph.instagram.com" : "graph.facebook.com";
}

async function graph(path: string, token: string, init?: RequestInit) {
  const url = path.startsWith("http") ? path : `https://${graphHost()}/${VERSION}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

async function exchangeFacebookCode(code: string) {
  const tokenUrl = new URL(`https://graph.facebook.com/${VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", igAppId());
  tokenUrl.searchParams.set("client_secret", igAppSecret());
  tokenUrl.searchParams.set("redirect_uri", redirectUri());
  tokenUrl.searchParams.set("code", code);
  const res = await fetch(tokenUrl);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || JSON.stringify(json));
  let accessToken = json.access_token as string;
  const longUrl = new URL(`https://graph.facebook.com/${VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", igAppId());
  longUrl.searchParams.set("client_secret", igAppSecret());
  longUrl.searchParams.set("fb_exchange_token", accessToken);
  const longRes = await fetch(longUrl);
  const longJson = await longRes.json();
  if (longJson.access_token) accessToken = longJson.access_token;
  const pages = await graph(
    `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count}`,
    accessToken
  );
  const page = (pages.data || []).find((p: { instagram_business_account?: { id?: string } }) => p.instagram_business_account?.id);
  if (!page?.instagram_business_account?.id) {
    throw new Error("Facebook Page ga ulangan Instagram professional akkaunt topilmadi.");
  }
  const ig = page.instagram_business_account;
  return {
    igUserId: String(ig.id),
    username: String(ig.username || ""),
    name: String(ig.name || ig.username || page.name || ""),
    profilePic: String(ig.profile_picture_url || ""),
    followersCount: Number(ig.followers_count || 0),
    accessToken: String(page.access_token || accessToken),
    tokenExpiresAt: longJson.expires_in ? new Date(Date.now() + Number(longJson.expires_in) * 1000) : null,
  };
}

async function exchangeInstagramCode(code: string) {
  const body = new URLSearchParams({
    client_id: igAppId(),
    client_secret: igAppSecret(),
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error_message || json?.error?.message || JSON.stringify(json));
  const short = json.access_token as string;
  const userId = String(json.user_id);
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${igAppSecret()}&access_token=${short}`
  );
  const longJson = await longRes.json();
  const accessToken = longJson.access_token || short;
  const expiresIn = longJson.expires_in as number | undefined;
  const me = await graph(
    `/me?fields=user_id,username,name,profile_picture_url,followers_count,account_type`,
    accessToken
  );
  return {
    igUserId: me.user_id || me.id || userId,
    username: me.username as string,
    name: (me.name as string) || me.username,
    profilePic: (me.profile_picture_url as string) || "",
    followersCount: Number(me.followers_count || 0),
    accessToken,
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

export async function exchangeCode(code: string) {
  if (oauthMode() === "instagram") return exchangeInstagramCode(code);
  return exchangeFacebookCode(code);
}

export function tokenOf(enc: string) {
  return decryptSecret(enc);
}

export async function sendPrivateReply(igId: string, token: string, commentId: string, text: string) {
  return graph(`/${igId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
}

export async function sendDm(igId: string, token: string, recipientId: string, text: string) {
  return graph(`/${igId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
}

export async function replyToComment(commentId: string, token: string, text: string) {
  return graph(`/${commentId}/replies`, token, {
    method: "POST",
    body: JSON.stringify({ message: text }),
  });
}

export async function hideComment(commentId: string, token: string, hide = true) {
  return graph(`/${commentId}?hide=${hide}`, token, { method: "POST" });
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count";

export type IgMedia = {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

export async function listMedia(igId: string, token: string, limit = 25, after?: string) {
  const params = new URLSearchParams({ fields: MEDIA_FIELDS, limit: String(limit) });
  if (after) params.set("after", after);
  return graph(`/${igId}/media?${params}`, token) as Promise<{
    data: IgMedia[];
    paging?: { cursors?: { after?: string }; next?: string };
  }>;
}

export async function getMedia(mediaId: string, token: string) {
  return graph(`/${mediaId}?fields=${MEDIA_FIELDS}`, token) as Promise<IgMedia>;
}

export type IgComment = {
  id: string;
  text: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
  hidden?: boolean;
  from?: { id: string; username?: string };
  replies?: { data: IgComment[] };
};

export async function listComments(mediaId: string, token: string, limit = 50, after?: string) {
  const params = new URLSearchParams({
    fields: "id,text,username,timestamp,like_count,hidden,from,replies{id,text,username,timestamp,from}",
    limit: String(limit),
  });
  if (after) params.set("after", after);
  return graph(`/${mediaId}/comments?${params}`, token) as Promise<{
    data: IgComment[];
    paging?: { cursors?: { after?: string } };
  }>;
}

export async function deleteComment(commentId: string, token: string) {
  return graph(`/${commentId}`, token, { method: "DELETE" });
}

function insightValues(json: { data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }) {
  const out: Record<string, number> = {};
  for (const m of json.data || []) {
    out[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
  }
  return out;
}

// Reels have watch-time metrics that feed posts reject, so the metric list depends on the type.
export async function mediaInsights(media: Pick<IgMedia, "id" | "media_type" | "media_product_type">, token: string) {
  const isReel = media.media_product_type === "REELS";
  const isStory = media.media_product_type === "STORY";
  const metrics = isReel
    ? "views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time"
    : isStory
      ? "views,reach,shares,total_interactions,replies,navigation"
      : "views,reach,saved,shares,likes,comments,total_interactions";
  return insightValues(await graph(`/${media.id}/insights?metric=${metrics}`, token));
}

export async function profile(igId: string, token: string) {
  return graph(
    `/${igId}?fields=id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count`,
    token
  ) as Promise<{
    id: string;
    username: string;
    name?: string;
    biography?: string;
    profile_picture_url?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  }>;
}

// 30-day account totals. Reach is unique accounts over the whole period, not a sum of days.
export async function accountTotals(igId: string, token: string, since: Date, until: Date) {
  const params = new URLSearchParams({
    metric: "reach,views,accounts_engaged,total_interactions,likes,comments,shares,saves,profile_links_taps,follows_and_unfollows",
    period: "day",
    metric_type: "total_value",
    since: String(Math.floor(since.getTime() / 1000)),
    until: String(Math.floor(until.getTime() / 1000)),
  });
  return insightValues(await graph(`/${igId}/insights?${params}`, token));
}

export async function followerDemographics(igId: string, token: string, breakdown: "age" | "gender" | "country" | "city") {
  const params = new URLSearchParams({
    metric: "follower_demographics",
    period: "lifetime",
    timeframe: "this_month",
    metric_type: "total_value",
    breakdown,
  });
  const json = await graph(`/${igId}/insights?${params}`, token);
  const results =
    json?.data?.[0]?.total_value?.breakdowns?.[0]?.results as { dimension_values: string[]; value: number }[] | undefined;
  return (results || [])
    .map((r) => ({ key: r.dimension_values.join(" "), value: r.value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

export async function refreshInstagramToken(token: string) {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
  );
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(json?.error?.message || "token refresh failed");
  return { accessToken: String(json.access_token), expiresIn: Number(json.expires_in || 0) };
}

export async function subscribeWebhooks(igId: string, token: string) {
  return graph(
    `/${igId}/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks,messaging_seen,messaging_referrals`,
    token,
    { method: "POST" }
  );
}

export async function createReelContainer(igId: string, token: string, videoUrl: string, caption: string) {
  const params = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: token,
  });
  return graph(`/${igId}/media?${params.toString()}`, token, { method: "POST" });
}

// Video containers are processed asynchronously; publishing before FINISHED fails.
export async function waitForContainer(containerId: string, token: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const st = await graph(`/${containerId}?fields=status_code,status`, token);
    if (st.status_code === "FINISHED") return;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      throw new Error(`Video qayta ishlanmadi: ${st.status || st.status_code}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Video hali qayta ishlanmoqda — bir necha daqiqadan keyin qayta urinib ko'ring.");
}

export async function publishMedia(igId: string, token: string, creationId: string) {
  return graph(`/${igId}/media_publish`, token, {
    method: "POST",
    body: JSON.stringify({ creation_id: creationId }),
  });
}
