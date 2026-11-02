import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/oauth";
import { preflight, readForm, withCors } from "@/app/api/oauth/cors";

export async function POST(req: Request) {
  const form = await readForm(req);
  const token = form.get("token");
  if (token) await revokeToken(token);
  return withCors(new NextResponse(null, { status: 200 }));
}

export const OPTIONS = preflight;
