import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/oauth";
import { preflight, withCors } from "../cors";

// Served at /.well-known/oauth-protected-resource (see next.config.ts rewrites)
export async function GET(req: Request) {
  return withCors(NextResponse.json(protectedResourceMetadata(req)));
}

export const OPTIONS = preflight;
