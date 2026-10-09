import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { exchangeCode, subscribeWebhooks } from "@/lib/instagram";
import { clearOauthState, readOauthState } from "@/lib/ig-pending";
import { saveInstagramAccount } from "@/lib/ig-save";

function appUrl() {
  return process.env.APP_URL || "http://localhost:3000";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const app = appUrl();
  if (err || !code) return NextResponse.redirect(`${app}/connect/instagram?ig=denied`);

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${app}/login`);

  const expected = await readOauthState();
  await clearOauthState();
  if (!expected || state !== expected || !state.startsWith(`${user.id}.`)) {
    return NextResponse.redirect(`${app}/connect/instagram?ig=state`);
  }

  try {
    const ig = await exchangeCode(code);
    try {
      await subscribeWebhooks(ig.igUserId, ig.accessToken);
    } catch (e) {
      console.error("webhook subscribe", e);
    }
    await saveInstagramAccount(user.id, {
      igUserId: ig.igUserId,
      username: ig.username,
      name: ig.name,
      profilePic: ig.profilePic,
      followersCount: ig.followersCount,
      accessToken: ig.accessToken,
      tokenExpiresAt: ig.tokenExpiresAt ? ig.tokenExpiresAt.toISOString() : null,
      isDemo: false,
    });
    return NextResponse.redirect(`${app}/dashboard?ig=ok`);
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(`${app}/connect/instagram?ig=error`);
  }
}
