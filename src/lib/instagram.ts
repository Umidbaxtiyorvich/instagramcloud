import { decryptSecret } from "./crypto";

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

// "instagram" mode (instagram.com/oauth) needs the Instagram App ID/secret from
// "Instagram API with Instagram Login" — the Meta (Facebook) App ID there fails
// with "Invalid platform app". "facebook" mode uses the Meta App ID/secret.
function igAppId() {
  if (oauthMode() === "instagram") return process.env.INSTAGRAM_APP_ID || "";
  return process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || "";
}

function igAppSecret() {
  if (oauthMode() === "instagram") return process.env.INSTAGRAM_APP_SECRET || "";
  return process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || "";
}

function oauthMode(): "facebook" | "instagram" {
  return process.env.INSTAGRAM_OAUTH_MODE === "instagram" ? "instagram" : "facebook";
}

function redirectUri() {
  return process.env.INSTAGRAM_REDIRECT_URI || `${process.env.APP_URL}/api/instagram/callback`;
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

export async function listMedia(igId: string, token: string) {
  return graph(
    `/${igId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=25`,
    token
  );
}

export async function listComments(mediaId: string, token: string) {
  return graph(`/${mediaId}/comments?fields=id,text,username,timestamp,from&limit=50`, token);
}

export async function mediaInsights(mediaId: string, token: string) {
  return graph(
    `/${mediaId}/insights?metric=views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time`,
    token
  );
}

export async function accountInsights(igId: string, token: string) {
  return graph(
    `/${igId}/insights?metric=reach,follower_count,website_clicks&period=day&metric_type=total_value`,
    token
  );
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

export async function publishMedia(igId: string, token: string, creationId: string) {
  return graph(`/${igId}/media_publish`, token, {
    method: "POST",
    body: JSON.stringify({ creation_id: creationId }),
  });
}
