import { NextResponse } from "next/server";
import { authServerMetadata } from "@/lib/oauth";
import { preflight, withCors } from "../cors";

// Served at /.well-known/oauth-authorization-server (see next.config.ts rewrites)
export async function GET(req: Request) {
  return withCors(NextResponse.json(authServerMetadata(req)));
}

export const OPTIONS = preflight;
