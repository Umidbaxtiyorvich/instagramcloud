import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { issueCode, validateAuthorize } from "@/lib/oauth";
import { baseUrl } from "@/lib/url";

// Consent form target. The session cookie is SameSite=Lax, so a cross-site form cannot post here as the user.
export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/oauth/authorize?${form}`)}`, baseUrl(req)), 303);
  }
  const v = await validateAuthorize(form);
  if ("fatal" in v) return NextResponse.json({ error: v.fatal }, { status: 400 });
  if ("redirect" in v) return NextResponse.redirect(v.redirect, 303);

  if (form.get("decision") !== "allow") {
    const u = new URL(v.req.redirectUri);
    u.searchParams.set("error", "access_denied");
    if (v.req.state) u.searchParams.set("state", v.req.state);
    return NextResponse.redirect(u.toString(), 303);
  }
  return NextResponse.redirect(await issueCode(user.id, v.req), 303);
}
