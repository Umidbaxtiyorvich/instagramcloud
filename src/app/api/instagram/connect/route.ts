import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { instagramAppConfigured, instagramAuthUrl } from "@/lib/instagram";
import { randomToken } from "@/lib/crypto";
import { setOauthState } from "@/lib/ig-pending";

function appUrl() {
  return process.env.APP_URL || "http://localhost:3000";
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl()));
  if (!instagramAppConfigured()) {
    return NextResponse.redirect(new URL("/connect/instagram?ig=return", appUrl()));
  }
  const state = `${user.id}.${randomToken(16)}`;
  await setOauthState(state);
  return NextResponse.redirect(instagramAuthUrl(state));
}
