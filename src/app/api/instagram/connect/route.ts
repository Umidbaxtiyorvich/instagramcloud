import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { instagramAppConfigured, instagramAuthUrl } from "@/lib/instagram";
import { randomToken } from "@/lib/crypto";
import { setOauthState } from "@/lib/ig-pending";
import { baseUrl } from "@/lib/url";

export async function GET(req: Request) {
  const app = baseUrl(req);
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", app));
  if (!instagramAppConfigured()) {
    return NextResponse.redirect(new URL("/connect/instagram?ig=return", app));
  }
  const state = `${user.id}.${randomToken(16)}`;
  await setOauthState(state);
  return NextResponse.redirect(instagramAuthUrl(state));
}
