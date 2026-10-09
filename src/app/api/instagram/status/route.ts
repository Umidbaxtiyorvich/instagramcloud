import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { instagramAppConfigured } from "@/lib/instagram";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  return NextResponse.json({ configured: instagramAppConfigured() });
}
