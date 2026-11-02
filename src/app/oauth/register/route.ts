import { NextResponse } from "next/server";
import { registerClient } from "@/lib/oauth";
import { preflight, withCors } from "@/app/api/oauth/cors";

// Dynamic Client Registration (RFC 7591) — Claude and ChatGPT register themselves here.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return withCors(NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 }));
  const result = await registerClient(body);
  if ("error" in result) return withCors(NextResponse.json(result, { status: 400 }));
  return withCors(NextResponse.json(result, { status: 201 }));
}

export const OPTIONS = preflight;
