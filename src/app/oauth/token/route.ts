import { NextResponse } from "next/server";
import { exchangeToken } from "@/lib/oauth";
import { preflight, readForm, withCors } from "@/app/api/oauth/cors";

export async function POST(req: Request) {
  const form = await readForm(req);
  // client_secret_basic: the client id rides in the Authorization header
  const basic = req.headers.get("authorization");
  if (!form.get("client_id") && basic?.startsWith("Basic ")) {
    const [id] = Buffer.from(basic.slice(6), "base64").toString().split(":");
    if (id) form.set("client_id", decodeURIComponent(id));
  }
  const result = await exchangeToken(form);
  if ("error" in result) return withCors(NextResponse.json(result, { status: 400 }));
  return withCors(NextResponse.json(result));
}

export const OPTIONS = preflight;
